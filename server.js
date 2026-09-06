// Zero-dependency local server.
//   - serves ./public
//   - POST /api/diagnose : reasoning trace -> misconception + Socratic question
//   - POST /api/practice : misconception -> 2-3 targeted follow-up problems
//
// With ANTHROPIC_API_KEY set it asks Claude and falls back to the rule engine on
// any failure. Without a key it runs on the rule engine alone, so the demo never
// depends on the network.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, generatePractice, problemById, hydrate, MISCONCEPTIONS } from './public/shared/engine.js';
import { lookupWord, START_LADDER } from './public/shared/dictionary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

// --- tiny .env loader -------------------------------------------------------
let ENV_LOADED = false;
try {
  const env = await fs.readFile(path.join(__dirname, '.env'), 'utf8');
  ENV_LOADED = true;
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env, fine */ }

/* --------------------------- accounts (optional) ---------------------------- */
// Two public values only. There is deliberately no service_role key here: every
// query runs as the signed-in parent, so Postgres row level security is what
// keeps one family's data away from another's, rather than care in this file.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPA_ON = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

async function supa(path, { method = 'GET', token = null, body = null, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json: parsed, body: text.slice(0, 300) };
}

// The AI layer is provider-agnostic: whichever key is present wins. Add a new
// provider by adding an adapter below — nothing else in the app knows or cares.
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    key: () => process.env.ANTHROPIC_API_KEY || '',
    model: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    call: callAnthropic,
    hint: 'ANTHROPIC_API_KEY (billed per token, separate from a Claude subscription)'
  },
  gemini: {
    label: 'Gemini',
    key: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: () => process.env.GEMINI_MODEL || GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash',
    call: callGemini,
    hint: 'GEMINI_API_KEY from Google AI Studio (has a free tier)'
  },
  openai: {
    label: 'OpenAI',
    key: () => process.env.OPENAI_API_KEY || '',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o-mini',
    call: callOpenAI,
    hint: 'OPENAI_API_KEY (billed per token)'
  }
};

function pickProvider() {
  const forced = (process.env.AI_PROVIDER || '').toLowerCase();
  if (forced && PROVIDERS[forced]) return PROVIDERS[forced].key() ? forced : null;
  for (const name of ['anthropic', 'gemini', 'openai']) if (PROVIDERS[name].key()) return name;
  return null;
}

const PROVIDER = pickProvider();
const AI = PROVIDER ? PROVIDERS[PROVIDER] : null;
const API_KEY = AI ? AI.key() : '';
const MODEL = AI ? AI.model() : null;
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

/* ------------------------------- Claude calls ------------------------------- */

// Every caller asks for structured JSON matching `schema`; the adapter decides
// how to get it out of its provider.
async function callModel({ system, user, schema, name }) {
  if (!AI) throw new Error('no AI provider configured');
  return AI.call({ system, user, schema, name });
}

async function callAnthropic({ system, user, schema, name }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1400, system,
      messages: [{ role: 'user', content: user }],
      tools: [{ name, description: `Return the ${name} result.`, input_schema: schema }],
      tool_choice: { type: 'tool', name }
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block) throw new Error('no tool_use block returned');
  return block.input;
}

// Gemini takes an OpenAPI-flavoured schema: uppercase types, and it rejects
// additionalProperties — hence no free-form maps anywhere in our schemas.
function toGeminiSchema(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  if (node.type) out.type = String(node.type).toUpperCase();
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = node.enum;
  if (node.items) out.items = toGeminiSchema(node.items);
  if (node.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(node.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (node.required) out.required = node.required;
  return out;
}

let GEMINI_FALLBACK_MODEL = null;

async function callGemini({ system, user, schema }, retried = false) {
  const model = retried && GEMINI_FALLBACK_MODEL ? GEMINI_FALLBACK_MODEL : (process.env.GEMINI_MODEL || GEMINI_FALLBACK_MODEL || MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
        maxOutputTokens: 1400
      }
    })
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    if (res.status === 404 && !retried) {
      // The 404 body usually names the successor, e.g. "use models/gemini-3.6-flash".
      const suggested = [...body.matchAll(/models\/([A-Za-z0-9.\-]+)/g)]
        .map(m => m[1]).find(m => m !== model);
      if (suggested) {
        GEMINI_FALLBACK_MODEL = suggested;
        console.log(`  [gemini] "${model}" is gone; Google suggests "${suggested}" — switching.`);
        console.log(`  [gemini] Pin it: put GEMINI_MODEL=${suggested} in .env`);
        return callGemini({ system, user, schema }, true);
      }
    }
    if (res.status === 404) {
      throw new Error(`Gemini 404 for model "${model}". Set GEMINI_MODEL in .env to a model your key can use (see Google AI Studio). ${body}`);
    }
    throw new Error(`Gemini ${res.status}: ${body}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text);
}

async function callOpenAI({ system, user, schema, name }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name, strict: false, schema } },
      max_tokens: 1400
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('OpenAI returned no content');
  return JSON.parse(text);
}

const TUTOR_SYSTEM = `You are the tutoring brain inside a math game for children aged 7-10.

You are given a word problem, the equation the child actually BUILT, the answer they
typed, and a timestamped trace of every number and operator they tapped, including
revisions. A rule engine has already made a first guess at the misconception.

Your job is to explain HOW THE CHILD IS THINKING, then respond to that thinking.

Hard rules:
- Never state or compute the correct answer, and never give the correct equation.
- The Socratic question must point at the specific choice the child made, not be generic.
- Distinguish a careless arithmetic slip (right equation, wrong number) from a real
  conceptual misunderstanding. Say so plainly in "severity".
- Vocabulary a 7-year-old knows. Short sentences. Warm, never condescending, never
  the word "wrong".
- If the trace shows lots of revisions, the child is guessing; ask what the story is
  about before asking about operations.`;

const DIAGNOSE_NAME = 'report_diagnosis';
const DIAGNOSE_SCHEMA = {
    type: 'object',
    properties: {
      misconception: { type: 'string', enum: Object.keys(MISCONCEPTIONS),
                       description: 'the closest id from this list; use "unknown" if none fit' },
      label: { type: 'string', description: 'one short phrase an adult would read, describing the mental model' },
      why: { type: 'string', description: 'one or two sentences to a parent/teacher on why a child thinks this' },
      severity: { type: 'string', enum: ['correct', 'slip', 'misconception'] },
      ask: { type: 'string', description: 'the Socratic question to show the child first. One sentence.' },
      hint: { type: 'string', description: 'if they are still stuck, a nudge that does not give the answer' },
      explain: { type: 'string', description: 'if still stuck, a concrete explanation tied to what they actually did' },
      encouragement: { type: 'string', description: 'one short warm line to open with' }
  },
  required: ['misconception', 'label', 'why', 'severity', 'ask', 'hint', 'explain', 'encouragement']
};

const PRACTICE_NAME = 'emit_practice';
const PRACTICE_SCHEMA = {
    type: 'object',
    properties: {
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Word problem. EVERY number must be wrapped as [[value|what this number means]]. No other digits anywhere in the text.'
            },
            correct: { type: 'string', description: 'canonical equation using digits and + - x / only, e.g. 4x6 or 3x6-5' },
            traps: {
              type: 'array',
              description: 'plausible wrong equations this child might build, and what each would reveal',
              items: {
                type: 'object',
                properties: {
                  equation: { type: 'string', description: 'the wrong equation, e.g. 4+6' },
                  misconception: { type: 'string', description: 'kebab-case misconception id it reveals' }
                },
                required: ['equation', 'misconception']
              }
            }
          },
          required: ['text', 'correct', 'traps']
        }
      }
  },
  required: ['problems']
};

function traceSummary(trace = []) {
  if (!trace.length) return '(no trace recorded)';
  const t0 = trace[0].t;
  return trace.map(e => `  +${((e.t - t0) / 1000).toFixed(1)}s  ${e.type}${e.value !== undefined ? ' ' + e.value : ''}`).join('\n');
}

async function aiDiagnose(problem, built, answer, trace, ruleResult) {
  const user = `WORD PROBLEM
${problem.plainText}

Numbers in the story and what each one means:
${problem.quantities.map(q => `  ${q.value} = ${q.label}`).join('\n')}

EQUATION THE CHILD BUILT: ${built || '(nothing)'}
ANSWER THE CHILD TYPED: ${answer ?? '(none)'}

WHAT THE CHILD TAPPED, IN ORDER:
${traceSummary(trace)}

RULE ENGINE'S FIRST GUESS: ${ruleResult.misconception || 'correct'}${ruleResult.label ? ` (${ruleResult.label})` : ''}

Diagnose the child's thinking and respond to it.`;
  const out = await callModel({ system: TUTOR_SYSTEM, user, schema: DIAGNOSE_SCHEMA, name: DIAGNOSE_NAME });
  // The model sometimes invents an id ("swapped-group-and-size", "none"). Its
  // PROSE is often better than ours and is kept, but the id is what gets counted
  // in the child's progress and printed on their badges, so an unrecognised one
  // is filed as 'unknown' rather than leaking a raw slug into the UI.
  const known = MISCONCEPTIONS[out.misconception] ? out.misconception : 'unknown';
  return { ...out, misconception: known, modelMisconception: out.misconception,
           source: 'claude', correct: out.severity === 'correct' };
}

async function aiPractice(problem, misconception, count) {
  const m = MISCONCEPTIONS[misconception];
  const user = `A child aged 7-10 just showed this misconception while solving a word problem.

MISCONCEPTION: ${misconception}${m ? ` — ${m.label}. ${m.why}` : ''}
THE PROBLEM THEY MISSED: ${problem.plainText}
CONCEPT: ${problem.concept}

Write ${count} NEW word problems that isolate exactly this misconception. Requirements:
- Different objects and different numbers from the original, and different from each other.
- Same underlying relationship, so the same wrong move stays tempting.
- Go from easier to harder across the ${count}.
- Numbers small enough for mental arithmetic (results under 100, whole numbers only).
- Mark every number as [[value|what this number means]] and use no other digits.
- In "traps", list the wrong equations this particular child is likely to build.`;
  const out = await callModel({ system: TUTOR_SYSTEM, user, schema: PRACTICE_SCHEMA, name: PRACTICE_NAME });
  return (out.problems || []).slice(0, count).map((p, i) => hydrate({
    id: `ai-${misconception}-${Date.now()}-${i}`,
    concept: problem.concept,
    generated: true,
    bySource: 'claude',
    targets: misconception,
    text: p.text,
    correct: p.correct,
    traps: Object.fromEntries((p.traps || []).filter(t => t && t.equation).map(t => [t.equation, t.misconception]))
  })).filter(p => p.answer !== null && Number.isFinite(p.answer) && p.quantities.length >= 2);
}

const WORD_NAME = 'explain_word';
const WORD_SCHEMA = {
    type: 'object',
    properties: {
      emoji: { type: 'string', description: 'ONE emoji that best pictures this word. Just the emoji character.' },
      meaning: { type: 'string', description: 'What the word means, for a 7-year-old. One or two short sentences. Everyday words only.' },
      inStory: { type: 'string', description: 'One short sentence saying what this word is doing in THIS story.' },
      note: { type: 'string', description: 'Only for maths words like altogether, each, equally: one warning about how the word can mislead. Empty string otherwise. NEVER name the operation this problem needs.' }
  },
  required: ['emoji', 'meaning', 'inStory', 'note']
};

const START_NAME = 'starting_nudge';
const START_SCHEMA = {
    type: 'object',
    properties: {
      say: { type: 'string', description: 'One or two short sentences spoken to the child. Must NOT name an operation, must NOT give the answer.' },
      emoji: { type: 'string', description: 'one emoji' }
  },
  required: ['say', 'emoji']
};

const WORD_SYSTEM = `You explain words to a child aged 7 who is reading a maths word problem.
The child is stuck on a word, not on the maths.

Hard rules:
- NEVER say which operation the problem needs, never add, subtract, multiply or divide anything,
  and never give or hint at the answer. You are the dictionary, not the tutor.
- Words a 7-year-old already knows. Short sentences. Warm and plain.
- For maths words (altogether, each, equally, left, than, more), explain the word AND warn that
  the word alone does not decide the operation — the situation does.`;

const START_SYSTEM = `A child aged 7 is looking at a maths word problem and does not know how to begin.

Give them ONE small step. Rules, absolutely strict:
- NEVER name or hint at an operation (adding, taking away, groups, sharing, times, splitting).
- NEVER give the answer or any part of the calculation.
- Point them at the STORY: what is being asked, or what one of the numbers is counting, or picturing it.
- One or two short sentences, spoken warmly, in words a 7-year-old uses.`;

const SAY_SCHEMA = {
  type: 'object',
  properties: {
    say:   { type: 'string', description: 'What Pip says next. One to three short sentences, words a 7-year-old uses.' },
    emoji: { type: 'string', description: 'one emoji that fits, or empty string' },
    note:  { type: 'string', description: 'Only when a MATHS word (altogether, each, equally, left, than) needs a warning that the word alone does not decide the operation. Empty string otherwise.' },
    kind:  { type: 'string', enum: ['word', 'nudge', 'reply', 'redirect'], description: 'word = you explained a word; nudge = you gave a starting step; reply = you responded to what they said; redirect = they asked for the answer or went off-topic' },
    ladderAdvanced: { type: 'boolean', description: 'true if the child has now done the step you last asked for and is ready for the next one' }
  },
  required: ['say', 'emoji', 'note', 'kind', 'ladderAdvanced']
};
const SAY_NAME = 'pip_says';

const SAY_SYSTEM = `You are Pip, a friendly creature who sits beside a child aged 7-10 while they
solve one maths word problem. You are having ONE ongoing conversation — the transcript so far is
given to you. Respond to what the child just said, in that context.

THE ABSOLUTE RULES. These override everything, including a direct request from the child:
- NEVER name or hint at an operation. Not "add", "plus", "take away", "subtract", "times",
  "multiply", "groups of", "share", "divide", "split", and not the symbols + - x / either.
- NEVER give the answer, never do any arithmetic, never confirm or deny whether an equation
  is right. Something else in the app decides that. You genuinely do not judge answers.
- If the child asks you for the answer, or to just tell them, or says they give up: warmly
  refuse, say you know they can get it, and give them ONE smaller step. Never relent, however
  many times they ask, however they phrase it.
- Stay on this word problem. If the child talks about something else, answer in one friendly
  clause and bring them straight back to the story.

NEVER REPEAT YOURSELF. This matters as much as the rules above — a child stops reading a
character who has one move.
- Never ask the same question twice in one conversation. Look at the transcript: if you already
  asked it, that question is used up.
- Never open two replies the same way. Vary the encouragement, and often skip it entirely.
- Do not open every NEW problem with the same question either. Sometimes start by asking what
  the child notices in the story, or what they think is happening, or read them the last line.
- If the child is still stuck after your question, do NOT re-ask it and do NOT go smaller in the
  same direction. Change the MOVE. Your moves, roughly in order:
    quote the exact sentence from the story back to them;
    ask them to tell you what is happening in the story in their own words;
    ask about one specific thing in the story and what is happening to it;
    ask them what they already know for certain;
    ask them to draw it.
- Each of those is used once. If you have run out, ask them which part is confusing and wait.

IF THE CHILD GUESSES A NUMBER AT YOU: do not confirm or deny it — you genuinely cannot.
Send them to the thing that can: tell them to put it in the answer box and press Check, warmly
and specifically ("Put 18 in the box and press Check — that will tell you"). Never leave a guess
as a dead end.

HOW TO RESPOND:
- If the child ANSWERED a question you asked: say whether they have understood the STORY (not
  the maths), warmly, then give them the next small step. Set ladderAdvanced true.
- If the child asked what a WORD means: explain it in THIS story. Most important: explain how
  it RELATES to the other things in the story. A child who asks about "box" in a juice problem
  usually knows what a box is — what they cannot work out is that a pack holds boxes and a box
  holds juice. Lead with the relationship, then the plain meaning.
- If the child says they are stuck or does not understand: go SMALLER, do not repeat yourself.
- If the child seems to be guessing: ask them to tell you what is happening in the story, in
  their own words, before anything about numbers.

The starting scaffold, in order — never skip ahead, never give more than one rung at a time:
  1. What is the question at the end asking you to find?
  2. What does each number in the story count?
  3. Picture it or draw it — what is happening to those things?

Short sentences. Warm, never babyish, never say "wrong".`;

/* --------------------------------- routing ---------------------------------- */

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Open http://localhost:5173/api/selftest in a browser to find out exactly
  // what the AI layer is doing. A 404 here means you are talking to an OLD
  // server process that is still holding the port.
  if (url.pathname === '/api/selftest') {
    // Debug endpoint: it names the provider, shows a masked key and makes a real
    // model call. Harmless on a laptop, not something to leave open on a public
    // URL where anyone could read it or burn the quota — so it answers only to
    // this machine, which needs no configuration and cannot be forgotten.
    const from = req.socket.remoteAddress || '';
    if (!/^(::1|::ffff:127\.|127\.)/.test(from)) {
      return json(res, 404, { error: 'not found' });
    }
    const masked = API_KEY ? `${API_KEY.slice(0, 4)}…${API_KEY.slice(-4)} (${API_KEY.length} chars)` : null;
    const base = {
      buildHasSelftest: true,
      envFileFound: ENV_LOADED,
      provider: PROVIDER,
      model: MODEL,
      keyPresent: Boolean(API_KEY),
      keyLooksLike: masked,
      keysSeen: Object.entries(PROVIDERS).filter(([, p]) => p.key()).map(([n]) => n)
    };
    if (!API_KEY) {
      return json(res, 200, { ...base, ok: false,
        diagnosis: 'No provider key is loaded. Either .env is missing/misnamed, it is not in the folder you started the server from, or the key line is blank.' });
    }
    try {
      const out = await callModel({
        system: 'You are a test harness. Answer exactly as asked.',
        user: 'Reply with the single word: pong',
        schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] },
        name: 'ping'
      });
      return json(res, 200, { ...base, ok: true, reply: out?.reply ?? null,
        diagnosis: `${AI.label} answered. The AI layer is live.` });
    } catch (e) {
      return json(res, 200, { ...base, ok: false, error: String(e.message || e),
        diagnosis: 'The key is loaded but the call failed — the error above is verbatim from the provider.' });
    }
  }

  /* ------------------------------ accounts ---------------------------------- */
  // Optional, and inert until SUPABASE_URL and SUPABASE_ANON_KEY are set. The
  // app must still open straight into a game with no account at all — a judge
  // following the submission link should never meet a sign-in form.
  //
  // Every database call is made with the PARENT'S OWN access token, so row level
  // security in Postgres decides what they can see. The service_role key is never
  // used and never needs to exist on this server: a bug here cannot read another
  // family's rows, because the database itself refuses.

  if (url.pathname.startsWith('/api/account')) {
    if (!SUPA_ON) {
      return json(res, 200, { enabled: false,
        reason: 'Accounts are off. Set SUPABASE_URL and SUPABASE_ANON_KEY to turn them on.' });
    }
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

    if (url.pathname === '/api/account/status') {
      return json(res, 200, { enabled: true, signedIn: Boolean(bearer) });
    }

    // Ask Supabase to email a one-time link. No password is ever created, sent
    // or stored — there is nothing here for an attacker to steal.
    if (req.method === 'POST' && url.pathname === '/api/account/link') {
      const { email } = await readBody(req);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) {
        return json(res, 400, { error: 'That does not look like an email address.' });
      }
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      try {
        const r = await supa('/auth/v1/otp', { method: 'POST', body: {
          email, create_user: true, options: { email_redirect_to: origin }
        } });
        if (!r.ok) return json(res, 502, { error: 'Could not send the link just now.', detail: r.body });
        return json(res, 200, { sent: true });
      } catch (e) { return json(res, 502, { error: 'Could not reach the sign-in service.' }); }
    }

    if (!bearer) return json(res, 401, { error: 'Sign in first.' });

    if (req.method === 'GET' && url.pathname === '/api/account/children') {
      const r = await supa('/rest/v1/child?select=id,name,progress,updated_at&order=created_at', { token: bearer });
      return json(res, r.ok ? 200 : 502, r.ok ? { children: r.json || [] } : { error: 'Could not load.', detail: r.body });
    }

    if (req.method === 'POST' && url.pathname === '/api/account/children') {
      const { name, progress } = await readBody(req);
      const clean = String(name || '').trim().slice(0, 24);
      if (!clean) return json(res, 400, { error: 'A name is needed.' });
      const r = await supa('/rest/v1/child', { method: 'POST', token: bearer,
        headers: { Prefer: 'return=representation' },
        body: { name: clean, progress: progress && typeof progress === 'object' ? progress : {} } });
      return json(res, r.ok ? 200 : 502, r.ok ? { child: (r.json || [])[0] } : { error: 'Could not save.', detail: r.body });
    }

    const m = /^\/api\/account\/children\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (m && req.method === 'PUT') {
      const { name, progress } = await readBody(req);
      const patch = { updated_at: new Date().toISOString() };
      if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 24);
      if (progress && typeof progress === 'object') patch.progress = progress;
      // Ask for the row back. Row level security refuses another family's row by
      // matching NOTHING rather than by erroring, so a 200 with an empty array is
      // a refused write. Reporting that as success would lose a child's progress
      // silently, which is the worst way to lose it.
      const r = await supa(`/rest/v1/child?id=eq.${m[1]}`, { method: 'PATCH', token: bearer,
        headers: { Prefer: 'return=representation' }, body: patch });
      if (!r.ok) return json(res, 502, { error: 'Could not save.', detail: r.body });
      if (!Array.isArray(r.json) || r.json.length === 0) {
        return json(res, 404, { error: 'That child is not on this account.' });
      }
      return json(res, 200, { saved: true, updated_at: r.json[0].updated_at });
    }
    if (m && req.method === 'DELETE') {
      const r = await supa(`/rest/v1/child?id=eq.${m[1]}`, { method: 'DELETE', token: bearer });
      return json(res, r.ok ? 200 : 502, r.ok ? { removed: true } : { error: 'Could not remove.' });
    }

    return json(res, 404, { error: 'not found' });
  }

  if (url.pathname === '/api/status') {
    return json(res, 200, { ai: Boolean(API_KEY), provider: PROVIDER, model: API_KEY ? MODEL : null });
  }

  if (req.method === 'POST' && url.pathname === '/api/diagnose') {
    try {
      const { problem: rawProblem, problemId, built, answer, trace } = await readBody(req);
      const problem = rawProblem ? hydrate(rawProblem) : problemById(problemId);
      if (!problem) return json(res, 400, { error: 'unknown problem' });
      const rule = diagnose(problem, built, answer, trace);
      if (!API_KEY) return json(res, 200, rule);
      // The rule engine is CERTAIN about a correct answer — the equation
      // canonicalises to the right shape and the arithmetic checks out. A model
      // call here would only rephrase "well done" while a child waits. The client
      // short-circuits this too; this guard is so no caller can spend tokens
      // confirming something already known.
      if (rule.correct) return json(res, 200, rule);
      // An arithmetic slip is equally certain: the equation matched, the sum did
      // not. The client draws the sum instead of asking for words about it.
      if (rule.misconception === 'computation-slip') return json(res, 200, rule);
      try {
        const ai = await aiDiagnose(problem, built, answer, trace, rule);
        // The rule engine is authoritative on whether the equation matches; the
        // model is authoritative on how to talk about it.
        return json(res, 200, { ...ai, correct: rule.correct, ruleGuess: rule.misconception, expected: rule.expected });
      } catch (e) {
        console.error('[ai diagnose failed, using rules]', e.message);
        return json(res, 200, { ...rule, aiError: e.message });
      }
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/practice') {
    try {
      const { problem: rawProblem, problemId, misconception, count = 3 } = await readBody(req);
      const problem = rawProblem ? hydrate(rawProblem) : problemById(problemId);
      if (!problem) return json(res, 400, { error: 'unknown problem' });
      if (API_KEY) {
        try {
          const ai = await aiPractice(problem, misconception, count);
          if (ai.length) return json(res, 200, { source: 'claude', problems: ai });
        } catch (e) {
          console.error('[ai practice failed, using rules]', e.message);
        }
      }
      return json(res, 200, { source: 'rules', problems: generatePractice(problem, misconception, count) });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/word') {
    try {
      const { word, sentence, problemId, problem: rawProblem } = await readBody(req);
      const fallback = lookupWord(word, sentence);
      if (!API_KEY || !word) return json(res, 200, fallback);
      const problem = rawProblem ? hydrate(rawProblem) : problemById(problemId);
      try {
        const out = await callModel({
          system: WORD_SYSTEM,
          user: `STORY THE CHILD IS READING:\n${problem ? problem.plainText : sentence || '(unknown)'}\n\nTHE WORD THEY TAPPED: "${word}"\n\nExplain just that word.`,
          schema: WORD_SCHEMA, name: WORD_NAME
        });
        return json(res, 200, {
          word, emoji: out.emoji || fallback.emoji,
          meaning: out.meaning, inStory: out.inStory, note: out.note || '',
          kind: fallback.kind, source: 'claude'
        });
      } catch (e) {
        console.error('[ai word failed, using dictionary]', e.message);
        return json(res, 200, fallback);
      }
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/start-hint') {
    try {
      const { problemId, problem: rawProblem, step = 0 } = await readBody(req);
      const i = Math.min(Number(step) || 0, START_LADDER.length - 1);
      const fallback = { ...START_LADDER[i], step: i, last: i >= START_LADDER.length - 1, source: 'rules' };
      if (!API_KEY) return json(res, 200, fallback);
      const problem = rawProblem ? hydrate(rawProblem) : problemById(problemId);
      if (!problem) return json(res, 200, fallback);
      try {
        const focus = ['what the question is actually asking them to find',
                       'what each number in the story is counting',
                       'picturing or drawing what is happening'][i];
        const out = await callModel({
          system: START_SYSTEM,
          user: `WORD PROBLEM:\n${problem.plainText}\n\nNumbers and what they mean:\n${problem.quantities.map(q => `  ${q.value} = ${q.label}`).join('\n')}\n\nThis is nudge number ${i + 1} of 3. Focus this nudge on ${focus}.`,
          schema: START_SCHEMA, name: START_NAME
        });
        return json(res, 200, { emoji: out.emoji || fallback.emoji, text: out.say, step: i, last: fallback.last, source: 'claude' });
      } catch (e) {
        console.error('[ai start-hint failed, using ladder]', e.message);
        return json(res, 200, fallback);
      }
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/say') {
    try {
      const { problem: rawProblem, problemId, message = '', intent = null,
              history = [], trace = [], startStep = 0 } = await readBody(req);
      const problem = rawProblem ? hydrate(rawProblem) : problemById(problemId);
      if (!API_KEY || !problem) return json(res, 200, { offline: true });

      const convo = (Array.isArray(history) ? history : []).slice(-14)
        .map(m => `${m.who === 'kid' ? 'CHILD' : 'PIP'}: ${String(m.text || '').slice(0, 400)}`)
        .join('\n') || '(nothing yet)';

      const askedFor = intent === 'word'
        ? `The child TAPPED the word "${message}" in the story. Explain that word here, relationship first.`
        : intent === 'start'
          ? `The child pressed "Where do I start?". Give scaffold rung ${Math.min(Number(startStep) + 1, 3)} and nothing more.`
          : `The child typed this into the chat: "${message}". Work out what they mean from the conversation and respond to it.`;

      const user = `WORD PROBLEM THE CHILD IS LOOKING AT:
${problem.plainText}

Numbers in the story and what each one counts:
${problem.quantities.map(q => `  ${q.value} = ${q.label}`).join('\n')}

CONVERSATION SO FAR:
${convo}

WHAT JUST HAPPENED: ${askedFor}

Scaffold rungs already given: ${Number(startStep) || 0} of 3.`;

      try {
        const out = await callModel({ system: SAY_SYSTEM, user, schema: SAY_SCHEMA, name: SAY_NAME });
        return json(res, 200, { ...out, source: PROVIDER });
      } catch (e) {
        console.error('[ai say failed, client will fall back]', e.message);
        return json(res, 200, { offline: true, error: e.message });
      }
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // static
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

// The most common "I restarted but nothing changed" cause: the OLD process is
// still holding the port, the new one dies, and the browser keeps talking to
// the old build. Say so in words instead of a stack trace.
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — an older MathQuest server is still running.`);
    console.error('  That old process does NOT have your .env loaded, which is why nothing changed.');
    console.error(`\n  Stop it, then start again:`);
    console.error(`      lsof -ti tcp:${PORT} | xargs kill`);
    console.error('      npm start\n');
    process.exit(1);
  }
  throw err;
});

// 0.0.0.0 so a container platform can reach it — the default binding works on a
// laptop and silently fails to accept traffic on some hosts.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  MathQuest  →  http://localhost:${PORT}`);
  if (API_KEY) {
    console.log(`  AI layer:  ${AI.label} (${MODEL}) — testing…`);
    callModel({
      system: 'You are a test harness. Answer exactly as asked.',
      user: 'Reply with the single word: pong',
      schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] },
      name: 'ping'
    }).then(() => console.log(`  AI layer:  LIVE ✓  ${AI.label} answered.\n`))
      .catch(e => {
        console.log(`  AI layer:  FAILED ✗  falling back to the offline engines.`);
        console.log(`             ${String(e.message || e)}\n`);
      });
  } else {
    console.log('  AI layer:  offline engines only. To go live, put ONE of these in .env:');
    for (const p of Object.values(PROVIDERS)) console.log(`               ${p.hint}`);
    console.log('');
  }
});

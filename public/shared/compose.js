// A puzzle a child dictated, checked for the things a model should not be trusted
// to get right on its own.
//
// The model's job is to listen to a child describe a puzzle, ask for whatever is
// missing, and write it down. What it must never do is quietly invent a number the
// child did not say, write a story with no question in it, or produce a puzzle whose
// answer is a fraction. Those are structural facts, checkable without a model, and
// checking them here means a bad composition becomes "let us try that again"
// instead of a puzzle a friend cannot solve.
//
// This runs in the browser AND on the server. The server's copy is the one that
// matters: see the note on minting in server.js for why the child's own words can
// travel now when the template builder's could not.

export const MAX_STORY = 260;
export const MIN_STORY = 20;

const CONTACT = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|@[a-z0-9]|\+?\d[\d\s().-]{8,})/i;
const NUM_RE = /\[\[(\d+)\|([^\]]{1,40})\]\]/g;

/** Strip the markup to what a child actually sees. */
export const plainOf = t => String(t || '').replace(/\[\[(\d+)\|[^\]]*\]\]/g, '$1');

/** Whole, non-negative, and small enough to be a child's answer. */
export function evaluate(eq) {
  const s = String(eq || '').replace(/×/g, 'x').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[\d+\-x/()]+$/.test(s) || !/\d/.test(s)) return null;
  if (s.length > 40) return null;
  let v;
  try { v = Function(`"use strict";return (${s.replace(/x/g, '*')})`)(); }
  catch { return null; }
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/**
 * Is this a puzzle another child could actually be handed?
 * Returns { ok } or { ok: false, why } — `why` is written for the CHILD, because
 * it is what Pip says next, not a log line.
 */
export function check({ text, correct }) {
  const t = String(text || '').trim();
  const plain = plainOf(t).trim();

  if (plain.length < MIN_STORY) return { ok: false, why: 'There is not enough story there yet.' };
  if (plain.length > MAX_STORY) return { ok: false, why: 'That story got very long — let us shorten it.' };
  if (CONTACT.test(plain)) return { ok: false, why: 'A puzzle cannot have links, emails or phone numbers in it.' };
  if (!/\?\s*$/.test(plain)) return { ok: false, why: 'It needs to end with a question.' };

  NUM_RE.lastIndex = 0;
  const marked = [...t.matchAll(NUM_RE)];
  if (marked.length < 2) return { ok: false, why: 'A puzzle needs at least two numbers in the story.' };
  if (marked.length > 4) return { ok: false, why: 'Four numbers is plenty for one puzzle.' };

  // Every digit a child can see must be a tappable number. An unmarked digit is
  // one the solver cannot use, which reads to them as the app being broken.
  const loose = plain.replace(/\d+/g, '#');
  const digitsInPlain = (plain.match(/\d+/g) || []).length;
  if (digitsInPlain !== marked.length)
    return { ok: false, why: 'Every number in the story has to be one your friend can tap.' };
  void loose;

  const answer = evaluate(correct);
  if (answer === null) return { ok: false, why: 'That answer is not something we can work out.' };
  if (!Number.isInteger(answer)) return { ok: false, why: 'The answer comes out as part of a number. Try different numbers.' };
  if (answer < 0) return { ok: false, why: 'The answer comes out below zero. Try different numbers.' };
  if (answer > 100000) return { ok: false, why: 'That answer is enormous — try smaller numbers.' };

  // The model must not invent a number, and must not leave one lying unused: both
  // are the marks of a story and an equation that came apart from each other.
  const inStory = marked.map(m => m[1]);
  const used = String(correct).match(/\d+/g) || [];
  for (const n of used)
    if (!inStory.includes(n)) return { ok: false, why: `The answer uses ${n}, which is not in the story.` };
  if (new Set(used).size < 2) return { ok: false, why: 'The answer needs at least two different numbers.' };

  return { ok: true, answer };
}

/** Numbers and their labels, for the app's own hydrate(). */
export function quantitiesOf(text) {
  NUM_RE.lastIndex = 0;
  return [...String(text || '').matchAll(NUM_RE)].map((m, i) => ({ value: Number(m[1]), label: m[2], qid: i }));
}

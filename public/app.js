import { allProblems, problemsFor, bandsFor, bandOfProblem, diagnose, hydrate, problemById, safeEval, CONCEPTS, MISCONCEPTIONS } from '/shared/engine.js';
import { Sound, confetti, flyChip, pulse, Pip } from '/juice.js';
import { Speech } from '/speech.js';
import { lookupWord, START_LADDER } from '/shared/dictionary.js';
import * as Profiles from '/shared/profiles.js';
import * as Cloud from '/cloud.js';
import * as Share from '/shared/share.js';
import * as Insight from '/shared/insight.js';
import * as Compose from '/shared/compose.js';
import { canExplain, mountExplainer, canShowSituation, mountSituation } from '/mathviz.js';
import {
  MAP_POS, MAP_ROWS, PREREQS, bandKey, bandStat, bandStars, nextStar,
  worldStars, worldMaxStars, worldSolved, worldUnlocked, bandUnlocked, lockReason,
  openBands, recommendedBand, recommendedWorld, totalStars, maxStars, migrate,
  testedOut, markTestedOut, easierBand, TEST_OUT_REQUIRED
} from '/shared/progress.js';

const $ = id => document.getElementById(id);
const DISPLAY = { '+': '+', '-': '−', 'x': '×', '/': '÷', '(': '(', ')': ')' };
const today = () => new Date().toISOString().slice(0, 10);
const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3 6.3 6.9.9-5 4.8 1.2 6.9L12 17.6 5.9 20.9 7.1 14l-5-4.8 6.9-.9z"/></svg>';
const stars3 = n => [0, 1, 2].map(i => `<span class="${i < n ? '' : 'star-off'}">${STAR}</span>`).join('');
const SPEAKER_ON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17.5 8.5a5 5 0 0 1 0 7"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 10l4 4M21 10l-4 4"/></svg>';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------- progression -------------------------------- */

// XP is still recorded for the grown-ups view; it is no longer shown to a child.
const XP = { firstTry: 12, afterRetry: 7, practice: 6, clearedMisconception: 20 };
const ORDER = Object.entries(CONCEPTS).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);

// Who is playing. On a shared laptop the second child must not inherit the
// first child's road, so progress is keyed per profile. Existing progress from
// before profiles existed is migrated into the first one, and the old key is
// left untouched in case anything here is wrong.
// A magic link arrives as a URL fragment. Consume it before anything else looks
// at the session, and scrub it from the address bar — a token in a URL gets
// copied, pasted and shared.
const arrivedByLink = Cloud.captureLinkFromUrl();
// Signing in can trigger one reload (adopting or pruning profiles changes what
// this page already read). Without remembering why we were here, the parent
// clicks a link in their email and lands on the star map wondering if it worked.
const WANT_PARENTS = 'mq.gotoParents';
if (arrivedByLink) { try { sessionStorage.setItem(WANT_PARENTS, '1'); } catch {} }
function wantedParents() {
  try {
    if (sessionStorage.getItem(WANT_PARENTS) !== '1') return false;
    sessionStorage.removeItem(WANT_PARENTS);
    return true;
  } catch { return false; }
}
const ME = Profiles.ensureProfile('Player 1');
const RECENT_KEEP = 150;

/**
 * The three numbers a friend is allowed to see, kept in the progress blob so the
 * database can read them without being handed the whole record. `friends_of()`
 * reads exactly these and nothing else — so what a friend can learn is decided
 * here and in the function signature, not by whatever happens to be in scope.
 */
function refreshTotals() {
  P.totals = {
    solved: Object.values(P.bands || {}).reduce((n, b) => n + (b.solved || 0), 0),
    stars: totalStars(P, ORDER),
    planets: ORDER.filter(k => worldUnlocked(P, k)).length
  };
}

function save() {
  refreshTotals();
  P.updatedAt = Date.now();
  Profiles.saveProgress(ME.id, P);
  cloudPush();
}

const blankProgress = () => ({
  xp: 0, streakDays: 0, bestStreak: 0, lastPlayed: null,
  concepts: {}, bands: null, testedOut: {}, solvedIds: [], misconceptions: {},
  totals: { solved: 0, stars: 0, planets: 0 },  // the three numbers a friend may see
  recent: [],     // ids of the last puzzles solved, so friends can be matched on them
  history: [],    // one summarised record per problem — how they worked, never what they wrote
  liked: [],      // puzzle ids this child gave a heart to
  friends: []     // names of people whose puzzles they have opened: [{name, seen}]
});
// migrate() folds progress saved before stars moved to difficulty levels into
// each world's first level, so nobody gets locked out of what they already earned.
const P = migrate(Object.assign(blankProgress(), Profiles.loadProgress(ME.id)));

const state = {
  ai: false, world: null,
  queue: [], current: null,
  eq: [], trace: [], chat: [],
  attempts: 0, usedHelp: false, startStep: 0,
  lastDiag: null, lastMisconception: null,
  mode: 'main', practiceQueue: [], practiceTarget: null, solvedInRound: 0,
  combo: 0, wordMode: false, listening: null, recorded: false,
  band: null,           // the difficulty level currently being played
  challenge: null,      // { left, failed } while testing out of a locked level
  runWrong: 0, runSlips: 0   // how this visit to a level is going
};


const conceptStat = c => (P.concepts[c] ||= { solved: 0, firstTry: 0 });
const statFor = (c, bandId) => ((P.bands ||= {})[bandKey(c, bandId)] ||= { solved: 0, firstTry: 0 });

// The rules themselves live in shared/progress.js so they can be simulated in a
// test rather than clicked through. These are just the local bindings.
const stars = c => worldStars(P, c);
const unlocked = c => worldUnlocked(P, c);
const currentWorld = () => recommendedWorld(P, ORDER);

// XP still accrues — the grown-ups view will want it — but a child never sees it.
// One currency on screen, and it is the star.
function awardXp(n) { P.xp += n; save(); }

// Kept recording, no longer shown. Streaks work by making you feel bad for
// breaking one, which is a poor thing to put in front of a seven-year-old, and
// they reward showing up rather than thinking well. The numbers stay for the
// grown-ups view, where "played on 9 of the last 14 days" is useful context.
function touchStreak() {
  const t = today();
  if (P.lastPlayed === t) return;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  P.streakDays = P.lastPlayed === y ? P.streakDays + 1 : 1;
  P.bestStreak = Math.max(P.bestStreak, P.streakDays);
  P.lastPlayed = t; save();
}

/* --------------------------------- bootstrap -------------------------------- */

function makeStars(n = 70) {
  const sky = $('scenery');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const st = document.createElement('i');
    st.className = 'skystar';
    const size = Math.random() < 0.82 ? 1.6 : 2.6;
    st.style.cssText = `left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;` +
      `width:${size}px;height:${size}px;animation-delay:${(Math.random() * 4).toFixed(2)}s;opacity:${(0.25 + Math.random() * 0.6).toFixed(2)}`;
    frag.appendChild(st);
  }
  sky.appendChild(frag);
}

async function boot() {
  makeStars();
  Pip.mount($('pip'), $('pipHome'), $('pipMake'), $('pipSocial'));
  renderHeader();
  if (!Speech.canSpeak) $('readBtn').classList.add('hidden');
  if (Speech.canListen) $('micBtn').classList.remove('hidden');
  // Talking is shown on the message that is being read and on the button. It must
  // NOT touch Pip's expression — the app already chose one (curious for a
  // question, cheer for a win) and speaking should not overwrite it.
  Speech.onstate = talking => {
    $('readBtn').classList.toggle('speaking', talking);
    Pip.mod('talking', talking);
    const last = [...$('chatlog').querySelectorAll('.msg.m-pip')].pop();
    document.querySelectorAll('.msg.speaking').forEach(m => m.classList.remove('speaking'));
    if (talking && last) last.classList.add('speaking');
  };
  try { state.ai = (await (await fetch('/api/status')).json()).ai; } catch {}
  showRoad();

  // A puzzle sent by a friend jumps the queue: that link is the reason they
  // opened the app, so it should not land them on the map to go hunting.
  const sent = puzzleFromLink() || await toldPuzzleFromLink();
  if (sent && sent.bad) {
    setTimeout(() => { $('heroMsg').textContent = sent.bad; }, 50);
  } else if (sent && sent.problem) {
    state.world = sent.problem.concept;
    state.band = bandsFor(state.world)[0];
    state.mode = 'main';
    state.queue = [];
    $('roadScreen').classList.add('hidden');
    $('playScreen').classList.remove('hidden'); $('tabs').classList.add('hidden');
    $('homeBtn').classList.remove('hidden');
    loadProblem(sent.problem);
  }

  // Anything to do with the account happens AFTER the game is on screen, and
  // never blocks it. A parent signing in on a new phone gets their children
  // pulled down; a device that has been away gets the newer progress. If any of
  // it fails, the child is already playing and will not notice.
  if (Cloud.signedIn()) {
    try {
      const { added, touchedActive } = await cloudMergeDown();
      // A device seeing this account for the first time has an empty placeholder
      // profile from boot. Once the real children are down, it is a duplicate.
      const pruned = added ? Profiles.pruneAuto() : 0;
      // Either the child on screen was replaced by the account's copy, or the
      // profile list changed underneath us. `ME` and `P` were both read before
      // any of that, so the honest move is one reload rather than patching
      // half the app's state and hoping. It cannot loop: after the reload there
      // is nothing left to adopt or prune.
      if (pruned || touchedActive) { location.reload(); return; }
      await cloudPull();
      // Down first, then up: merging adopts a local child by name, so pushing
      // first would create a second copy of a child the account already has.
      const sent = await cloudPushUp();
      if (added || sent) renderRoad();
    } catch { /* the game does not depend on this */ }
  }
  // They clicked a link in their email; show them the page that link was for,
  // even if a reload happened in between.
  if (wantedParents()) { openGate(); showParents(); }
}

function renderHeader() {
  // Set here, not only when the picker opens — otherwise the header keeps the
  // previous child's name while the next child is already playing.
  $('whoName').textContent = ME.name;
  $('starCount').textContent = totalStars(P, ORDER);
  // The streak's flame needed explaining, which is the same fault as a bare
  // number: say what it counts. There is room now the flame has gone.
  $('starMax').textContent = `/ ${maxStars(ORDER)} stars`;
  $('soundBtn').innerHTML = Sound.on ? SPEAKER_ON : SPEAKER_OFF;
  $('soundBtn').classList.toggle('off', !Sound.on);
}

/* ================================ SHARING ==================================== */
// A shared puzzle travels IN THE LINK: no row in a database, no account on either
// side. A child can send one to a friend who has never opened the app, and it
// works the moment it is deployed rather than after a sign-up flow.

function shareCurrent() {
  const p = state.current;
  if (!p) return;
  const code = p.authored
    ? Share.packAuthored({ text: p.text, correct: p.correct, name: ME.name })
    : Share.packExisting(p.id, ME.name);
  const url = Share.shareUrl(location.origin, code);
  $('shareTitle').textContent = p.authored ? 'Send your puzzle to a friend' : 'Send this puzzle to a friend';
  $('shareSub').textContent = p.authored
    ? 'They will see you made it.'
    : 'They get the same puzzle you just did.';
  $('shareLink').value = url;
  $('shareModal').classList.remove('hidden');
  track('share', p.id);
}

$('shareCopy').onclick = async () => {
  const el = $('shareLink');
  el.select();
  try { await navigator.clipboard.writeText(el.value); $('shareCopy').textContent = 'Copied'; }
  catch { document.execCommand && document.execCommand('copy'); $('shareCopy').textContent = 'Copied'; }
  setTimeout(() => { $('shareCopy').textContent = 'Copy the link'; }, 1800);
};
$('shareDone').onclick = () => $('shareModal').classList.add('hidden');

/** Someone sent a puzzle. Returns the problem to play, or null. */
/**
 * A `?q=` link carries a puzzle a child DICTATED, so it carries their own words —
 * and a link carrying words is a link that can be edited by hand. The server signed
 * it when it was made and is the only thing that can tell. So this one asks, rather
 * than unpacking locally like `?p=` does.
 */
async function toldPuzzleFromLink() {
  const code = new URLSearchParams(location.search).get('q');
  if (!code) return null;
  history.replaceState(null, '', location.pathname);
  try {
    const res = await fetch('/api/puzzle/open', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const j = await res.json();
    if (!res.ok || !j.text) return { bad: j.error || 'That link has been changed or is damaged.' };
    if (j.from) rememberFriend(j.from);
    return {
      problem: hydrate({ id: 'told-' + Math.random().toString(36).slice(2, 8),
                         concept: 'add-join', authored: true, from: j.from,
                         text: j.text, correct: j.correct, accept: [], traps: {} }),
      from: j.from
    };
  } catch {
    return { bad: 'I could not open that link — are you online?' };
  }
}

function puzzleFromLink() {
  const code = new URLSearchParams(location.search).get('p');
  if (!code) return null;
  history.replaceState(null, '', location.pathname);   // so a reload is not a loop
  const got = Share.unpack(code);
  if (!got) return { bad: 'That link is damaged — ask your friend to send it again.' };
  if (got.kind === 'rejected') return { bad: got.why };
  if (got.from) rememberFriend(got.from);

  if (got.kind === 'existing') {
    const p = problemById(got.id);
    return p ? { problem: { ...p, from: got.from }, from: got.from } : { bad: 'That puzzle is from a newer version of the game.' };
  }
  // A child built this one out of a known shape, so it arrives with a real trap
  // table: a friend who adds when they should multiply gets told what they did,
  // on a puzzle their friend invented. Free prose could never have done that.
  const raw = { id: 'shared-' + Math.random().toString(36).slice(2, 8),
                authored: true, from: got.from, ...got.problem };
  return { problem: hydrate(raw), from: got.from };
}

function rememberFriend(name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return;
  P.friends = P.friends || [];
  const f = P.friends.find(x => x.name.toLowerCase() === clean.toLowerCase());
  if (f) f.seen = Date.now(); else P.friends.push({ name: clean, seen: Date.now() });
  save();
}

/* --------------------------------- likes ------------------------------------ */
// A heart is a nudge, not a score: it says "this one was good", which is what a
// child actually wants to tell a friend, and it costs nothing to be wrong about.

// A liked puzzle has to be REBUILDABLE later, and a generated id is enough for
// that while a friend's puzzle is not: "told-9f3a" means nothing tomorrow. So a
// like stores whatever it takes to bring the puzzle back — an id for ours, the
// story itself for one a person wrote. Older saves are a plain array of ids and
// are read as such.
const likedList = () => (P.liked || []).map(e => (typeof e === 'string' ? { id: e } : e)).filter(e => e && e.id);
const isLiked = id => likedList().some(e => e.id === id);

function toggleLike(p) {
  const entry = typeof p === 'string' ? { id: p } : p;
  P.liked = likedList();
  const i = P.liked.findIndex(e => e.id === entry.id);
  if (i >= 0) P.liked.splice(i, 1);
  else {
    P.liked.push(entry.authored
      ? { id: entry.id, text: entry.text, correct: entry.correct, from: entry.from || '', authored: true }
      : { id: entry.id });
    Sound.star();
  }
  save();
  return isLiked(entry.id);
}

/** Bring a liked puzzle back, whoever made it. */
function likedProblem(e) {
  if (e.authored && e.text && e.correct)
    return hydrate({ id: e.id, authored: true, from: e.from || '', concept: 'add-join',
                     text: e.text, correct: e.correct, accept: [], traps: {} });
  return problemById(e.id);
}

/* ============================= PUZZLE MAKER =================================== */
// A child builds a puzzle out of a SHAPE, words chosen from fixed lists and two
// numbers. They never type prose, so the link cannot carry any — see the note at
// the top of shared/authoring.js for why that is the whole point rather than a
// limitation. What is left for the child is the part that actually teaches:
// deciding whether this is a grouping or a joining, and picking numbers that make
// it worth solving.

/* --------------------------- telling Pip the puzzle --------------------------- */
// A seven-year-old does not hand you a finished word problem. He says "mum bought
// two boxes of ice creams" and stops, and the puzzle arrives over four or five
// turns of someone asking the next question. That conversation IS the thing worth
// building: composing a word problem needs a deeper grasp of its structure than
// solving one does, and it is the part he could not wait to send to his friends.
//
// The one rule underneath the whole flow is that Pip never supplies a number the
// child did not say. A model asked to tidy up a half-told puzzle will happily
// invent the missing six, and the child will send their friends a puzzle that is
// not the one they made up.

const tell = { turns: [], puzzle: null, busy: false, listening: null };

function tellChat(who, text, { speak = true, cls = '' } = {}) {
  const log = $('tellLog');
  const el = document.createElement('div');
  el.className = `msg m-${who} ${cls}`.trim();    // same shape as the play-screen chat
  el.innerHTML = `<span class="b">${esc(text)}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  if (!cls) tell.turns.push({ who, text });
  if (who === 'pip' && speak && Sound.on) Speech.say(text);
  return el;
}

function tellReset(greet = true) {
  Speech.stop();
  tell.turns = []; tell.puzzle = null;
  $('tellLog').innerHTML = '';
  $('tellDone').classList.add('hidden');
  $('tellAgain').hidden = true;
  $('tellInput').value = '';
  if (greet) tellChat('pip', "Tell me a puzzle you have made up. You can say the whole thing, or just how it starts.");
}

async function tellSay(text) {
  const t = String(text || '').trim();
  if (!t || tell.busy) return;
  tellChat('kid', t);
  $('tellInput').value = '';
  $('tellAgain').hidden = false;
  tell.busy = true;
  Pip.set('think');
  const wait = tellChat('pip', 'Let me think…', { speak: false, cls: 'think' });

  let out = null;
  try {
    const res = await fetch('/api/compose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: t, history: tell.turns.slice(0, -1).slice(-20) })
    });
    if (res.ok) out = await res.json();
  } catch { /* handled below */ }
  wait.remove();
  tell.busy = false;
  Pip.set('idle');

  if (!out || out.offline) {
    // No model, no conversation — but say WHICH no. "I cannot listen just now" for
    // a rate limit, a missing key and a broken schema alike is how a live model
    // with a working key spent a day looking absent.
    if (out && out.error) console.error('[compose]', out.error, out.provider || '');
    const why = !out ? 'I could not reach the server.'
      : out.why === 'busy' ? 'A lot of people are talking to me at once.'
      : out.why === 'no-key' ? 'My talking is switched off in this copy of the app.'
      : 'Something went wrong at my end.';
    tellChat('pip', `${why} You can still build a puzzle with the picker instead.`);
    showBuilder(true, 'Pip cannot listen right now, so pick the shape, the words and the numbers instead.');
    return;
  }
  tellChat('pip', out.say || 'Tell me a bit more.');
  if (out.trouble && out.trouble !== 'none') {
    $('tellAgain').hidden = false;
  }
  if (out.ready && out.text && out.correct) {
    const v = Compose.check({ text: out.text, correct: out.correct });
    if (!v.ok) { tellChat('pip', `Hmm — ${v.why}`); return; }
    tell.puzzle = { text: out.text, correct: out.correct };
    $('tellPreview').innerHTML = storyHtml(hydrate({ ...tell.puzzle, id: 'preview' }));
    $('tellAnswer').innerHTML = `The answer is <b>${v.answer}</b>. Your friend has to work that out.`;
    $('tellDone').classList.remove('hidden');
    Sound.correct();
    Pip.flash('cheer', 1400, 'happy');
  }
}

$('tellGo').onclick = () => tellSay($('tellInput').value);
$('tellInput').addEventListener('keydown', e => { if (e.key === 'Enter') tellSay($('tellInput').value); });
$('tellAgain').onclick = () => tellReset();
$('tellRedo').onclick = () => {
  $('tellDone').classList.add('hidden');
  tellChat('pip', 'No problem — what should be different?');
};

function tellListen(btn) {
  if (tell.listening) { tell.listening(); tell.listening = null; btn.classList.remove('listening'); Pip.set('idle'); return; }
  Speech.stop();
  btn.classList.add('listening');
  Pip.set('listen');
  tell.listening = Speech.listen({
    onResult: t => tellSay(t),
    onEnd: () => { btn.classList.remove('listening'); tell.listening = null; if (Pip.state === 'listen') Pip.set('idle'); },
    onError: () => { btn.classList.remove('listening'); tell.listening = null; Pip.set('oops');
                     tellChat('pip', 'I could not hear that. You can type it instead.'); }
  });
}
$('tellMic').onclick = e => tellListen(e.currentTarget);
$('tellMicBig').onclick = e => tellListen(e.currentTarget);

$('tellTry').onclick = () => {
  if (!tell.puzzle) return;
  playAuthored({ ...tell.puzzle, mine: true });
};

$('tellSend').onclick = async () => {
  if (!tell.puzzle) return;
  const btn = $('tellSend');
  btn.disabled = true; btn.textContent = 'Getting it ready…';
  try {
    const res = await fetch('/api/puzzle/mint', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...tell.puzzle, name: ME.name })
    });
    const j = await res.json();
    if (!res.ok || !j.code) throw new Error(j.error || 'could not make the link');
    $('shareTitle').textContent = 'Your puzzle is ready';
    $('shareSub').textContent = 'Send this link and your friend can play it straight away.';
    $('shareLink').value = `${location.origin}/?q=${j.code}`;
    $('shareModal').classList.remove('hidden');
    track('share-told');
  } catch (e) {
    tellChat('pip', 'I could not make the link just now. Try again in a moment.');
  }
  btn.disabled = false; btn.textContent = 'Send it to a friend';
};

/** Play a puzzle that came from a person rather than from the generator. */
function playAuthored(raw) {
  const p = hydrate({ id: 'made-' + Math.random().toString(36).slice(2, 8), authored: true, ...raw });
  state.world = p.concept || 'add-join';
  state.band = bandsFor(state.world)[0];
  state.mode = 'main';
  state.queue = [];
  $('makeScreen').classList.add('hidden');
  $('playScreen').classList.remove('hidden'); $('tabs').classList.add('hidden');
  $('homeBtn').classList.remove('hidden');
  loadProblem(p);
}

/** Swap between telling it and building it. */
function showBuilder(on, why = '') {
  $('tellCard').classList.toggle('hidden', on);
  $('buildIntro').classList.toggle('hidden', !on);
  for (const el of document.querySelectorAll('.buildstep')) el.classList.toggle('hidden', !on);
  if (why) $('buildWhy').textContent = why;
  if (on) { buildPickers(); renderMake(); }
}
$('tellSwitch').onclick = () => showBuilder(true);
$('buildSwitch').onclick = () => showBuilder(false);

const mk = { shape: 3, who: 0, who2: 1, thing: 0, a: 4, b: 6 };

function showMake() {
  Speech.stop();
  $('roadScreen').classList.add('hidden');
  $('playScreen').classList.add('hidden');
  $('parentScreen').classList.add('hidden');
  $('makeScreen').classList.remove('hidden');
  $('tabs').classList.add('hidden');
  $('homeBtn').classList.add('hidden');
  document.documentElement.style.removeProperty('--world');
  Pip.set('idle');
  // With no model there is no one to talk to, so the builder is not a fallback —
  // it is the whole feature, and saying so is better than an input that does nothing.
  showBuilder(!state.ai, state.ai ? '' : 'Pip cannot listen right now, so pick the shape, the words and the numbers instead.');
  if (state.ai) tellReset();
  $('tellMic').classList.toggle('hidden', !Speech.canListen);
  $('tellMicBig').classList.toggle('hidden', !Speech.canListen);
}

function buildPickers() {
  $('makeShapes').innerHTML = Share.SHAPE.map((s, i) =>
    `<button class="shape ${i === mk.shape ? 'on' : ''}" data-shape="${i}">
       <b>${esc(s.label)}</b><small>${esc(s.hint)}</small></button>`).join('');
  const chips = (list, sel, attr) => list.map((w, i) =>
    `<button class="pick ${i === sel ? 'on' : ''}" data-${attr}="${i}">${esc(w)}</button>`).join('');
  $('pickWho').innerHTML   = chips(Share.WHO, mk.who, 'who');
  $('pickWho2').innerHTML  = chips(Share.WHO, mk.who2, 'who2');
  $('pickThing').innerHTML = chips(Share.THING.map(t => t.many), mk.thing, 'thing');
}

function renderMake() {
  const s = Share.SHAPE[mk.shape];
  for (const b of document.querySelectorAll('[data-shape]'))
    b.classList.toggle('on', Number(b.dataset.shape) === mk.shape);
  for (const [attr, val] of [['who', mk.who], ['who2', mk.who2], ['thing', mk.thing]])
    for (const b of document.querySelectorAll(`[data-${attr}]`))
      b.classList.toggle('on', Number(b.dataset[attr]) === val);
  $('pickWho2Row').classList.toggle('hidden', s.id !== 'compare');

  // The numbers are named by what they MEAN in this shape — "how many boxes" and
  // "in each box", not "first" and "second". That naming is the lesson.
  $('labA').textContent = s.aName;
  $('labB').textContent = s.bName;
  $('numA').value = mk.a;
  $('numB').value = mk.b;

  const v = Share.validate(mk);
  const p = v.ok ? Share.compose(mk) : null;
  $('makePreview').innerHTML = p
    ? storyHtml(hydrate(p))
    : '<span class="muted">Fix the bit below and your puzzle appears here.</span>';
  $('makeAnswer').innerHTML = p ? `The answer is <b>${safeEval(p.correct)}</b>.` : '';
  $('makeWhy').textContent = v.ok ? 'Ready to send.' : v.why;
  $('makeWhy').classList.toggle('good', v.ok);
  $('makeSend').disabled = !v.ok;
  $('makeTry').disabled = !v.ok;
}

/** The story with its numbers highlighted, read-only — this is a preview, not a game. */
function storyHtml(p) {
  return p.tokens.map(t => t.type === 'num'
    ? `<span class="num" style="cursor:default">${t.value}</span>`
    : esc(t.value)).join('');
}

$('makeShapes').addEventListener('click', e => {
  const b = e.target.closest('[data-shape]'); if (!b) return;
  mk.shape = Number(b.dataset.shape);
  Sound.operator();
  // A shape change can strand the numbers (9 given away out of 4). Nudge rather
  // than shout: a child who has to fix an error they did not make will not make
  // a second puzzle.
  const s = Share.SHAPE[mk.shape];
  if (s.bMax === 'a' && mk.b >= mk.a) mk.b = Math.max(1, mk.a - 1);
  if (s.exact && mk.a % mk.b !== 0) mk.a = mk.b * Math.max(2, Math.round(mk.a / mk.b));
  if (s.id === 'groups' && (mk.a === 1 || mk.b === 1)) { mk.a = Math.max(2, mk.a); mk.b = Math.max(2, mk.b); }
  renderMake();
});
for (const [id, key] of [['pickWho', 'who'], ['pickWho2', 'who2'], ['pickThing', 'thing']])
  $(id).addEventListener('click', e => {
    const b = e.target.closest(`[data-${key}]`); if (!b) return;
    mk[key] = Number(b.dataset[key]); Sound.number(); renderMake();
  });

const clampNum = n => Math.max(1, Math.min(Share.MAX_NUM || 100, Math.round(n) || 1));
$('numA').addEventListener('input', () => { mk.a = clampNum(Number($('numA').value)); renderMake(); });
$('numB').addEventListener('input', () => { mk.b = clampNum(Number($('numB').value)); renderMake(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-step]'); if (!b) return;
  const [which, dir] = [b.dataset.step[0], b.dataset.step[1]];
  mk[which] = clampNum(mk[which] + (dir === '+' ? 1 : -1));
  Sound.number(); renderMake();
});

$('makeBtn').onclick = () => { track('make-open'); showMake(); };
$('makeBack').onclick = showRoad;

function madeProblem(extra = {}) {
  const p = Share.compose(mk);
  return hydrate({ id: 'made-' + Math.random().toString(36).slice(2, 8),
                   authored: true, ...p, ...extra });
}

$('makeTry').onclick = () => playAuthored({ ...Share.compose(mk), mine: true });

$('makeSend').onclick = () => {
  const url = Share.shareUrl(location.origin, Share.packBuilt(mk, ME.name));
  $('shareTitle').textContent = 'Your puzzle is ready';
  $('shareSub').textContent = 'Send this link and your friend can play it straight away.';
  $('shareLink').value = url;
  $('shareModal').classList.remove('hidden');
  track('share-made');
};

/* -------------------------------- friends ----------------------------------- */
// "Friends" here means the children who have actually sent you a puzzle. There is
// no server-side graph, no requests to accept, and nothing for an adult to
// moderate: a name appears because a link arrived, and it can be forgotten.

// A heart is only worth having if it leads somewhere. The puzzles a child liked
// come back as one-tap "send this one" chips, which is scenario 1 without asking
// them to find the puzzle again.
function renderLiked() {
  const el = $('likedList');
  const found = likedList().slice(-8).reverse().map(likedProblem).filter(Boolean);
  if (!found.length) {
    el.innerHTML = '<span class="muted">Nothing here yet.</span>';
    return;
  }
  el.innerHTML = found.map(p =>
    `<button class="likedchip" data-send="${esc(p.id)}">
       <span>${esc(p.plainText.slice(0, 58))}${p.plainText.length > 58 ? '…' : ''}</span>
       <b>Send →</b></button>`).join('');
}
$('likedList').addEventListener('click', async e => {
  const b = e.target.closest('[data-send]');
  if (!b) return;
  const entry = likedList().find(x => x.id === b.dataset.send);
  if (!entry) return;
  $('shareTitle').textContent = 'Send this puzzle to a friend';
  $('shareSub').textContent = 'One you liked — they get exactly the same one.';
  if (entry.authored) {
    // Someone's own words, so it goes back through the server to be signed —
    // passing on a puzzle is minting a new link, not forwarding an old one.
    b.disabled = true;
    try {
      const res = await fetch('/api/puzzle/mint', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: entry.text, correct: entry.correct, name: ME.name })
      });
      const j = await res.json();
      if (!res.ok || !j.code) throw new Error();
      $('shareLink').value = `${location.origin}/?q=${j.code}`;
    } catch {
      b.disabled = false;
      return;
    }
    b.disabled = false;
  } else {
    $('shareLink').value = Share.shareUrl(location.origin, Share.packExisting(entry.id, ME.name));
  }
  $('shareModal').classList.remove('hidden');
  track('share-liked', entry.id);
});

// Friending is mutual and lives on the account, so it needs a signed-in parent.
// Two children swap codes; each one asks, and a friendship exists only once both
// sides have. Nobody can be searched for: a code is the whole way in, and it only
// ever buys one request that still has to be said yes to.

let friendCache = [];

// A failed friends call, with the database's own sentence under it. That second
// line is not for a parent — it is for whoever is fixing this at 1am, and it is
// the difference between "could not" and knowing which of six things broke.
function friendFailHtml(fallback) {
  const msg = esc(Cloud.lastFriendError || fallback);
  const detail = Cloud.lastFriendDetail
    ? `<br><small class="muted" style="word-break:break-word">${esc(Cloud.lastFriendDetail)}</small>` : '';
  return `<p class="pnote bad">${msg}${detail}</p>`;
}

async function renderFriends() {
  const el = $('friendList');
  const intro = $('friendIntro');

  if (!Cloud.signedIn() || !ME.remote) {
    $('myCode').textContent = '';
    $('askFriend').classList.add('hidden');
    intro.textContent = 'Friends need a grown-up to sign in first, because a friend list belongs to the account rather than to this laptop.';
    // Names picked up from puzzle links still mean something, so they are still shown.
    const seen = (P.friends || []).slice().sort((a, b) => b.seen - a.seen);
    el.innerHTML = seen.length
      ? `<p class="pnote">People who have sent you a puzzle:</p>` + seen.map(f =>
          `<span class="friend"><b>${esc(f.name)}</b></span>`).join('')
      : '<span class="muted">Nobody yet.</span>';
    return;
  }

  $('askFriend').classList.remove('hidden');
  intro.textContent = 'Swap codes with a friend and you can see how each other is getting on. Both of you have to say yes.';

  const code = await Cloud.friendCode(ME.remote);
  $('myCode').innerHTML = code
    ? `Your code: <b>${esc(code)}</b>`
    : friendFailHtml('No code yet.');

  const list = await Cloud.friends(ME.remote);
  if (list === null) {
    el.innerHTML = friendFailHtml('Could not load your friends just now.');
    return;
  }
  friendCache = list;

  if (!list.length) {
    el.innerHTML = '<span class="muted">No friends yet. Tell someone your code, and type theirs in above.</span>';
    return;
  }

  const card = f => {
    const waiting = f.status === 'pending';
    const theirMove = waiting && f.direction === 'out';
    return `<div class="friendcard ${waiting ? 'waiting' : ''}">
      <div class="fcname"><b>${esc(f.name)}</b>${waiting
        ? `<span class="fctag">${theirMove ? 'waiting for them' : 'wants to be friends'}</span>` : ''}</div>
      ${waiting ? '' : `<div class="fcnums">
        <span><b>${f.solved || 0}</b>solved</span>
        <span><b>${f.stars || 0}</b>stars</span>
        <span><b>${f.planets || 0}</b>planets</span>
      </div>`}
      <div class="fcbtns">
        ${waiting && !theirMove ? `<button class="primary" data-accept="${esc(f.child_id)}">Yes!</button>` : ''}
        <button class="ghost" data-unfriend="${esc(f.child_id)}">${waiting ? 'No thanks' : 'Remove'}</button>
      </div>
    </div>`;
  };
  el.innerHTML = list.map(card).join('');
}

$('friendAdd').onclick = async () => {
  const input = $('friendCodeIn'), msg = $('friendMsg');
  const code = input.value.trim();
  if (!code) return input.focus();
  msg.className = ''; msg.textContent = 'Asking…';
  const r = await Cloud.askFriend(ME.remote, code);
  if (!r.ok) { msg.className = 'bad'; msg.textContent = r.error; return; }
  input.value = '';
  msg.className = 'good';
  msg.textContent = r.status === 'accepted'
    ? `You and ${r.name} are friends!`             // they had already asked us
    : `Asked ${r.name}. They have to say yes too.`;
  renderFriends();
};
$('friendCodeIn').onkeydown = e => { if (e.key === 'Enter') $('friendAdd').click(); };

$('friendList').addEventListener('click', async e => {
  const yes = e.target.closest('[data-accept]');
  const no = e.target.closest('[data-unfriend]');
  if (yes) {
    yes.disabled = true;
    await Cloud.acceptFriend(ME.remote, yes.dataset.accept);
    Sound.star();
    // The last thing typed into the box has nothing to do with what just happened.
    $('friendMsg').textContent = ''; $('friendMsg').className = '';
    renderFriends();
    return;
  }
  if (no) {
    const f = friendCache.find(x => x.child_id === no.dataset.unfriend);
    if (f && f.status === 'accepted' && !confirm(`Remove ${f.name}?`)) return;
    no.disabled = true;
    await Cloud.removeFriend(ME.remote, no.dataset.unfriend);
    $('friendMsg').textContent = ''; $('friendMsg').className = '';
    renderFriends();
  }
});

/**
 * "Nia and Theo have done this one too."
 *
 * The single most motivating line in the app, and the one most easily turned into a
 * scoreboard. So it names friends who have ALSO solved it and never who solved it
 * first, never how fast, and never who has not. There is nothing here for a child
 * to be behind on.
 */
async function showFriendsWhoSolved(p) {
  const line = $('alsoSolved');
  if (!line) return;
  line.classList.add('hidden');
  if (!p || p.authored || !Cloud.signedIn() || !ME.remote) return;
  let names = [];
  try { names = await Cloud.friendsWhoSolved(ME.remote, p.id); } catch { return; }
  if (!names.length) return;
  // Still on the same problem? An answer that arrives after they have moved on
  // belongs to a puzzle that is no longer on screen.
  if (!state.current || state.current.id !== p.id) return;
  const list = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  line.innerHTML = `<span>👋</span><span>${esc(list)} ${names.length === 1 ? 'has' : 'have'} done this one too.</span>`;
  line.classList.remove('hidden');
}

/* ============================== WHO IS PLAYING ================================ */
// Switching child must be one tap from the header. After a switch the page is
// reloaded rather than patched: every module holds progress-derived state, and a
// reload is the one way to be certain none of the previous child's is left behind.

function renderWho() {
  const list = Profiles.listProfiles();
  $('whoList').innerHTML = list.map(p => {
    const prog = Profiles.loadProgress(p.id);
    const stars = prog && prog.bands
      ? Object.values(prog.bands).reduce((n, b) => n + (b.solved ? 1 : 0), 0) : 0;
    const solved = prog && prog.bands
      ? Object.values(prog.bands).reduce((n, b) => n + (b.solved || 0), 0) : 0;
    return `<button class="whoone ${p.id === ME.id ? 'on' : ''}" data-id="${p.id}">
      <span class="nm">${esc(p.name)}</span>
      <span class="st">${solved ? `${solved} solved` : 'not started'}</span>
      ${list.length > 1 && p.id !== ME.id ? `<span class="rm" data-remove="${p.id}" title="Remove">&times;</span>` : ''}
    </button>`;
  }).join('');

  $('whoList').querySelectorAll('.whoone').forEach(el => {
    el.onclick = e => {
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        e.stopPropagation();
        const p = Profiles.listProfiles().find(x => x.id === rm.dataset.remove);
        if (p && confirm(`Remove ${p.name}? Their stars and progress go too.`)) {
          Profiles.removeProfile(p.id); renderWho();
        }
        return;
      }
      if (el.dataset.id === ME.id) return;
      Profiles.selectProfile(el.dataset.id);
      location.reload();
    };
  });
}

/* ------------------------- the parent's account ----------------------------- */
// Optional throughout. Every path here fails soft: no account, no wifi, or an
// expired token all leave the game exactly as it is on this device.

let syncState = '';          // '', 'saving', 'saved', 'failed'
let pushTimer = null;

function renderSync() {
  const el = $('pSync');
  if (!el) return;
  el.textContent = syncState === 'saving' ? ' · saving…'
    : syncState === 'saved' ? ' · progress saved'
    : syncState === 'failed' ? ' · could not save — still safe on this device'
    : '';
  el.className = syncState === 'failed' ? 'bad' : '';
}

function cloudPush() {
  if (!Cloud.signedIn() || !ME.remote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    syncState = 'saving'; renderSync();
    const r = await Cloud.saveChild(ME.remote, { progress: P });
    // Refused because the account is ahead of us? Then we are the stale one, and
    // the right move is to take their copy rather than to keep pushing ours.
    if (r && r.stale) { adoptProgress(r.progress); syncState = 'saved'; renderSync(); return; }
    // A failed save is never reported as a save. The local copy is untouched
    // either way, so nothing is lost — but the parent gets told.
    syncState = (r && r.ok) ? 'saved' : 'failed'; renderSync();
  }, 1500);
}

/** Send now, not in 1.5 seconds. Used when the tab is about to go away. */
function cloudFlush() {
  if (!Cloud.signedIn() || !ME.remote || !pushTimer) return;
  clearTimeout(pushTimer); pushTimer = null;
  // keepalive lets the request outlive the page; a normal fetch would be killed
  // mid-flight and the last few answers would only exist on this device.
  Cloud.saveChild(ME.remote, { progress: P }, { keepalive: true });
}

// Device independence is not just "it uploads". A child who plays on the iPad and
// then picks up the laptop that has been open since breakfast needs the laptop to
// notice. So: flush when the tab goes away, pull when it comes back.
let lastPull = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cloudFlush(); return; }
  if (Date.now() - lastPull < 20000) return;    // tab-switching is not a sync event
  lastPull = Date.now();
  cloudPull().catch(() => {});
});
window.addEventListener('pagehide', cloudFlush);

/** Replace what is on screen with a copy that came from somewhere else. */
function adoptProgress(progress) {
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, migrate(Object.assign(blankProgress(), progress || {})));
  Profiles.saveProgress(ME.id, P);                    // not save(): do not bump the clock
  renderHeader();
  if (!$('roadScreen').classList.contains('hidden')) renderRoad();
}

/**
 * Reconcile this device with the account — in WHICHEVER direction is behind.
 *
 * This used to only ever pull, and it compared the ROW's `updated_at` against the
 * local copy's `updatedAt`. Two different clocks answering two different
 * questions: the row says when it was last WRITTEN, the progress says when the
 * DATA was made. A device that wrote a stale copy left a row that looked fresh,
 * so the newer device then decided IT was the one behind. That is how an evening
 * of a seven-year-old's work went missing.
 *
 * So both sides are judged by `progress.updatedAt`, which travels with the data,
 * and whichever side is behind gives way. The server enforces the same rule, so a
 * device that gets this wrong is refused rather than believed.
 */
async function cloudPull() {
  if (!Cloud.signedIn() || !ME.remote) return;
  const kids = await Cloud.children();
  if (!kids) return;                                  // could not tell — leave local alone
  const mine = kids.find(k => k.id === ME.remote);
  if (!mine) return;

  const theirs = Number((mine.progress || {}).updatedAt) || 0;
  const ours = Number(P.updatedAt) || 0;

  if (theirs > ours) return adoptProgress(mine.progress);

  // We are ahead — the case that used to be silently lost, because nothing sent
  // it. A row with no `updatedAt` was written before this rule existed, so ours
  // wins by default.
  if (ours > theirs) {
    const r = await Cloud.saveChild(ME.remote, { progress: P });
    if (r && r.stale) adoptProgress(r.progress);      // raced; they were ahead after all
  }
}

/**
 * The other direction: children this device knows about that the account does not.
 *
 * These used to sit here until a parent found the "Save players on this device to
 * my account" button, which meant the answer to "is my child's profile safe" was
 * "only if you pressed a thing you were never told about". A player belongs to the
 * account, so it goes up on its own the moment there is an account to put it in.
 * The button stays as a way to retry after a failure.
 */
async function cloudPushUp() {
  if (!Cloud.signedIn()) return 0;
  let sent = 0;
  // Read the account ONCE up front. Two devices that each had an unlinked "Robin"
  // before either had ever synced would each create a row for him, and the account
  // ends up with the same child twice — which is confusing on the parent page and
  // splits his progress across two rows that can never catch up with each other.
  // So: adopt a row of the same name if there is one, and only create when there
  // is genuinely nobody there.
  const onAccount = (await Cloud.children()) || [];
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  for (const p of Profiles.listProfiles()) {
    if (p.remote) continue;
    // An untouched "Player 1" is scaffolding, not a child. Uploading it would put
    // a placeholder on the account and then on every other device.
    const prog = Profiles.loadProgress(p.id) || {};
    if (p.auto && !Object.keys(prog).length) continue;

    const taken = new Set(Profiles.listProfiles().map(x => x.remote).filter(Boolean));
    const twin = onAccount.find(k => same(k.name, p.name) && !taken.has(k.id));
    if (twin) {
      Profiles.linkProfile(p.id, twin.id);
      // Linked, not merged: whichever copy is newer wins, by the same rule as
      // everywhere else. cloudPull does that on the next pass for the active
      // child, and the guard on the server refuses a backwards write regardless.
      if ((Number(prog.updatedAt) || 0) > (Number((twin.progress || {}).updatedAt) || 0)) {
        await Cloud.saveChild(twin.id, { progress: prog });
      } else {
        Profiles.saveProgress(p.id, twin.progress || {});
      }
      sent++;
      continue;
    }

    const made = await Cloud.addChild(p.name, prog, { grade: p.grade, gradeYear: p.gradeYear });
    if (!made) { console.warn('[accounts] could not save player to the account:', Cloud.lastAddError); continue; }
    Profiles.linkProfile(p.id, made.id);
    sent++;
  }
  return sent;
}

/** Children on the account that this device has never seen — a new phone, say. */
/** Returns { added, touchedActive } — the caller needs to know if THIS child changed. */
async function cloudMergeDown() {
  const kids = await Cloud.children();
  if (!kids) return { added: 0, touchedActive: false };
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  let added = 0, touchedActive = false;
  for (const k of kids) {
    const local = Profiles.listProfiles();
    if (local.some(p => p.remote === k.id)) continue;

    // ADOPT before creating. A parent signing in on a laptop that already has
    // "Ava" on it means the same child, not a second one — creating another
    // would leave two Avas on the device and, after the next upload, two on the
    // account. Match by name, then keep whichever copy is newer.
    const twin = local.find(p => !p.remote && same(p.name, k.name));
    if (twin) {
      Profiles.linkProfile(twin.id, k.id);
      const mine = Profiles.loadProgress(twin.id) || {};
      // Same rule as cloudPull: judge by when the DATA was made, not by when the
      // row happened to be written.
      const cloudAt = Number((k.progress || {}).updatedAt) || 0;
      if (cloudAt > (Number(mine.updatedAt) || 0)) {
        Profiles.saveProgress(twin.id, k.progress || {});
        if (twin.id === ME.id) touchedActive = true;
      }
      continue;
    }

    const p = Profiles.createProfile(k.name, { activate: false });
    Profiles.linkProfile(p.id, k.id);
    Profiles.saveProgress(p.id, k.progress || {});
    added++;
  }
  return { added, touchedActive };
}

async function renderAccount() {
  const cfg = await Cloud.config();
  const box = $('acctBox');
  if (!cfg.enabled) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  // Deliberately NOT a second sign-in form. There used to be one here and one on
  // the grown-ups page; they drifted, and the one people actually found was the
  // stale one. Everything to do with accounts now lives in exactly one place.
  const unlinked = Profiles.listProfiles().filter(p => !p.remote).length;
  $('acctLine').textContent = Cloud.signedIn()
    ? `Signed in as ${Cloud.email() || 'your account'}.`
      + (unlinked ? ` ${unlinked} player${unlinked > 1 ? 's are' : ' is'} still only on this device.` : '')
    : 'Progress is saved on this device only. Sign in to keep it across devices.';
  $('acctOpen').textContent = Cloud.signedIn() ? 'Manage players' : 'Sign in & manage players';
}

$('acctOpen').onclick = showParents;

function openWho() { renderWho(); renderAccount(); $('whoModal').classList.remove('hidden'); }

/* ----------------------------- parent mode ---------------------------------- */

const gradeOptions = (sel = '') =>
  `<option value="">School year…</option>` +
  Profiles.GRADES.map(g => `<option value="${g.n}" ${String(sel) === String(g.n) ? 'selected' : ''}>${g.label}</option>`).join('');

/* =============================== PARENT MODE ================================= */
// Gated, because a star map with a "Parent mode" tab on it is one tap from a
// seven-year-old reading a paragraph about their own misconceptions. The gate is a
// speed bump and the screen says so: a child who wants past this can get past it,
// and the honest thing is to admit that rather than imply a lock.

let gateAnswer = null;
const gateOpen = () => { try { return sessionStorage.getItem('mq.grown') === '1'; } catch { return false; } };
const openGate = () => { try { sessionStorage.setItem('mq.grown', '1'); } catch {} };

function renderGate() {
  const a = 11 + Math.floor(Math.random() * 78), b = 3 + Math.floor(Math.random() * 6);
  gateAnswer = a * b;
  $('gateQ').textContent = `What is ${a} × ${b}?`;
  $('gateA').value = '';
  $('gateMsg').textContent = '';
}

$('gateGo').onclick = () => {
  if (Number($('gateA').value) === gateAnswer) { openGate(); showParents(); return; }
  renderGate();                                  // a new sum, THEN the message
  $('gateMsg').textContent = 'Not quite — here is another one.';
  $('gateA').focus();
};
$('gateA').addEventListener('keydown', e => { if (e.key === 'Enter') $('gateGo').click(); });

function showParents() {
  Speech.stop();
  $('makeScreen') && $('makeScreen').classList.add('hidden');
  $('tabs').classList.remove('hidden');
  markTab('parents');
  $('roadScreen').classList.add('hidden');
  $('playScreen').classList.add('hidden');
  $('whoModal').classList.add('hidden');
  $('parentScreen').classList.remove('hidden');
  $('homeBtn').classList.remove('hidden');

  const open = gateOpen();
  $('pGateCard').classList.toggle('hidden', open);
  $('pBody').classList.toggle('hidden', !open);
  $('pReport').classList.toggle('hidden', !open);
  if (!open) { renderGate(); setTimeout(() => $('gateA').focus(), 50); return; }
  renderParents();
  renderReport();
  renderParentFriends();
}

/* ------------------------------- the report --------------------------------- */
// Deliberately not a dashboard. A parent has two minutes and one question: is this
// working, and what should I say to my child. So it is prose with numbers in it,
// it leads with the misconceptions (where the "why" text is already written for a
// grown-up), and it ends with what it cannot see.

let reportFor = null;

function renderReport() {
  const list = Profiles.listProfiles();
  const id = reportFor && list.some(p => p.id === reportFor) ? reportFor : ME.id;
  reportFor = id;
  const who = list.find(p => p.id === id) || { name: ME.name };
  const prog = id === ME.id ? P : Object.assign(blankProgress(), Profiles.loadProgress(id) || {});

  $('rName').textContent = who.name;
  $('rPick').innerHTML = list.map(p =>
    `<option value="${esc(p.id)}"${p.id === id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('rPick').classList.toggle('hidden', list.length < 2);

  const hist = prog.history || [];
  const conf = Insight.confidence(hist);
  $('rConf').textContent = conf.why;

  /* --- the four numbers, and what each one means --- */
  const solved = Object.values(prog.bands || {}).reduce((n, b) => n + (b.solved || 0), 0);
  const firstTry = Object.values(prog.bands || {}).reduce((n, b) => n + (b.firstTry || 0), 0);
  const asked = hist.filter(r => r.q !== 'none');
  const answered = asked.filter(r => r.q === 'answered').length;
  const tile = (big, label, note) =>
    `<div class="rtile"><b>${big}</b><span>${esc(label)}</span><small>${esc(note)}</small></div>`;
  $('rTotals').innerHTML =
    tile(solved, 'problems solved', 'across every level')
  + tile(`${totalStars(prog, ORDER)}`, 'stars', `of ${maxStars(ORDER)} — first try, no help`)
  + tile(solved ? `${Math.round(firstTry / solved * 100)}%` : '—', 'solved first try',
         'the honest measure of "knows it"')
  + tile(asked.length ? `${answered}/${asked.length}` : '—', 'answered Pip',
         'rather than opening the hint');

  /* --- what they can do --- */
  $('rWorlds').innerHTML = ORDER.map(k => {
    const c = CONCEPTS[k];
    const st = worldStars(prog, k), mx = worldMaxStars(k);
    const done = worldSolved(prog, k);
    const open = worldUnlocked(prog, k);
    return `<div class="rworld ${open ? '' : 'shut'}">
      <span class="rwname">${c.icon}<b>${esc(c.label)}</b><i>${esc(c.short)}</i></span>
      <span class="rwbar"><span style="width:${mx ? Math.round(st / mx * 100) : 0}%;background:${c.color}"></span></span>
      <span class="rwnum">${open ? `${st}/${mx} ★ · ${done} solved` : 'not open yet'}</span>
    </div>`;
  }).join('');

  /* --- what is still tricky --- */
  const miss = Object.entries(prog.misconceptions || {}).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const seen = {};
  for (const r of hist) for (const m of r.m || []) seen[m] = (seen[m] || 0) + 1;
  $('rMiss').innerHTML = miss.length
    ? miss.map(([k, v]) => {
        const M = MISCONCEPTIONS[k];
        if (!M) return '';
        return `<div class="rmiss">
          <b>${esc(M.label)}</b>${v > 1 ? `<span class="rcount">seen ${v}×</span>` : ''}
          <p>${esc(M.why)}</p>
          <p class="rsay"><b>Worth asking:</b> ${esc(M.ask)}</p>
        </div>`;
      }).join('')
    : `<p class="pnote">${solved
        ? 'Nothing open right now — the equations have been matching the stories.'
        : 'Nothing yet, because nothing has been solved yet.'}</p>`;

  /* --- how they work --- */
  const obs = Insight.observe(hist);
  $('rStyle').innerHTML = obs.length
    ? obs.map(o => `<div class="robs"><b>${esc(o.title)}</b>
        <span class="rcount">${o.n} problem${o.n === 1 ? '' : 's'}</span>
        <p>${esc(o.detail)}</p></div>`).join('')
    : `<p class="pnote">Not enough to say anything worth reading yet. ${esc(conf.why)}
       This section stays empty rather than guessing.</p>`;


}

/* ------------------------ who the children have added ------------------------ */
// A parent asked for this, and the thing they actually want to know is "what is new
// since I last looked" rather than "list everything" — a list you have already read
// is noise, and noise is what makes people stop reading a safety surface.
//
// This is review, not approval: a friendship is live as soon as both children say
// yes, and a parent can undo it. Making it a gate would mean a child waiting on a
// grown-up before their friend appears, which is a different product decision and
// is written up in the README rather than assumed here.

const LAST_SEEN_KEY = 'mq.friendsSeen';
const lastFriendCheck = () => { try { return Number(localStorage.getItem(LAST_SEEN_KEY)) || 0; } catch { return 0; } };
const markFriendsSeen = () => { try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch {} };

const whenOf = f => Date.parse(f.accepted_at || f.asked_at || 0) || 0;

function friendAgo(ms) {
  if (!ms) return '';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

async function renderParentFriends() {
  const card = $('pFriendsCard'), el = $('pFriendList'), tag = $('pFriendNew');
  if (!card) return;
  tag.classList.add('hidden');

  if (!Cloud.signedIn()) {
    $('pFriendNote').textContent = 'Sign in below and any friendships your children make will be listed here.';
    el.innerHTML = '';
    return;
  }

  const rows = await Cloud.friendsOverview();
  // An empty list and a failed call are different things, and saying "could not
  // load" to a parent whose children simply have no friends yet is a small lie.
  if (rows === null) {
    el.innerHTML = friendFailHtml('Could not load friendships just now.');
    return;
  }

  const since = lastFriendCheck();
  const fresh = rows.filter(f => whenOf(f) > since);
  if (fresh.length) {
    tag.textContent = `${fresh.length} new`;
    tag.classList.remove('hidden');
  }

  if (!rows.length) {
    el.innerHTML = '<p class="pnote">Nothing new since you last looked — none of your children have added a friend. '
      + 'They add one by swapping an eight-letter code, so nobody can be found by searching, and both children have to agree.</p>';
    markFriendsSeen();
    return;
  }

  // Newest first, because that is the question being asked.
  el.innerHTML = rows.map(f => {
    const isNew = whenOf(f) > since;
    const pending = f.status === 'pending';
    return `<div class="pfriend ${isNew ? 'fresh' : ''}">
      <div class="pfname">
        <b>${esc(f.my_child_name)}</b>
        <span class="pfarrow">${pending ? (f.direction === 'in' ? 'was asked by' : 'asked') : 'is friends with'}</span>
        <b>${esc(f.friend_name)}</b>
        ${isNew ? '<span class="newtag">new</span>' : ''}
      </div>
      <div class="pfwhen">${pending ? 'not accepted yet · ' : ''}${esc(friendAgo(whenOf(f)))}</div>
      <button class="ghost" data-pfremove="${esc(f.my_child_id)}|${esc(f.friend_id)}">Remove</button>
    </div>`;
  }).join('');

  // Seen now. Marked AFTER rendering, so this visit's "new" flags are the ones the
  // parent is actually looking at rather than ones cleared before they loaded.
  markFriendsSeen();
}

$('pFriendList').addEventListener('click', async e => {
  const b = e.target.closest('[data-pfremove]');
  if (!b) return;
  const [mine, friend] = b.dataset.pfremove.split('|');
  const row = b.closest('.pfriend');
  const who = row ? row.querySelectorAll('b')[1]?.textContent : 'this friend';
  if (!confirm(`Remove ${who}? They will disappear from both children's friend lists.`)) return;
  b.disabled = true;
  await Cloud.removeFriend(mine, friend);
  renderParentFriends();
});

$('rPick').addEventListener('change', e => { reportFor = e.target.value; renderReport(); });

async function renderParents() {
  const cfg = await Cloud.config();
  const on = cfg.enabled;
  const inn = on && Cloud.signedIn();
  $('pGoogle').classList.toggle('hidden', !(on && cfg.google));
  $('pOr').classList.toggle('hidden', !(on && cfg.google));
  $('pOut').classList.toggle('hidden', inn);
  $('pIn').classList.toggle('hidden', !inn);
  if (!on) {
    $('pMsg').className = '';
    $('pMsg').textContent = 'Accounts are not switched on for this copy of the app. '
      + 'Players still work — they are kept on this device.';
    // #pSend went away with the duplicate sign-in form; disable what is actually
    // on the page, or the whole parent screen throws before it finishes drawing.
    for (const id of ['pEmail', 'pPass', 'pSignIn', 'pSignUp', 'pLinkInstead'])
      if ($(id)) $(id).disabled = true;
  }
  $('pNewGrade').innerHTML = gradeOptions();
  if (!inn) return;

  $('pWho').textContent = Cloud.email() || 'your account';
  if (!Cloud.email()) Cloud.whoAmI().then(() => { $('pWho').textContent = Cloud.email() || 'your account'; });

  const list = Profiles.listProfiles();
  $('pPlayers').innerHTML = list.map(p => {
    const prog = Profiles.loadProgress(p.id) || {};
    const solved = prog.bands ? Object.values(prog.bands).reduce((n, b) => n + (b.solved || 0), 0) : 0;
    const g = Profiles.currentGrade(p);
    return `<div class="player" data-id="${p.id}">
      <input class="pname" value="${esc(p.name)}" maxlength="24" aria-label="Name">
      <select class="gradesel" aria-label="School year">${gradeOptions(g === null ? '' : g)}</select>
      <span class="pstat">${solved ? `${solved} solved` : 'not started'}${p.remote ? '' : ' · on this device only'}</span>
      ${list.length > 1 ? '<button class="prm" title="Remove">&times;</button>' : ''}
    </div>`;
  }).join('');

  $('pPlayers').querySelectorAll('.player').forEach(el => {
    const id = el.dataset.id;
    const push = async () => {
      const p = Profiles.listProfiles().find(x => x.id === id);
      if (p && p.remote) await Cloud.saveChild(p.remote, { name: p.name, grade: p.grade, gradeYear: p.gradeYear });
    };
    el.querySelector('.pname').onchange = e => { Profiles.updateProfile(id, { name: e.target.value }); push(); renderHeader(); };
    el.querySelector('.gradesel').onchange = e => {
      Profiles.updateProfile(id, { grade: e.target.value === '' ? null : Number(e.target.value) });
      push();
    };
    const rm = el.querySelector('.prm');
    if (rm) rm.onclick = async () => {
      const p = Profiles.listProfiles().find(x => x.id === id);
      if (!p || !confirm(`Remove ${p.name}? Their stars and progress go too.`)) return;
      if (p.remote) await Cloud.removeChild(p.remote);
      Profiles.removeProfile(id);
      if (id === ME.id) return location.reload();
      renderParents();
    };
  });

  // Players go up on their own now, so this is a retry rather than the way it works.
  $('pUpload').textContent = list.some(p => !p.remote)
    ? 'Try saving them to my account again' : 'Every player is saved to your account';
  $('pUpload').disabled = !list.some(p => !p.remote);
  renderSync();
}

$('pGoogle').onclick = () => Cloud.signInWithGoogle();
/* --------------------------------- tabs ------------------------------------- */
// Three destinations, always on screen. The map is the default because it is what
// the game is; the other two used to sit under it, which meant they did not exist.

function showTab(name) {
  if (name === 'parents') { showParents(); return; }
  if ($('parentScreen').classList.contains('hidden') === false ||
      $('playScreen').classList.contains('hidden') === false ||
      $('makeScreen').classList.contains('hidden') === false) showRoad();
  $('tabMap').classList.toggle('hidden', name !== 'map');
  $('tabSocial').classList.toggle('hidden', name !== 'social');
  if (name === 'social') { renderLiked(); renderFriends(); }
  // The road is drawn from a measured width, and a hidden element measures zero,
  // so it has to be redrawn on the way in rather than on the way out.
  if (name === 'map') renderRoad();
  markTab(name);
}

function markTab(name) {
  for (const b of document.querySelectorAll('#tabs .tab'))
    b.classList.toggle('on', b.dataset.tab === name);
}

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) { track('tab', b.dataset.tab); showTab(b.dataset.tab); }
});
$('parentBack').onclick = showRoad;

async function useCredentials(kind) {
  const email = $('pEmail').value.trim(), pass = $('pPass').value;
  const msg = $('pMsg'); msg.className = ''; msg.textContent = 'One moment…';
  const r = kind === 'up' ? await Cloud.signUp(email, pass) : await Cloud.signIn(email, pass);
  if (!r.ok) { msg.className = 'bad'; msg.textContent = r.error; return; }
  // Signing in changes which children exist, so start clean rather than patching.
  try { sessionStorage.setItem('mq.gotoParents', '1'); } catch {}
  location.reload();
}
$('pForm').addEventListener('submit', e => { e.preventDefault(); useCredentials('in'); });
$('pSignIn').onclick = e => { e.preventDefault(); useCredentials('in'); };
$('pSignUp').onclick = () => useCredentials('up');

$('pEmail').onkeydown = e => { if (e.key === 'Enter') $('pPass').focus(); };

// The emailed link still exists — it is just no longer the front door, because
// Supabase's built-in sender allows two an hour.
$('pLinkInstead').onclick = async () => {
  const address = $('pEmail').value.trim();
  const msg = $('pMsg'); msg.className = ''; msg.textContent = 'Sending…';
  const r = await Cloud.sendLink(address);
  msg.className = r.ok ? 'good' : 'bad';
  msg.textContent = r.ok
    ? `Check ${address} and open the link on this device. It will bring you back to ${r.redirect || 'this app'}.`
    : (r.error || 'Could not send that just now.');
};

$('pAdd').onclick = async () => {
  const name = $('pNewName').value.trim();
  const grade = $('pNewGrade').value;
  const msg = $('pMsg2'); msg.className = '';
  if (!name) { msg.className = 'bad'; msg.textContent = 'A first name is needed.'; return $('pNewName').focus(); }
  // Two players called Ava is almost always a slip, and it is confusing to undo
  // once both have progress. Ask rather than refuse — siblings do share names.
  const clash = Profiles.listProfiles().some(x => x.name.trim().toLowerCase() === name.toLowerCase());
  if (clash && !confirm(`There is already a player called ${name}. Add another one?`)) return;
  const p = Profiles.createProfile(name, { activate: false });
  if (grade !== '') Profiles.updateProfile(p.id, { grade: Number(grade) });
  const made = Cloud.signedIn()
    ? await Cloud.addChild(name, {}, { grade: grade === '' ? undefined : Number(grade), gradeYear: p.gradeYear })
    : null;
  if (made) Profiles.linkProfile(p.id, made.id);
  msg.className = made || !Cloud.signedIn() ? 'good' : 'bad';
  msg.textContent = made ? `${name} is ready to play, and saved to your account.`
    : Cloud.signedIn() ? `${name} is ready on this device, but not on your account — ${Cloud.lastAddError} It will try again next time you open the app.`
                       : `${name} is ready to play on this device. Sign in and every player goes to your account automatically.`;
  $('pNewName').value = ''; $('pNewGrade').value = '';
  renderParents();
};
$('pNewName').onkeydown = e => { if (e.key === 'Enter') $('pAdd').click(); };

$('pUpload').onclick = async () => {
  const msg = $('pMsg2'); msg.className = ''; msg.textContent = 'Saving…';
  let ok = 0, failed = 0, why = '';
  for (const p of Profiles.listProfiles()) {
    if (p.remote) continue;
    const made = await Cloud.addChild(p.name, Profiles.loadProgress(p.id), { grade: p.grade, gradeYear: p.gradeYear });
    if (made) { Profiles.linkProfile(p.id, made.id); ok++; }
    else { failed++; why = why || Cloud.lastAddError; }
  }
  msg.className = failed ? 'bad' : 'good';
  msg.textContent = failed
    ? `${ok ? `Saved ${ok}. ` : ''}${failed} did not go up — ${why || 'no reason given'} `
      + 'Everything is still safe on this device.'
    : 'Saved. Sign in on another device and they will be there.';
  renderParents();
};

$('pOff').onclick = () => {
  if (!confirm('Sign out? Every player stays on this device — you are just disconnecting the account.')) return;
  Cloud.signOut();
  Profiles.unlinkAll();
  location.reload();
};

$('whoBtn').onclick = openWho;
$('whoClose').onclick = () => $('whoModal').classList.add('hidden');
$('whoAdd').onclick = () => {
  const name = $('whoNew').value.trim();
  if (!name) return $('whoNew').focus();
  Profiles.createProfile(name);
  location.reload();
};
$('whoNew').onkeydown = e => { if (e.key === 'Enter') $('whoAdd').click(); };
$('whoReset').onclick = () => {
  if (!confirm(`Start ${ME.name} again from the beginning? Their stars and progress are cleared.`)) return;
  Profiles.resetProgress(ME.id);
  location.reload();
};

/* ================================ STAR MAP =================================== */
// ONE road, and you travel along it.
//
// The journey is a single sequence: the Twin Moons planet, then its four levels,
// then the Comet Trail planet, then its four, and so on to the two-step puzzles
// at the end — 5 planets and 22 levels, 27 stops on one winding path.
//
// It snakes: four stops per row on a wide screen, two on a phone, each row
// running back the other way, with the stops riding a gentle wave so the road
// curves rather than ruling straight lines. Laying it out as a hub column plus
// rows of cards was the earlier mistake — that reads as a table, not a journey.

const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.5 10.5V7.6a3.5 3.5 0 0 1 7 0v2.9"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4.5 4.5L19 7"/></svg>';

function showRoad() {
  Speech.stop();
  $('playScreen').classList.add('hidden');
  $('parentScreen').classList.add('hidden');
  $('roadScreen').classList.remove('hidden');
  $('homeBtn').classList.add('hidden');
  document.documentElement.style.removeProperty('--world');
  document.documentElement.style.removeProperty('--world-glow');
  $('makeScreen').classList.add('hidden');
  $('tabs').classList.remove('hidden');
  if ($('tabSocial').classList.contains('hidden')) markTab('map'); else markTab('social');
  renderRoad();
  renderLiked();
  renderFriends();
  Pip.set('idle');
}

/** The whole journey, flattened into the order you travel it. */
function journey() {
  const here = currentSpot();
  const stops = [];
  for (const key of ORDER) {
    const c = CONCEPTS[key], open = unlocked(key);
    stops.push({
      kind: 'planet', world: key, open,
      label: c.label, sub: open ? c.short : whyLocked(lockReason(P, key)),
      icon: c.icon, color: c.color, glow: c.glow,
      stars: worldStars(P, key), max: worldMaxStars(key)
    });
    for (const b of openBands(P, key)) {
      const stat = bandStat(P, key, b.id);
      const lock = b.open ? null : lockReason(P, key, b.index);
      stops.push({
        kind: 'level', world: key, band: b.id, open: b.open,
        tested: testedOut(P, key, b.id),
        label: b.label, sub: b.open ? b.short : whyLocked(lock),
        n: b.index + 1, color: c.color, glow: c.glow,
        stars: bandStars(stat), next: nextStar(stat),
        here: !!(here && here.concept === key && here.band === b.id)
      });
    }
  }
  return stops;
}

function renderRoad() {
  const map = $('roadmap');
  const W = map.clientWidth || 640;
  const perRow = W < 300 ? 2 : W < 700 ? 3 : 4;
  // Rows have to clear a stop's caption AND the wave, or one row's small print
  // lands on the next row's planet. Worst case gap is ROW minus twice the wave.
  const ROW = W < 430 ? 178 : 198;   // three stops per row on a phone keeps the road from being a mile long
  const WAVE = W < 430 ? 22 : 30;
  const stops = journey();
  const rows = Math.ceil(stops.length / perRow);
  const H = 54 + (rows - 1) * ROW + 96;

  // Serpentine: every other row runs back the other way, and each stop rides a
  // shallow wave so the road curves instead of ruling a straight line.
  // Evenly spaced columns always read as a table however you curve the line
  // between them, so the stops are nudged off the grid: they zigzag vertically
  // and wander a little sideways. The wander is derived from the stop's index,
  // never random, so the road is identical on every render and on every device.
  const wobble = n => ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1 - 0.5;
  const pts = stops.map((s, i) => {
    const row = Math.floor(i / perRow);
    let col = i % perRow;
    if (row % 2) col = perRow - 1 - col;
    const pad = perRow === 2 ? 27 : 16;
    const x = (perRow === 1 ? 50 : pad + (col / (perRow - 1)) * (100 - pad * 2))
            + wobble(i * 3 + 1) * 4.2;
    const zig = (col % 2 ? 1 : -1) * WAVE * (row % 2 ? -1 : 1);
    const y = 54 + row * ROW + zig + wobble(i * 7 + 5) * 14;
    return { ...s, x, y, px: x / 100 * W };
  });

  const lastOpen = pts.reduce((n, p, i) => (p.open ? i : n), 0);
  // The one stop worth explaining beyond where you are: the next one along the
  // road that is still shut. Printing the reason under all twenty is noise.
  const goal = pts.find(p => p.kind === 'level' && !p.open);
  if (goal) goal.goal = true;
  map.style.height = `${H}px`;
  map.innerHTML =
    `<svg class="roadpath" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
       <path class="road" d="${roadPath(pts)}"/>
       <path class="road done" d="${roadPath(pts, lastOpen)}"/>
     </svg>` +
    pts.map(s => {
      const cls = ['stop', s.kind, s.open ? 'open' : 'locked',
                   s.kind === 'level' && s.stars >= 3 ? 'done' : '',
                   s.tested ? 'tested' : '',
                   s.here ? 'here' : '', s.goal ? 'goal' : ''].join(' ');
      const inner = s.kind === 'planet'
        ? (s.open ? s.icon : LOCK_ICON)
        : (s.open ? (s.stars >= 3 ? TICK : s.n) : LOCK_ICON);
      return `<div class="${cls}" style="left:${s.x}%;top:${s.y}px;--wcol:${s.color};--wglow:${s.glow}"
                   data-world="${s.world}" ${s.band ? `data-band="${s.band}"` : ''}>
        ${s.here ? `<span class="youflag">${STAR}</span>` : ''}
        <div class="dot">${inner}</div>
        <div class="cap">
          <span class="capname">${esc(s.label)}</span>
          ${s.kind === 'level'
            ? `<span class="capstars">${stars3(s.stars)}</span>`
              + (s.tested && s.stars === 0 ? '<span class="capskip">skipped ahead</span>' : '')
            : (s.open ? `<span class="capstars planet">${STAR}<b>${s.stars}</b><span>/${s.max}</span></span>` : '')}
          <span class="capsub">${esc(s.open && s.kind === 'level' && s.next ? s.next.text : s.sub)}</span>
        </div>
      </div>`;
    }).join('');

  map.querySelectorAll('.stop.open').forEach(el => {
    const world = el.dataset.world, band = el.dataset.band;
    el.querySelector('.dot').onclick = () => {
      if (band) return startBand(world, band);
      const b = recommendedBand(P, world);           // a planet takes you to its next level
      if (b) startBand(world, b.id);
    };
  });
  // A locked LEVEL is an invitation, not a wall: a child who already knows this
  // can prove it in two problems rather than walking up from the bottom.
  map.querySelectorAll('.stop.level.locked').forEach(el => {
    const world = el.dataset.world, band = el.dataset.band;
    if (!worldUnlocked(P, world)) return;            // the planet itself is still shut
    el.classList.add('offerable');
    el.querySelector('.dot').onclick = () => offerChallenge(world, band);
  });

  const here = currentSpot();
  const total = totalStars(P, ORDER), max = maxStars(ORDER);
  $('totalStars').innerHTML = `${STAR}<span>${total} / ${max} stars</span>`;
  $('heroMsg').textContent = total === 0
    ? `Start at ${CONCEPTS[ORDER[0]].label}. ${stops.filter(s => s.kind === 'level').length} stops on the road, and the puzzles never run out.`
    : total >= max
      ? 'Every star on the road is yours. The puzzles keep coming though — want to fly it again?'
      : here ? `Next stop: ${CONCEPTS[here.concept].label} — ${here.label}.` : 'Pick any stop that is open.';

  renderInsights();
}

/**
 * A smooth road through the stops (Catmull-Rom, written out as cubics).
 * `upto` shortens it WITHOUT changing its shape — the travelled part has to lie
 * exactly on the road, and a shorter point list would bend differently.
 */
function roadPath(pts, upto = null) {
  if (pts.length < 2) return '';
  const p = pts.map(s => ({ x: s.px, y: s.y }));
  const end = upto === null ? p.length - 1 : Math.min(upto, p.length - 1);
  if (end < 1) return '';
  let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 0; i < end; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p[i + 1];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function whyLocked(why) {
  if (!why) return 'Locked';
  if (why.kind === 'world') return `Needs ${why.needs.map(n => CONCEPTS[n].label).join(' and ')} first`;
  return `${why.need} more ${why.need === 1 ? 'star' : 'stars'} on ${why.prev.label}`;
}

/** Where the child is up to: the recommended world, and the level inside it. */
function currentSpot() {
  const world = currentWorld();
  const band = world ? recommendedBand(P, world) : null;
  return band ? { concept: world, band: band.id, label: band.label } : null;
}

function renderInsights() {
  const active = Object.entries(P.misconceptions).filter(([, v]) => v > 0);
  $('insights').textContent = active.length
    ? 'Ideas that are still tricky. Each one is about how you read the story, not about arithmetic:'
    : (Object.keys(P.concepts).length
        ? 'No tricky ideas open right now — your equations are matching the stories.'
        : "Play a few problems and I'll show what I'm learning about how you think.");
  const badges = $('badges');
  badges.innerHTML = '';
  const addBadge = (text, cls = '') => {
    const b = document.createElement('span');
    b.className = 'badge ' + cls; b.textContent = text;
    badges.appendChild(b);
  };
  for (const [key, v] of active) addBadge(`${MISCONCEPTIONS[key]?.label || key}${v > 1 ? ` ×${v}` : ''}`, 'miss');
  for (const key of ORDER) if (worldStars(P, key) >= worldMaxStars(key)) addBadge(`${CONCEPTS[key].label} — mastered`);
}

let roadResizeT;
addEventListener('resize', () => {
  if ($('roadScreen').classList.contains('hidden')) return;
  clearTimeout(roadResizeT);
  roadResizeT = setTimeout(renderRoad, 150);
});


/* --------------------------------- starting --------------------------------- */

// A door for the automated tests to walk a specific level without clicking the
// whole map to get there. It calls the same function the map calls; there is no
// behaviour here that a child cannot also reach.
window.__start = (concept, bandId) => startBand(concept, bandId);

function startBand(concept, bandId, opts = {}) {
  state.world = concept;
  state.band = bandsFor(concept).find(b => b.id === bandId) || bandsFor(concept)[0];
  state.mode = 'main';
  state.runWrong = 0; state.runSlips = 0; state.offeredEasier = false;
  state.challenge = opts.challenge ? { left: TEST_OUT_REQUIRED } : null;
  buildQueue();
  $('roadScreen').classList.add('hidden');
  $('playScreen').classList.remove('hidden'); $('tabs').classList.add('hidden');
  $('homeBtn').classList.remove('hidden');
  nextProblem();
}

/* ------------------------------ skipping ahead ------------------------------- */

function offerChallenge(world, bandId) {
  const band = bandsFor(world).find(b => b.id === bandId);
  if (!band) return;
  Sound.operator();
  $('chTitle').textContent = `Already know ${band.label}?`;
  $('chSub').textContent = `Get ${TEST_OUT_REQUIRED} right on the first try and this level is yours — `
    + `no need to work up to it.`;
  $('challenge').classList.remove('hidden');
  $('chGo').onclick = () => { $('challenge').classList.add('hidden'); startBand(world, bandId, { challenge: true }); };
  $('chNo').onclick = () => $('challenge').classList.add('hidden');
}

/** Records the pass. The celebration itself is left to onCorrect, so that it
 *  cannot be overwritten by the ordinary star/planet celebration a moment later. */
function passChallenge() {
  markTestedOut(P, state.world, state.band.id); save();
  state.challenge = null;
  chat('pip', `You clearly knew that already. ${state.band.label} is open, and so is everything before it.`,
       { emoji: '🔓', cls: 'win' });
}

function failChallenge() {
  const world = state.world, band = state.band;
  state.challenge = null;
  const easier = easierBand(P, world, band.id) || bandsFor(world)[0];
  chat('pip', `That one was tricky — no harm done. Let us warm up on ${easier.label} first, `
    + `then come back to this.`, { emoji: '🌱' });
  clearActions();
  addAction(`Go to ${easier.label} →`, 'primary', () => startBand(world, easier.id));
  addAction('Stay here anyway', 'ghost', () => { state.challenge = null; nextProblem(); });
}

/** Pressing Play should start playing, not ask a question. */
function playNow() {
  const here = currentSpot();
  if (here) startBand(here.concept, here.band); else showRoad();
}

$('showBtn').onclick = () => {
  chat('kid', 'Picture it for me', { speak: false });
  if (!showSituation()) chat('pip', cannotDraw(), { emoji: '🖍️', speak: false });
};

// Written for how a seven-year-old actually asks, which is rarely the word
// "visualise". Kept deliberately narrow: "what does draw mean" is a word question,
// and "I drew it on paper, now what" is not a request for anything.
const PICTURE_RE = new RegExp([
  '\\b(draw|drawing|sketch)\\b',
  '\\bpicture\\b',
  '\\b(show|see) (me )?(it|this|the (story|picture)|what)',
  '\\bwhat does it look like\\b',
  '\\b(can|could|will|would) (you|u) (draw|show|picture)',
  '\\bmake (me )?a picture\\b',
  '\\bwith (blocks|dots|counters)\\b'
].join('|'), 'i');
const NOT_PICTURE_RE = /\b(what|wot) (does|is|d[oe]es) .{0,12}\b(draw|picture|sketch)\b.{0,6}\bmean\b|\bi (already )?drew\b|\bi drawed\b/i;

function wantsPicture(text) {
  const t = String(text || '').trim();
  if (!t || NOT_PICTURE_RE.test(t)) return false;
  return PICTURE_RE.test(t);
}

/** Said out loud when there is no picture, so the child is never left guessing why. */
function cannotDraw() {
  const p = state.current;
  if (p && p.concept === 'multi-step')
    return 'This one has two steps in it, so a single picture would leave half the story out. '
         + 'Try "Where do I start?" — we can take it one step at a time instead.';
  return 'These numbers are too big to draw without covering the whole screen in blocks. '
       + 'Try "Where do I start?" and we will talk it through.';
}

$('playBtn').onclick = playNow;
$('homeBtn').onclick = showRoad;

function buildQueue() {
  // A hand-written problem belongs to whichever band its own numbers put it in.
  // 7 + 8 = 15 is an "Up to 20" problem, and serving it inside "Up to 10" — which
  // is what a blanket "put the signature problems first" did — makes the level
  // labels a lie.
  const fresh = allProblems().filter(p =>
    p.concept === state.world &&
    bandOfProblem(p) === state.band.id &&
    !P.solvedIds.includes(p.id));
  state.queue = [...fresh, ...problemsFor(state.world, state.band.id, 10)];
}


/* =================================== PLAY =================================== */

function nextProblem() {
  if (state.mode === 'practice') {
    if (state.practiceQueue.length) return loadProblem(state.practiceQueue.shift());
    return finishPractice();
  }
  if (!state.queue.length) {
    // End of a run — back to the map, where the stars just earned are visible on
    // the branch and another level is one tap away. The hand-written problems are
    // freed up for next visit; generated ones never repeat, since every run
    // draws a new seed.
    P.solvedIds = P.solvedIds.filter(id => !allProblems().some(p => p.id === id && p.concept === state.world));
    save();
    return showRoad();
  }
  loadProblem(state.queue.shift());
}

function loadProblem(p) {
  // The problem being left has to be recorded BEFORE `state.current` moves on, or
  // the record is filed against the problem the child is about to see instead of
  // the one they just walked away from.
  if (state.current && !state.recorded) recordProblem(false);
  state.current = p;
  state.recorded = false;
  state.eq = []; state.trace = [];
  $('alsoSolved') && $('alsoSolved').classList.add('hidden');
  state.attempts = 0; state.usedHelp = false; state.startStep = 0; state.slips = 0;
  state.lastDiag = null;
  $('answer').value = '';
  $('check').disabled = true;
  $('check').classList.remove('hidden');
  clearActions();
  hideRibbon();
  $('fbDetails').classList.add('hidden');
  hideViz();
  Speech.stop();
  Pip.set('idle');
  setWordMode(false);
  $('askrow').classList.remove('hidden');
  // A stuck seven-year-old should not have to TYPE their way out. "Show me" sits
  // next to "Where do I start?" so the whole escalation is tappable.
  // The button stays on screen even where the story cannot be drawn. Hiding it
  // makes the tool unlearnable — a child who saw it once and cannot find it again
  // concludes it was never there. When it cannot draw, it says so in one line.
  $('showBtn').classList.toggle('dim', !canShowSituation(p));

  // The whole screen takes the colour of the world you are standing in.
  const c = CONCEPTS[p.concept];
  document.documentElement.style.setProperty('--world', c.color);
  document.documentElement.style.setProperty('--world-glow', c.glow);

  const stat = state.band ? bandStat(P, state.world, state.band.id) : { solved: 0, firstTry: 0 };
  const nxt = state.mode === 'practice' ? null : nextStar(stat);
  // A puzzle a friend wrote belongs to no level, so it must not claim one: showing
  // "Twin Moons · Up to 10 · 1 more → ★" over someone's home-made problem promises
  // a star that will never arrive.
  const loose = p.authored;
  $('youarehere').innerHTML = `<button class="backbtn" id="backBtn">← Star map</button>
    ${loose
      ? `<span class="wherechip">${p.mine ? '✏️ My puzzle' : '🎁 From a friend'}</span>`
      : `<span class="wherechip">${state.mode === 'practice' ? 'Practice' : c.icon + esc(c.label)}</span>
         ${state.band && state.mode !== 'practice' ? `<span class="whereband">${esc(state.band.label)}</span>` : ''}
         <span class="wherestars">${stars3(bandStars(stat))}</span>
         ${nxt ? `<span class="wherenext">${esc(nxt.text)}</span>` : ''}`}
    <button class="likebtn ${isLiked(p.id) ? 'on' : ''}" id="likeBtn"
            title="Like this puzzle" aria-label="Like this puzzle">❤️</button>`;
  $('backBtn').onclick = showRoad;
  $('likeBtn').onclick = e => e.currentTarget.classList.toggle('on', toggleLike(p));

  const banner = $('fromFriend');
  if (p.from) {
    banner.innerHTML = `<span>🎁</span><span><b>${esc(p.from)}</b> sent you this puzzle.</span>`;
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
  $('storyLabel').textContent = state.challenge
    ? `Challenge — ${state.challenge.left} to go`
    : state.mode === 'practice' ? 'Try this one' : 'The story';
  $('petRole').textContent = state.mode === 'practice'
    ? `practising: ${MISCONCEPTIONS[state.practiceTarget]?.label || 'this idea'}`
    : 'your maths buddy';

  // A fresh conversation per problem — the log below is the history of THIS one.
  resetChat();
  chat('pip', state.mode === 'practice'
    ? 'Here is another one with the same idea. Take your time.'
    : 'Tap the numbers in the story to build your equation. Ask me anything.',
    { speak: false });

  renderStory(); renderEq(); renderDots();
  updateAskPlaceholder();
  track('problem-shown', p.id);
}

// Text is split into tappable words so a child can ask about any of them.
function renderStory() {
  const el = $('story');
  el.innerHTML = '';
  for (const t of state.current.tokens) {
    if (t.type === 'num') {
      const b = document.createElement('button');
      b.className = 'num'; b.textContent = t.value; b.title = t.label;
      b.dataset.qid = t.qid;
      b.onclick = () => pushNum(t, b);
      el.appendChild(b);
      continue;
    }
    for (const piece of t.value.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { el.appendChild(document.createTextNode(piece)); continue; }
      const w = document.createElement('span');
      w.className = 'w'; w.textContent = piece;
      w.onclick = () => { if (state.wordMode) ask(piece, { intent: 'word', el: w, show: `What does "${piece}" mean?` }); };
      el.appendChild(w);
    }
  }
  $('quantHint').textContent = '';
  markUsed();
}

function markUsed() {
  const used = new Set(state.eq.filter(e => e.kind === 'num').map(e => e.qid));
  document.querySelectorAll('.num').forEach(b => b.classList.toggle('used', used.has(Number(b.dataset.qid))));
}

function renderEq() {
  const strip = $('eqstrip');
  strip.innerHTML = '';
  strip.classList.toggle('empty', !state.eq.length);
  for (const t of state.eq) {
    const s = document.createElement('span');
    s.className = 'chip' + (t.kind === 'op' ? ' op' : t.kind === 'paren' ? ' paren' : '');
    s.textContent = DISPLAY[t.value] ?? t.value;
    strip.appendChild(s);
  }
  markUsed();
  $('check').disabled = state.eq.length < 3;
}

function renderDots() {
  const el = $('dots');
  el.innerHTML = '';
  if (state.mode !== 'practice') return;
  const total = state.practiceQueue.length + 1 + state.solvedInRound;
  for (let i = 0; i < total; i++) {
    const d = document.createElement('span');
    d.className = 'dot' + (i < state.solvedInRound ? ' done' : i === state.solvedInRound ? ' on' : '');
    el.appendChild(d);
  }
}

function showCombo(text) {
  $('comboText').textContent = text;
  $('combobar').classList.add('show');
  setTimeout(() => $('combobar').classList.remove('show'), 2000);
}

/* ============================== the conversation ============================ */
// One log per problem. Everything the child asked and everything Pip answered
// stays visible, so the reasoning conversation reads as a whole.

function resetChat() {
  state.chat = [];
  $('chatlog').innerHTML = '';
}

function chat(who, text, { emoji = '', note = '', speak = true, cls = '' } = {}) {
  state.chat.push({ who, text, emoji, note, cls });
  const log = $('chatlog');
  const el = document.createElement('div');
  el.className = `msg m-${who} ${cls}`.trim();   // m- prefix: `.pip` is the mascot
  el.innerHTML = `<span class="b">${emoji ? `<span class="pic">${esc(emoji)}</span>` : ''}${esc(text)}${note ? `<span class="note">${esc(note)}</span>` : ''}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  if (who === 'pip' && speak && Sound.on) Speech.say([text, note].filter(Boolean).join('. '));
  return el;
}

// Replace the trailing "Let me think…" placeholder once an answer arrives.
function thinking() { return chat('pip', 'Let me think…', { speak: false, cls: 'think' }); }
function resolveThinking(el, text, opts) {
  el?.remove();
  const i = state.chat.findIndex(m => m.cls === 'think');
  if (i > -1) state.chat.splice(i, 1);
  return chat('pip', text, opts);
}

/* ------------------------------- Pip's tools -------------------------------- */

$('readBtn').onclick = () => {
  if (Speech.speaking) return Speech.stop();
  chat('kid', 'Read it to me', { speak: false });
  Pip.set('happy');
  const text = state.current ? state.current.plainText : '';
  chat('pip', text, { emoji: '📖', speak: false });
  Speech.say(text, { rate: 0.86 });
  track('read-aloud');
};

$('wordBtn').onclick = () => setWordMode(!state.wordMode);

function setWordMode(on) {
  state.wordMode = on;
  $('story').classList.toggle('wordmode', on);
  $('wordBtn').classList.toggle('active', on);
  if (on) {
    chat('pip', 'Tap any word you do not know and I will tell you what it means.', { emoji: '👀' });
    Pip.set('curious');
    updateAskPlaceholder();
    $('askInput').focus();
  } else {
    document.querySelectorAll('.w.asked').forEach(e => e.classList.remove('asked'));
  }
}

$('askGo').onclick = () => {
  const v = $('askInput').value.trim();
  if (v) ask(v);
};
$('askInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('askGo').click(); });

$('micBtn').onclick = () => {
  if (state.listening) { state.listening(); state.listening = null; $('micBtn').classList.remove('listening'); Pip.set('idle'); return; }
  Speech.stop();
  $('micBtn').classList.add('listening');
  Pip.set('listen');
  state.listening = Speech.listen({
    onResult: t => { $('askInput').value = t; track('voice-ask', t); $('askGo').click(); },
    onEnd: () => { $('micBtn').classList.remove('listening'); state.listening = null; if (Pip.state === 'listen') Pip.set('idle'); },
    onError: () => { Pip.set('oops'); chat('pip', 'I could not hear that. You can type it instead.', { emoji: '🙉' }); }
  });
};

// Everything the child says goes through here — a tapped word, a pressed button,
// or free text. Pip receives the whole transcript, so a reply to his own question
// is answered as a reply instead of being looked up in a dictionary.
async function ask(message, { intent = null, el = null, show = null } = {}) {
  const text = String(message || '').trim();
  if (!text && intent !== 'start') return;

  Sound.operator();
  track(intent === 'start' ? 'where-do-i-start' : intent === 'word' ? 'ask-word' : 'say', text || intent);
  if (el) {
    document.querySelectorAll('.w.asked').forEach(e => e.classList.remove('asked'));
    el.classList.add('asked');
  }
  $('askInput').value = '';
  if (show !== false) chat('kid', show || text, { speak: false });

  // "can you draw it", "show me a picture", "I want to see it" — a child asking for
  // the picture in their own words should get the picture, not a paragraph about
  // the picture. This runs before the model call: it is faster, it is free, and a
  // model asked to "draw" can only describe, which is the opposite of the point.
  if (intent !== 'word' && wantsPicture(text)) {
    if (showSituation()) {
      chat('pip', 'Here it is — this is what the story says. It stops before the answer, '
                + 'so the counting is still yours.', { emoji: '🖍️', speak: false });
    } else {
      chat('pip', cannotDraw(), { emoji: '🖍️', speak: false });
    }
    return;
  }

  const t = thinking();
  Pip.set('think');

  let d = null;
  try {
    const res = await fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem: { ...state.current, tokens: undefined, quantities: undefined },
        message: text, intent,
        history: state.chat.filter(m => m.cls !== 'think').map(m => ({ who: m.who, text: m.text })),
        trace: state.trace,
        startStep: state.startStep
      })
    });
    if (res.ok) {
      const j = await res.json();
      if (j && j.say && !j.offline) d = j;
    }
  } catch { /* fall through to the offline answer */ }

  if (!d) d = offlineAnswer(text, intent);
  if (intent === 'start' || d.kind === 'nudge' || d.ladderAdvanced) state.startStep = Math.min(state.startStep + 1, 2);
  if (intent !== 'word') state.usedHelp = true;

  resolveThinking(t, d.say, { emoji: d.emoji || '', note: d.note || '' });
  Pip.flash(d.kind === 'redirect' ? 'oops' : 'happy', 2400);
  updateAskPlaceholder();
}

// No server, or no key: the dictionary and the ladder are already in the browser.
function offlineAnswer(text, intent) {
  if (intent === 'word' || (!intent && text.split(/\s+/).length <= 2)) {
    const w = lookupWord(text.replace(/^what(?:'| i)?s?\s+(?:is\s+)?(?:a|an|the)?\s*/i, ''),
                         state.current ? state.current.plainText : '');
    return { say: [w.meaning, w.inStory].filter(Boolean).join(' '), emoji: w.emoji, note: w.note || '', kind: 'word' };
  }
  const rung = START_LADDER[Math.min(state.startStep, START_LADDER.length - 1)];
  return { say: (intent === 'start' ? '' : 'Good thinking. ') + rung.text, emoji: rung.emoji, note: '', kind: 'nudge' };
}

$('startBtn').onclick = () => ask('', {
  intent: 'start',
  show: state.startStep === 0 ? 'Where do I start?' : 'I still do not know'
});

// The box should say what it is for right now: has Pip just asked something?
function updateAskPlaceholder() {
  const last = [...state.chat].reverse().find(m => m.who === 'pip' && m.cls !== 'think');
  const awaiting = last && /\?\s*$/.test(String(last.text).trim());
  $('askInput').placeholder = awaiting ? 'Answer Pip…' : 'Ask Pip anything…';
}

/* -------------------------------- interaction ------------------------------- */

const track = (type, value) => state.trace.push({ t: Date.now(), type, value });

function pushNum(t, srcEl) {
  Sound.number();
  state.eq.push({ kind: 'num', value: t.value, qid: t.qid });
  track('tap-number', `${t.value} (${t.label})`);
  $('quantHint').textContent = `${t.value} = ${t.label}`;
  renderEq();
  flyChip(srcEl, $('eqstrip').lastElementChild);
}

function pushOp(op) {
  Sound.operator();
  state.eq.push({ kind: op === '(' || op === ')' ? 'paren' : 'op', value: op });
  track('tap-operator', op);
  renderEq();
}

$('ops').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.op) return pushOp(b.dataset.op);
  Sound.undo();
  if (b.dataset.util === 'undo') { state.eq.pop(); track('undo'); }
  if (b.dataset.util === 'clear') { state.eq = []; track('clear'); }
  renderEq();
});

$('answer').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('check').disabled) check(); });
$('check').onclick = check;
$('soundBtn').onclick = () => { Sound.toggle(); if (!Sound.on) Speech.stop(); renderHeader(); };
$('levelupOk').onclick = () => $('levelup').classList.add('hidden');

/* ----------------------------- actions & ribbon ----------------------------- */

function clearActions() { $('actions').querySelectorAll('.dyn').forEach(b => b.remove()); }

function addAction(text, cls, fn) {
  const b = document.createElement('button');
  b.className = `${cls} dyn`; b.textContent = text; b.onclick = fn;
  $('actions').appendChild(b);
  return b;
}

function ribbon(text, good = false) {
  $('ribbonText').textContent = text;
  $('ribbon').className = 'ribbon' + (good ? ' good pop' : '');
}
function hideRibbon() { $('ribbon').className = 'ribbon hidden'; }

async function check() {
  Speech.stop();
  const built = state.eq.map(t => t.value).join('');
  const raw = $('answer').value.trim();
  const answer = raw === '' ? null : Number(raw);
  state.attempts++;
  track('submit', `${built} = ${raw || '(blank)'}`);
  chat('kid', `${built.replace(/x/g, '×').replace(/\//g, '÷').replace(/-/g, '−')} = ${raw || '?'}`, { speak: false });
  $('check').disabled = true;

  // The rule engine already knows — instantly, in this tab, for free — whether the
  // equation matches the story and the arithmetic holds. A correct answer needs no
  // model call: asking for one only puts a two-second "let me think" between a
  // child and the confetti they have just earned, and spends tokens confirming
  // something we were already certain about. The model is for when something went
  // WRONG, where the whole value is the question it asks back.
  const local = diagnose(state.current, built, answer, state.trace);
  if (local.correct) {
    state.lastDiag = local;
    return onCorrect(local);
  }
  // Equation right, arithmetic slipped: the rules have already said everything
  // worth saying, and if it happens twice we draw the sum rather than describe
  // it. Neither needs a model, so neither waits for one.
  if (local.misconception === 'computation-slip') {
    state.lastDiag = local;
    return onMisconception(local);
  }

  Pip.set('think');
  const t = thinking();

  let diag;
  try {
    const res = await fetch('/api/diagnose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem: { ...state.current, tokens: undefined, quantities: undefined },
        built, answer, trace: state.trace
      })
    });
    diag = await res.json();
  } catch {
    diag = { misconception: 'unknown', correct: false,
             ask: 'I could not reach my thinking just then — is the server still running? Try again.' };
  }
  t.remove();
  const i = state.chat.findIndex(m => m.cls === 'think');
  if (i > -1) state.chat.splice(i, 1);
  state.lastDiag = diag;
  diag.correct ? onCorrect(diag) : onMisconception(diag);
}

/* --------------------------------- outcomes --------------------------------- */

// Correct answers are handled locally, so these lines stand in for what the model
// used to write. They all say the same thing a good tutor says — name what the
// child DID, not just that they were right — and there are enough of them that a
// long run does not feel like a loop.
const CLEAN_PRAISE = [
  'Straight there. Your equation matches the story exactly.',
  'You read the story and built exactly what it described. That is the whole skill.',
  'No detour at all — you saw what was happening and wrote it down.',
  'That is a clean one. You picked the operation from the story, not from a keyword.',
  'Right first time. You worked out what the numbers were counting before you touched them.'
];
const RECOVERED_PRAISE = [
  'There it is — you changed your thinking and found it yourself.',
  'That is the good kind of hard. You rethought it and got there.',
  'You went back, looked again, and fixed it. That is exactly how this works.',
  'Found it. Changing your mind when the story does not fit is a real skill.'
];
const pick = a => a[Math.floor(Math.random() * a.length)];

/** A problem is over. Keep a dozen numbers about HOW it went, and nothing they typed. */
function recordProblem(solved) {
  const p = state.current;
  if (!p || state.recorded) return;
  state.recorded = true;
  P.history = Insight.remember(P.history, Insight.summarise(state.trace, {
    concept: p.concept, band: state.band ? state.band.id : null,
    solved, attempts: state.attempts,
    misconceptions: [state.lastMisconception].filter(k => k && k !== 'incomplete')
  }));
  save();
}

function onCorrect(diag) {
  touchStreak();
  recordProblem(true);
  const c = state.current.concept;
  const clean = state.attempts === 1 && !state.usedHelp;
  // A friend's puzzle, or one the child wrote, is not part of any level: it is
  // played for the pleasure of it. Counting it would let a child mint stars by
  // writing "1 + 1 = ?" and sending it to themselves.
  const practice = state.mode === 'practice' || !!state.current.authored;
  const band = state.band;

  // Practice problems are remedial and deliberately easier, so they build the
  // record of what the child can do but they never buy stars.
  const bStat = band ? statFor(c, band.id) : null;
  const starsBefore = bStat && !practice ? bandStars(bStat) : 0;
  const worldBefore = worldStars(P, c);
  const openBefore = new Set(ORDER.filter(k => worldUnlocked(P, k)));

  const st = conceptStat(c);
  st.solved++;
  if (clean) st.firstTry++;
  if (bStat && !practice) { bStat.solved++; if (clean) bStat.firstTry++; }
  if (!state.current.generated && !P.solvedIds.includes(state.current.id)) P.solvedIds.push(state.current.id);
  // `solvedIds` is the permanent record and deliberately skips generated problems,
  // of which there are 5,280. `recent` is the short rolling list a friend can be
  // matched against — bounded, because it rides inside every progress sync.
  if (!state.current.authored) {
    P.recent = (P.recent || []).filter(id => id !== state.current.id);
    P.recent.push(state.current.id);
    if (P.recent.length > RECENT_KEEP) P.recent = P.recent.slice(-RECENT_KEEP);
  }
  save();

  state.combo = clean ? state.combo + 1 : 0;
  Sound.correct();
  confetti($('eqstrip'), clean ? 40 : 26);
  pulse($('answer'));
  Pip.flash('cheer', 1400, 'happy');

  // Repeated addition earns a different reply from any other right answer: name
  // what the child did, then hand them the shorthand. This is the moment
  // multiplication is actually taught, and it only happens if the app noticed.
  if (diag.via && state.current.concept === 'mult-groups') {
    const { times, each } = diag.via;
    chat('pip', `That is exactly right — ${times} lots of ${each} is ${times * each}. `
      + `You wrote it the long way, which shows you understood the story. `
      + `There is a shorter way to write "${times} lots of ${each}": ${times} × ${each}. `
      + `It means the very same thing.`, { emoji: '🎉', cls: 'win' });
  } else {
    chat('pip', clean
      ? (diag.encouragement || pick(CLEAN_PRAISE))
      : pick(RECOVERED_PRAISE),
      { emoji: '🎉', cls: 'win' });
  }

  awardXp(practice ? XP.practice : clean ? XP.firstTry : XP.afterRetry);
  renderHeader();
  showFriendsWhoSolved(state.current);

  // Testing out of a level: only first-try solves count, so it cannot be ground out.
  let challengeWon = false;
  if (state.challenge) {
    if (clean && --state.challenge.left <= 0) { challengeWon = true; passChallenge(); }
    else if (clean) {
      chat('pip', `Nice — ${state.challenge.left} more like that and this level is yours.`,
           { emoji: '💪', speak: false });
    }
    // the counter is on screen, so it has to move now, not on the next problem
    if (state.challenge) $('storyLabel').textContent = `Challenge — ${state.challenge.left} to go`;
    else $('storyLabel').textContent = 'The story';
  }
  if (state.combo >= 2) { showCombo(`${state.combo} in a row!`); Sound.star(); }

  const starsNow = bStat && !practice ? bandStars(bStat) : 0;
  const gainedStar = starsNow > starsBefore;
  const newlyOpen = ORDER.filter(k => worldUnlocked(P, k) && !openBefore.has(k));
  const bandIdx = band ? bandsFor(c).findIndex(b => b.id === band.id) : -1;
  const nextBand = bandIdx >= 0 ? bandsFor(c)[bandIdx + 1] : null;
  const openedNextLevel = gainedStar && nextBand && starsBefore < 2 && starsNow >= 2;

  // Every celebration points at something the child can actually go and look at.
  // Skipping ahead comes first: it is the thing the child just chose to do, and
  // any planet it opened is folded into the same moment rather than replacing it.
  if (challengeWon) {
    const also = newlyOpen.length ? ` ${CONCEPTS[newlyOpen[0]].label} opened too.` : '';
    ribbon(`${band.label} unlocked — you skipped ahead`, true);
    setTimeout(() => showBigWin('🔓', 'Level unlocked!',
      `${CONCEPTS[c].label} — ${band.label}.${also}`), 850);
  } else if (newlyOpen.length) {
    ribbon(`New planet unlocked — ${CONCEPTS[newlyOpen[0]].label}`, true);
    setTimeout(() => showBigWin('🪐', 'New planet!',
      `${CONCEPTS[newlyOpen[0]].label} is open on the star map.`), 850);
  } else if (gainedStar && starsNow === 3) {
    ribbon(`${band.label} mastered`, true);
    setTimeout(() => showBigWin('★★★', 'Level mastered!', `${CONCEPTS[c].label} — ${band.label}`), 850);
  } else if (openedNextLevel) {
    ribbon(`Next level unlocked — ${nextBand.label}`, true);
  } else if (gainedStar) {
    ribbon(`Star earned — ${starsNow} of 3 on ${band.label}`, true);
  } else {
    const n = bStat && !practice ? nextStar(bStat) : null;
    if (state.current.authored)
      ribbon(state.current.from ? `You solved ${state.current.from}'s puzzle` : 'Your puzzle works', true);
    else
    ribbon(n ? n.text.replace(' → ', ' to get ')
             : (bStat && !practice ? `${band.label} is all yours — try a harder level`
                                   : (clean ? 'Straight there' : 'You worked it out')), true);
  }

  $('check').classList.add('hidden');
  clearActions();
  if (state.mode === 'practice') {
    state.solvedInRound++;
    renderDots();
    addAction('Next →', 'primary', nextProblem);
  } else if (!clean && state.lastMisconception) {
    addAction('Practice this idea', 'primary', () => startPractice(state.lastMisconception));
    addAction('Next problem', 'ghost', nextProblem);
    addAction('Send to a friend', 'ghost', shareCurrent);
  } else if (starsNow >= 3 && nextBand && bandUnlocked(P, c, bandIdx + 1)) {
    // There is nothing left to earn here. Point at the harder level rather than
    // letting a child grind a level they have already mastered.
    addAction(`Harder: ${nextBand.label} →`, 'primary', () => startBand(c, nextBand.id));
    addAction('One more here', 'ghost', nextProblem);
  } else if (state.current.authored) {
    addAction('Send to a friend', 'primary', shareCurrent);
    addAction('Back to the map', 'ghost', showRoad);
  } else {
    addAction('Next problem →', 'primary', nextProblem);
    addAction('Send to a friend', 'ghost', shareCurrent);
  }
}

function onMisconception(diag) {
  const key = diag.misconception;
  state.lastMisconception = key;
  const slip = key === 'computation-slip' || diag.severity === 'slip';
  state.combo = 0;

  if (key && key !== 'incomplete' && key !== 'computation-slip') {
    P.misconceptions[key] = (P.misconceptions[key] || 0) + 1;
    save();
  }

  Sound.curious();
  if (!slip) { const s = $('eqstrip'); s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake'); }
  Pip.set(slip ? 'oops' : 'curious');

  if (slip) { state.slips++; state.runSlips++; } else { state.runWrong++; }
  const secondSlip = slip && state.slips >= 2 && canExplain(state.current.correct);

  // A challenge is a claim to already know this. A miscount does not disprove it;
  // building the wrong model does.
  if (state.challenge && !slip) {
    Sound.curious();
    Pip.set('oops');
    chat('pip', diag.ask || 'Let us look at that again.', { emoji: '🤔' });
    ribbon('Not this time — that is fine', false);
    $('check').classList.add('hidden');
    renderDiag(diag);
    return failChallenge();
  }

  if (diag.encouragement && !slip) chat('pip', diag.encouragement, { speak: false });
  chat('pip', secondSlip
    ? 'Your equation is right, so let me show you the counting instead of just telling you.'
    : (diag.ask || 'Tell me how you decided on that.'), { emoji: slip ? '👍' : '🤔' });
  ribbon(slip ? 'Your thinking is right — check the counting' : 'Pip has a question for you');

  $('check').classList.add('hidden');
  clearActions();
  // When the equation was right, the child should not have to rebuild it to fix
  // a number. Keep it, clear only the answer, and say so on the button.
  if (slip) addAction('Try the number again', 'primary', () => retry({ keepEquation: true }));
  else addAction('Let me try again', 'primary', retry);
  if (!slip) addAction('Give me a hint', 'ghost', () => showHint(diag));
  if (!slip && canShowSituation(state.current)) addAction('Show me the story', 'ghost', showSituation);
  if (secondSlip) showViz(state.current.correct);

  // If Pip can see the trouble is the SIZE of the numbers rather than the idea,
  // going back a level is the useful suggestion — and it is an offer, never a
  // demotion. Made once per visit so it does not nag.
  const easier = easierBand(P, state.world, state.band && state.band.id);
  if (easier && !state.offeredEasier && (state.runSlips >= 2 || state.runWrong >= 3)) {
    state.offeredEasier = true;
    chat('pip', state.runSlips >= 2
      ? `Your thinking keeps being right — it is the counting with numbers this big that is hard. `
        + `We could do ${easier.label} for a bit and come back.`
      : `These are fighting back a little. ${easier.label} would build this up first — `
        + `only if you want to.`, { emoji: '🌱', speak: false });
    addAction(`Try ${easier.label}`, 'ghost', () => startBand(state.world, easier.id));
  }

  // STOP ASKING, START SHOWING. A Socratic question only works on a child who
  // has a model to interrogate. Two wrong attempts, or a diagnosis of "something
  // else is going on", means we do not know what they are thinking and neither
  // do they — so asking "why did you choose that?" a third time is pressure, not
  // teaching. Draw the story instead.
  if (!slip && (state.attempts >= 2 || key === 'unknown') && canShowSituation(state.current)) {
    if (showSituation()) {
      chat('pip', 'Let me draw the story for you instead. Have a look, then count.',
           { emoji: '🎨', speak: false });
    }
  }
  renderDiag(diag);
}

/* ------------------------- showing the arithmetic --------------------------- */

let viz = null;

function hideViz() {
  if (viz) { viz.stop(); viz = null; }
  $('vizCard').classList.add('hidden');
  $('vizHost').innerHTML = '';
}

/**
 * Draw the STORY, not the answer. Pip asks children to draw the situation in four
 * different places; this is the app doing it for them. It never shows a total or
 * an equation, so it is a way in rather than a way out.
 */
function showSituation() {
  if (!canShowSituation(state.current)) return false;
  $('vizTitle').textContent = 'The story as a picture';
  $('vizCard').classList.remove('hidden');
  track('show-situation', state.current.id);
  state.usedHelp = true;
  if (viz) viz.stop();
  viz = mountSituation($('vizHost'), state.current);
  if (!viz) { hideViz(); return false; }
  $('vizReplay').onclick = () => { Sound.operator(); viz.replay(); };
  $('vizCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return true;
}

function showViz(equation) {
  const pretty = equation.replace(/x/g, ' × ').replace(/\//g, ' ÷ ')
                         .replace(/\+/g, ' + ').replace(/-/g, ' − ');
  $('vizTitle').textContent = `Counting ${pretty}`;
  $('vizCard').classList.remove('hidden');
  track('viz', equation);
  viz = mountExplainer($('vizHost'), equation, { hold: 1900 });
  if (!viz) return hideViz();
  $('vizReplay').onclick = () => { Sound.operator(); viz.replay(); };
}

function retry(opts) {
  // The click handler passes an Event, so only an explicit object counts.
  const keep = !!(opts && opts.keepEquation === true);
  if (!keep) state.eq = [];
  track(keep ? 'retry-number' : 'retry');
  renderEq();                       // also re-enables Check when the equation stands
  $('answer').value = '';
  hideRibbon();
  clearActions();
  $('check').classList.remove('hidden');
  if (!keep) $('check').disabled = true;
  Pip.set('idle');
  if (keep) { $('answer').focus(); pulse($('answer')); }
}

function showHint(diag) {
  track('hint');
  state.usedHelp = true;
  chat('kid', 'Give me a hint', { speak: false });
  chat('pip', diag.hint || MISCONCEPTIONS[diag.misconception]?.hint || 'Read the story one sentence at a time.', { emoji: '💡' });
  clearActions();
  addAction('Let me try again', 'primary', retry);
  addAction('I am still stuck', 'ghost', () => showExplain(diag));
}

function showExplain(diag) {
  track('explain');
  state.usedHelp = true;
  chat('kid', 'I am still stuck', { speak: false });
  chat('pip', diag.explain || MISCONCEPTIONS[diag.misconception]?.explain || '', { emoji: '🧩' });
  clearActions();
  addAction('Try it now', 'primary', retry);
}

function renderDiag(diag) {
  const d = $('fbDetails');
  if (!diag.misconception || diag.misconception === 'incomplete') { d.classList.add('hidden'); return; }
  $('fbDiag').innerHTML = `<b>${esc(diag.label || diag.misconception)}</b><br>${esc(diag.why || '')}
    <br><span style="opacity:.7">diagnosed by ${diag.source === 'claude' ? 'Claude' : 'the rule engine'}${diag.ruleGuess && diag.ruleGuess !== diag.misconception ? ` · rules guessed ${esc(diag.ruleGuess)}` : ''}</span>`;
  d.open = false;
  d.classList.remove('hidden');
}

// The old "Level up!" popup celebrated a number the tester could not explain.
// Same juice, now spent on the two things he CAN point at: a level mastered,
// and a new planet opening on the map.
function showBigWin(mark, label, sub) {
  $('levelupNum').textContent = mark;
  $('levelupLabel').textContent = label;
  $('levelupSub').textContent = sub || '';
  $('levelup').classList.remove('hidden');
  Sound.levelUp();
  confetti(null, 60);
}

/* ------------------------------ practice rounds ----------------------------- */

async function startPractice(misconception) {
  chat('pip', 'Let me build you three problems that use exactly this idea…', { emoji: '🎯', speak: false });
  Pip.set('think');
  clearActions();
  try {
    const res = await fetch('/api/practice', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem: { ...state.current, tokens: undefined, quantities: undefined },
        misconception, count: 3
      })
    });
    state.practiceQueue = (await res.json()).problems || [];
  } catch { state.practiceQueue = []; }

  if (!state.practiceQueue.length) return nextProblem();
  state.mode = 'practice';
  state.practiceTarget = misconception;
  state.solvedInRound = 0;
  nextProblem();
}

function finishPractice() {
  const key = state.practiceTarget;
  const cleared = key && P.misconceptions[key];
  if (cleared) { P.misconceptions[key] = Math.max(0, P.misconceptions[key] - 1); save(); }
  state.mode = 'main';
  state.practiceTarget = null;
  $('dots').innerHTML = '';

  if (cleared) {
    awardXp(XP.clearedMisconception, 'that tricky idea');
    Sound.cheer(); confetti(null, 55);
    Pip.set('cheer');
    chat('pip', 'You got all three. That idea used to trip you up — it does not any more.', { emoji: '🏅', cls: 'win' });
    ribbon(`Idea unlocked  ·  +${XP.clearedMisconception} XP`, true);
    $('check').classList.add('hidden');
    $('fbDetails').classList.add('hidden');
    clearActions();
    addAction('Back to the star map', 'primary', showRoad);
    return;
  }
  buildQueue();
  nextProblem();
}

boot();

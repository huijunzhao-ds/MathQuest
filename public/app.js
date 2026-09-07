import { allProblems, problemsFor, bandsFor, bandOfProblem, diagnose, CONCEPTS, MISCONCEPTIONS } from '/shared/engine.js';
import { Sound, confetti, flyChip, pulse, Pip } from '/juice.js';
import { Speech } from '/speech.js';
import { lookupWord, START_LADDER } from '/shared/dictionary.js';
import * as Profiles from '/shared/profiles.js';
import * as Cloud from '/cloud.js';
import { canExplain, mountExplainer, canShowSituation, mountSituation } from '/mathviz.js';
import {
  MAP_POS, MAP_ROWS, PREREQS, bandKey, bandStat, bandStars, nextStar,
  worldStars, worldMaxStars, worldUnlocked, bandUnlocked, lockReason,
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
function save() {
  P.updatedAt = Date.now();
  Profiles.saveProgress(ME.id, P);
  cloudPush();
}

const blankProgress = () => ({
  xp: 0, streakDays: 0, bestStreak: 0, lastPlayed: null,
  concepts: {}, bands: null, testedOut: {}, solvedIds: [], misconceptions: {}
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
  combo: 0, wordMode: false, listening: null,
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
  Pip.mount($('pip'), $('pipHome'));
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
      if (added) renderRoad();
    } catch { /* the game does not depend on this */ }
  }
  // They clicked a link in their email; show them the page that link was for,
  // even if a reload happened in between.
  if (wantedParents()) showParents();
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
    syncState = 'saving'; renderSync();
    const ok = await Cloud.saveChild(ME.remote, { progress: P });
    // A failed save is never reported as a save. The local copy is untouched
    // either way, so nothing is lost — but the parent gets told.
    syncState = ok ? 'saved' : 'failed'; renderSync();
  }, 1500);
}

/** Take the account's copy only if it is genuinely newer than this device's. */
async function cloudPull() {
  if (!Cloud.signedIn() || !ME.remote) return;
  const kids = await Cloud.children();
  if (!kids) return;                                  // could not tell — leave local alone
  const mine = kids.find(k => k.id === ME.remote);
  if (!mine || !mine.progress) return;
  const cloudAt = Date.parse(mine.updated_at || 0) || 0;
  if (cloudAt <= (P.updatedAt || 0)) return;
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, migrate(Object.assign(blankProgress(), mine.progress)));
  Profiles.saveProgress(ME.id, P);                    // not save(): do not bump the clock
  renderHeader();
  if (!$('roadScreen').classList.contains('hidden')) renderRoad();
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
      const cloudAt = Date.parse(k.updated_at || 0) || 0;
      if (cloudAt > (mine.updatedAt || 0)) {
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

/* ---------------------------- the grown-ups page ---------------------------- */

const gradeOptions = (sel = '') =>
  `<option value="">School year…</option>` +
  Profiles.GRADES.map(g => `<option value="${g.n}" ${String(sel) === String(g.n) ? 'selected' : ''}>${g.label}</option>`).join('');

function showParents() {
  Speech.stop();
  $('roadScreen').classList.add('hidden');
  $('playScreen').classList.add('hidden');
  $('whoModal').classList.add('hidden');
  $('parentScreen').classList.remove('hidden');
  $('homeBtn').classList.remove('hidden');
  renderParents();
}

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
    $('pEmail').disabled = $('pSend').disabled = true;
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

  $('pUpload').textContent = list.some(p => !p.remote)
    ? 'Save players on this device to my account' : 'All players are on your account';
  $('pUpload').disabled = !list.some(p => !p.remote);
  renderSync();
}

$('pGoogle').onclick = () => Cloud.signInWithGoogle();
$('parentsBtn').onclick = showParents;
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
$('pSignIn').onclick = () => useCredentials('in');
$('pSignUp').onclick = () => useCredentials('up');
$('pPass').onkeydown = e => { if (e.key === 'Enter') $('pSignIn').click(); };
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
  const made = await Cloud.addChild(name, {});
  if (made) Profiles.linkProfile(p.id, made.id);
  msg.className = made ? 'good' : 'bad';
  msg.textContent = made ? `${name} is ready to play.`
    : `${name} is ready on this device, but could not be saved to your account.`;
  $('pNewName').value = ''; $('pNewGrade').value = '';
  renderParents();
};
$('pNewName').onkeydown = e => { if (e.key === 'Enter') $('pAdd').click(); };

$('pUpload').onclick = async () => {
  const msg = $('pMsg2'); msg.className = ''; msg.textContent = 'Saving…';
  let ok = 0, failed = 0;
  for (const p of Profiles.listProfiles()) {
    if (p.remote) continue;
    const made = await Cloud.addChild(p.name, Profiles.loadProgress(p.id));
    if (made) { Profiles.linkProfile(p.id, made.id); ok++; } else failed++;
  }
  msg.className = failed ? 'bad' : 'good';
  msg.textContent = failed
    ? `Saved ${ok}, but ${failed} did not go up. Everything is still safe on this device.`
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
  renderRoad();
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

function startBand(concept, bandId, opts = {}) {
  state.world = concept;
  state.band = bandsFor(concept).find(b => b.id === bandId) || bandsFor(concept)[0];
  state.mode = 'main';
  state.runWrong = 0; state.runSlips = 0; state.offeredEasier = false;
  state.challenge = opts.challenge ? { left: TEST_OUT_REQUIRED } : null;
  buildQueue();
  $('roadScreen').classList.add('hidden');
  $('playScreen').classList.remove('hidden');
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
  chat('kid', 'Show me', { speak: false });
  if (!showSituation()) chat('pip', 'I cannot draw this one yet — try "Where do I start?"', { speak: false });
};

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
  state.current = p;
  state.eq = []; state.trace = [];
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
  $('showBtn').classList.toggle('hidden', !canShowSituation(p));

  // The whole screen takes the colour of the world you are standing in.
  const c = CONCEPTS[p.concept];
  document.documentElement.style.setProperty('--world', c.color);
  document.documentElement.style.setProperty('--world-glow', c.glow);

  const stat = state.band ? bandStat(P, state.world, state.band.id) : { solved: 0, firstTry: 0 };
  const nxt = state.mode === 'practice' ? null : nextStar(stat);
  $('youarehere').innerHTML = `<button class="backbtn" id="backBtn">← Star map</button>
    <span class="wherechip">${state.mode === 'practice' ? 'Practice' : c.icon + esc(c.label)}</span>
    ${state.band && state.mode !== 'practice' ? `<span class="whereband">${esc(state.band.label)}</span>` : ''}
    <span class="wherestars">${stars3(bandStars(stat))}</span>
    ${nxt ? `<span class="wherenext">${esc(nxt.text)}</span>` : ''}`;
  $('backBtn').onclick = showRoad;
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

function onCorrect(diag) {
  touchStreak();
  const c = state.current.concept;
  const clean = state.attempts === 1 && !state.usedHelp;
  const practice = state.mode === 'practice';
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
  } else if (starsNow >= 3 && nextBand && bandUnlocked(P, c, bandIdx + 1)) {
    // There is nothing left to earn here. Point at the harder level rather than
    // letting a child grind a level they have already mastered.
    addAction(`Harder: ${nextBand.label} →`, 'primary', () => startBand(c, nextBand.id));
    addAction('One more here', 'ghost', nextProblem);
  } else {
    addAction('Next problem →', 'primary', nextProblem);
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

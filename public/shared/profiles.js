// Who is playing.
//
// Progress used to live under one key, which meant one child per browser. On a
// shared laptop the second child inherits the first child's road — stars, unlocked
// levels, and a list of misconceptions that are not theirs. That is wrong twice
// over: it breaks the progression and it shows a child someone else's mistakes.
//
// So progress is now keyed per profile. This module owns nothing but the keys and
// the migration; the shape of `progress` itself is still progress.js's business.
//
// Accounts are OPTIONAL and sit on top of this, never underneath it. A child who
// has never signed in has a local profile that works exactly as before, because
// the submission link has to open into a game rather than a login form.

/* ---------------------------- school year ----------------------------------- */
// A grade goes stale every September; a date of birth does not, but a date of
// birth is the field that makes a child's record identifying. Storing the grade
// AND the school year it was set in gets the best of both: it rolls forward on
// its own, it is never edited in an ordinary year, and the record says
// "started Grade 2 in 2026" rather than naming a date.

export const GRADES = [
  { n: 0, label: 'Kindergarten' }, { n: 1, label: 'Grade 1' }, { n: 2, label: 'Grade 2' },
  { n: 3, label: 'Grade 3' },      { n: 4, label: 'Grade 4' }, { n: 5, label: 'Grade 5' },
  { n: 6, label: 'Grade 6 or above' }
];

/** The school year a date falls in. A new one starts in August. */
export function schoolYear(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  return t.getMonth() >= 7 ? t.getFullYear() : t.getFullYear() - 1;
}

/** What grade a child is in NOW, from what they were in when it was set. */
export function currentGrade(profile, now = new Date()) {
  if (!profile || profile.grade === undefined || profile.grade === null) return null;
  const set = Number(profile.gradeYear);
  const base = Number(profile.grade);
  if (!Number.isFinite(base)) return null;
  const years = Number.isFinite(set) ? Math.max(0, schoolYear(now) - set) : 0;
  return Math.min(6, base + years);
}

export const gradeLabel = n =>
  (n === null || n === undefined ? 'Not set' : (GRADES.find(g => g.n === n) || GRADES[6]).label);

export const LEGACY_KEY = 'mq.progress';
export const INDEX_KEY = 'mq.profiles';
export const progressKey = id => `mq.progress.${id}`;

const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

/** { active: id|null, list: [{ id, name, created, remote? }] } */
export function loadIndex() {
  const ix = read(INDEX_KEY, null);
  if (!ix || !Array.isArray(ix.list)) return { active: null, list: [] };
  return { active: ix.active || (ix.list[0] && ix.list[0].id) || null, list: ix.list };
}

export function saveIndex(ix) { return write(INDEX_KEY, ix); }

export function listProfiles() { return loadIndex().list; }
export function activeProfile() {
  const ix = loadIndex();
  return ix.list.find(p => p.id === ix.active) || ix.list[0] || null;
}

export function createProfile(name, { activate = true } = {}) {
  const ix = loadIndex();
  const p = { id: newId(), name: String(name || '').trim().slice(0, 24) || 'Player', created: Date.now() };
  ix.list.push(p);
  if (activate || !ix.active) ix.active = p.id;
  saveIndex(ix);
  return p;
}

/** Tie a local profile to a row in the parent's account. */
export function linkProfile(id, remoteId) {
  const ix = loadIndex();
  const p = ix.list.find(x => x.id === id);
  if (!p) return false;
  p.remote = remoteId;
  saveIndex(ix);
  return true;
}

/** Forget the account link everywhere, keeping every child's progress on this device. */
export function unlinkAll() {
  const ix = loadIndex();
  ix.list.forEach(p => { delete p.remote; });
  saveIndex(ix);
}

export function selectProfile(id) {
  const ix = loadIndex();
  if (!ix.list.some(p => p.id === id)) return false;
  ix.active = id; saveIndex(ix);
  return true;
}

export function renameProfile(id, name) { return updateProfile(id, { name }); }

/** Edit the parts of a profile that are not progress. */
export function updateProfile(id, { name, grade } = {}) {
  const ix = loadIndex();
  const p = ix.list.find(x => x.id === id);
  if (!p) return false;
  if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 24);
  if (grade === null) { delete p.grade; delete p.gradeYear; }
  else if (grade !== undefined && Number.isFinite(Number(grade))) {
    p.grade = Math.max(0, Math.min(6, Number(grade)));
    p.gradeYear = schoolYear();          // stamped now, so it can roll forward later
  }
  saveIndex(ix);
  return true;
}

/** Wipes one child's progress but keeps the profile — "start fresh", not "delete me". */
export function resetProgress(id) {
  try { localStorage.removeItem(progressKey(id)); return true; } catch { return false; }
}

export function removeProfile(id) {
  const ix = loadIndex();
  const before = ix.list.length;
  ix.list = ix.list.filter(p => p.id !== id);
  if (ix.list.length === before) return false;
  if (ix.active === id) ix.active = ix.list[0] ? ix.list[0].id : null;
  resetProgress(id);
  saveIndex(ix);
  return true;
}

export function loadProgress(id) { return read(progressKey(id), {}); }
export function saveProgress(id, P) { return write(progressKey(id), P); }

/**
 * THE CAREFUL BIT. A browser that already has progress under the old single key
 * holds weeks of a real child's work. It is moved into a first profile, and the
 * old key is left exactly where it is — if anything here is wrong, the original
 * is still sitting there untouched and recoverable.
 *
 * Returns the profile that should be active.
 */
export function ensureProfile(defaultName = 'Player 1') {
  const ix = loadIndex();
  if (ix.list.length) return activeProfile();

  const legacy = read(LEGACY_KEY, null);
  const p = createProfile(defaultName);
  const ix2 = loadIndex();
  const me = ix2.list.find(x => x.id === p.id);
  if (legacy && typeof legacy === 'object') {
    saveProgress(p.id, legacy);
    if (me) me.migrated = true;
  } else if (me) {
    // Nothing was here to migrate, so this profile is a placeholder the app
    // invented rather than a child anyone named. On a device that then signs in,
    // it would sit next to the real children as an empty duplicate — so it is
    // marked, and pruned once the account's own children arrive.
    me.auto = true;
  }
  saveIndex(ix2);
  return activeProfile();
}

/**
 * Drop placeholder profiles the app invented, once there is something real to
 * replace them. Never touches a profile that has a name someone chose, any
 * progress, or a link to the account — and never removes the last one.
 */
export function pruneAuto() {
  const ix = loadIndex();
  const keep = ix.list.filter(p => {
    if (!p.auto || p.remote) return true;
    const prog = loadProgress(p.id);
    return prog && Object.keys(prog).length > 0;
  });
  if (!keep.length || keep.length === ix.list.length) return 0;
  const dropped = ix.list.length - keep.length;
  for (const p of ix.list) if (!keep.includes(p)) resetProgress(p.id);
  ix.list = keep;
  if (!keep.some(p => p.id === ix.active)) ix.active = keep[0].id;
  saveIndex(ix);
  return dropped;
}

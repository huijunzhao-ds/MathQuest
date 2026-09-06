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

export function createProfile(name) {
  const ix = loadIndex();
  const p = { id: newId(), name: String(name || '').trim().slice(0, 24) || 'Player', created: Date.now() };
  ix.list.push(p);
  ix.active = p.id;
  saveIndex(ix);
  return p;
}

export function selectProfile(id) {
  const ix = loadIndex();
  if (!ix.list.some(p => p.id === id)) return false;
  ix.active = id; saveIndex(ix);
  return true;
}

export function renameProfile(id, name) {
  const ix = loadIndex();
  const p = ix.list.find(x => x.id === id);
  if (!p) return false;
  p.name = String(name || '').trim().slice(0, 24) || p.name;
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
  if (legacy && typeof legacy === 'object') {
    saveProgress(p.id, legacy);
    const ix2 = loadIndex();
    const me = ix2.list.find(x => x.id === p.id);
    if (me) { me.migrated = true; saveIndex(ix2); }
  }
  return activeProfile();
}

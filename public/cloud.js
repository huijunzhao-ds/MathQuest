// The parent's account, from the browser's side.
//
// Three rules this module exists to keep:
//
//   1. NOTHING here is required. Every call fails soft. A child whose parent has
//      never signed in, or whose wifi is down, or whose token expired, plays
//      exactly as before — the submission link opens into a game, not a form.
//   2. The browser never talks to Supabase. It talks to our server, which talks
//      to Supabase with the parent's own token, so the database's own row level
//      security is what protects one family from another.
//   3. A failed save is never reported as a save. Sync state is visible.

const SESSION_KEY = 'mq.session';

const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function session() { return read(SESSION_KEY, null); }
export function signedIn() { const s = session(); return Boolean(s && s.access_token); }
export function email() { const s = session(); return s && s.email; }
export function signOut() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

/** Is the feature switched on at all on this deployment? */
export async function enabled() {
  try {
    const r = await fetch('/api/account/status');
    const j = await r.json();
    return Boolean(j && j.enabled);
  } catch { return false; }
}

/**
 * A magic link comes back as a URL fragment. Read it, keep it, and scrub it from
 * the address bar — a token sitting in a URL gets copied, pasted and shared.
 */
export function captureLinkFromUrl() {
  const h = location.hash || '';
  if (!h.includes('access_token=')) return false;
  const p = new URLSearchParams(h.slice(1));
  const access_token = p.get('access_token');
  if (!access_token) return false;
  write(SESSION_KEY, {
    access_token,
    refresh_token: p.get('refresh_token') || null,
    expires_at: Date.now() + (Number(p.get('expires_in') || 3600) * 1000)
  });
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

async function refresh() {
  const s = session();
  if (!s || !s.refresh_token) return false;
  try {
    const r = await fetch('/api/account/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) { signOut(); return false; }
    const j = await r.json();
    write(SESSION_KEY, { access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token,
                         expires_at: Date.now() + (Number(j.expires_in || 3600) * 1000),
                         email: j.email || s.email });
    return true;
  } catch { return false; }
}

/** One retry on 401, because an expired token is the normal case, not an error. */
async function call(path, opts = {}, retried = false) {
  const s = session();
  if (!s) return { ok: false, status: 401, json: null };
  let r;
  try {
    r = await fetch(path, { ...opts, headers: {
      'content-type': 'application/json', authorization: `Bearer ${s.access_token}`, ...(opts.headers || {})
    } });
  } catch { return { ok: false, status: 0, json: null, offline: true }; }
  if (r.status === 401 && !retried && await refresh()) return call(path, opts, true);
  let j = null; try { j = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, json: j };
}

export async function sendLink(address) {
  const r = await fetch('/api/account/link', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: address })
  });
  const j = await r.json().catch(() => ({}));
  // A parent should not be shown a raw Postgres error, but whoever is setting
  // this up needs it — so the detail goes to the console, not the screen.
  if (!r.ok && j.detail) console.warn('[accounts] sign-in failed:', j.detail);
  return { ok: r.ok, error: j.error };
}

export async function whoAmI() {
  const r = await call('/api/account/me');
  if (r.ok && r.json && r.json.email) {
    const s = session(); write(SESSION_KEY, { ...s, email: r.json.email });
  }
  return r.ok ? r.json : null;
}

export async function children() {
  const r = await call('/api/account/children');
  return r.ok && r.json ? (r.json.children || []) : null;   // null means "could not tell"
}

export async function addChild(name, progress) {
  const r = await call('/api/account/children', { method: 'POST', body: JSON.stringify({ name, progress }) });
  return r.ok && r.json ? r.json.child : null;
}

export async function saveChild(id, { name, progress } = {}) {
  const r = await call(`/api/account/children/${id}`, { method: 'PUT', body: JSON.stringify({ name, progress }) });
  return r.ok;   // false is a real failure, and the caller must show it
}

export async function removeChild(id) {
  const r = await call(`/api/account/children/${id}`, { method: 'DELETE' });
  return r.ok;
}

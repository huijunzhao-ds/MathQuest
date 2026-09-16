// Every endpoint the browser calls has to exist on the server.
//
// This test exists because of a bug it would have caught in a second. The friends
// routes were written inside the `startsWith('/api/account')` block, so the router
// never reached them and every one returned 404 — the entire feature, unreachable
// in production, while the browser tests passed happily because they stubbed
// `fetch` and never asked the real server anything.
//
// So this one asks the real server. It starts it on a spare port and calls every
// path the CLIENT SOURCE mentions. 404 is the failure: it means the route is not
// there. 401 is a pass — the route exists and wants a sign-in, which is the correct
// answer to an unauthenticated call.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = 5390;
const fails = [];
const fail = m => fails.push(m);

/* -------- what does the client actually call? read it out of the source -------- */
const sources = ['../public/cloud.js', '../public/app.js']
  .map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');

const paths = new Set();
for (const m of sources.matchAll(/['"`](\/api\/[a-z0-9/._-]*)/gi)) {
  let p = m[1].replace(/\/$/, '');
  if (p.length > 4) paths.add(p);
}
// Template literals with an id in them: `/api/account/children/${id}` arrives as
// "/api/account/children/" — call it with a real-looking uuid.
const CALLABLE = [...paths].map(p =>
  p.endsWith('/') ? p + '00000000-0000-4000-8000-000000000000' : p);

if (CALLABLE.length < 8) fail(`only found ${CALLABLE.length} endpoints in the client — the scan is broken`);

/* --------------------------------- run it ------------------------------------ */
const server = spawn(process.execPath, [new URL('../server.js', import.meta.url).pathname], {
  env: { ...process.env, PORT: String(PORT), PUZZLE_SECRET: 'routes-test' },
  stdio: ['ignore', 'pipe', 'pipe']
});
const bye = () => { try { server.kill(); } catch {} };
process.on('exit', bye);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start in 10s')), 10000);
  const look = d => { if (String(d).includes('MathQuest')) { clearTimeout(timer); resolve(); } };
  server.stdout.on('data', look);
  server.stderr.on('data', look);
});
await new Promise(r => setTimeout(r, 300));

const hit = async (path, method) => {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' || method === 'PUT' ? { body: '{}' } : {})
    });
    return res.status;
  } catch (e) { return `error: ${e.message}`; }
};

for (const path of CALLABLE.sort()) {
  // Try the verbs the client uses; a route only has to answer one of them.
  const codes = [];
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) codes.push(await hit(path, method));
  const found = codes.some(c => c !== 404 && c !== 405);
  if (!found) fail(`${path} — every verb 404s, so nothing on the server answers it`);
}
console.log(`  all ${CALLABLE.length} endpoints the client calls are reachable on the server`);

/* ------------ an unauthenticated call is refused, not quietly served ----------- */
const guarded = CALLABLE.filter(p => p.startsWith('/api/account/') || p.startsWith('/api/friends'));
for (const path of guarded) {
  if (/signup|signin|link|refresh|status|oauth/.test(path)) continue;   // these are how you get a token
  const code = await hit(path, 'GET');
  if (code === 200) fail(`${path} answered 200 with no sign-in`);
}
console.log(`  ${guarded.length} account and friends endpoints refuse a call with no sign-in`);

/* ---------------- and the open ones still work with no account ---------------- */
for (const [path, want] of [['/api/status', 200], ['/api/puzzle/open', 400]]) {
  const code = await hit(path, path === '/api/status' ? 'GET' : 'POST');
  if (code !== want) fail(`${path} answered ${code}, expected ${want}`);
}
console.log('  the endpoints that need no account still answer without one');

bye();
if (fails.length) { console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n')); process.exit(1); }
console.log('\n  the client and the server agree on what exists\n');

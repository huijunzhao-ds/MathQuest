// The account plumbing, checked without a database.
//
// The bug that prompted this: a player would not upload and the app said "1 did
// not go up" with no reason, which is a message that wastes an evening. Two things
// are covered here — reading the parent's id out of their own token so an INSERT
// can name its owner instead of hoping for a column default, and turning whatever
// PostgREST complains about into something a parent can act on.

import { readFileSync } from 'node:fs';

// Pulled out of the source rather than imported: server.js starts listening on import.
const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const grab = name => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} is not in server.js`);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
};
const subjectOf = new Function(grab('subjectOf') + '\nreturn subjectOf;')();
const whySupabase = new Function(grab('whySupabase') + '\nreturn whySupabase;')();

const fails = [];
const fail = m => fails.push(m);
const token = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig';

/* 1 ------------------------------------- the owner of a row comes from the token */
for (const [tok, want, what] of [
  [token({ sub: 'abc-123', role: 'authenticated' }), 'abc-123', 'a real token'],
  [token({ role: 'anon' }), null, 'a token with no subject'],
  [token({ sub: '' }), null, 'an empty subject'],
  [token({ sub: 42 }), null, 'a subject that is not a string'],
  ['', null, 'nothing at all'],
  ['nonsense', null, 'a string that is not a token'],
  ['a.b', null, 'a token with two parts'],
  ['a.!!!!.c', null, 'a token whose middle is not base64'],
  [null, null, 'null']
]) {
  const got = subjectOf(tok);
  if (got !== want) fail(`${what} read as ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
console.log('  the parent id is read from a real token, and every broken one is refused');

/* 2 -------------------------------------------- a failure has to say what to do */
for (const [body, expect, what] of [
  ['new row violates row-level security policy for table "child"', /policy/i, 'an RLS refusal'],
  ['null value in column "owner" of relation "child" violates not-null', /who that player belongs to/i, 'a missing owner'],
  ['column "friend_code" does not exist', /sql\/02-friends/i, 'the friends SQL not having been run'],
  ['Could not find the table in the schema cache', /SQL files/i, 'a missing table'],
  ['duplicate key value violates unique constraint "child_pkey"', /already on the account/i, 'a duplicate']
]) {
  const said = whySupabase({ status: 400, body });
  if (!expect.test(said)) fail(`${what} explained as "${said}"`);
  if (said.length > 140) fail(`the explanation for ${what} is too long to read: ${said.length} chars`);
}
if (!/expired|sign out/i.test(whySupabase({ status: 401, body: '' })))
  fail('an expired sign-in is not explained as one');
// Whatever happens, the parent gets a sentence rather than a blank.
for (const r of [{ status: 500, body: '' }, { status: 0, body: null }, {}])
  if (!whySupabase(r) || whySupabase(r).length < 8) fail(`an unknown failure produced "${whySupabase(r)}"`);
console.log('  every database complaint becomes something a parent can act on');

/* 3 ------------------------ the school year: null is "not set", not Kindergarten */
// Number(null) is 0, which is finite. The guard has to test the value, not its
// number-ness, or a child with no school year is filed as being in Kindergarten.
const addBlock = src.slice(src.indexOf("req.method === 'POST' && url.pathname === '/api/account/children'"));
const guard = addBlock.slice(0, addBlock.indexOf('supa('));
if (!guard || guard.length > 2000) throw new Error('could not find the add-child handler');
if (!/grade !== null/.test(guard))
  fail('the add-child guard does not exclude a null school year, so it files as Kindergarten');
if (!/row\.owner\s*=/.test(guard))
  fail('the add-child insert does not set owner explicitly');
if (!fails.length) console.log('  a child with no school year is not quietly filed into Kindergarten');

if (fails.length) { console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n')); process.exit(1); }
console.log('\n  the account plumbing says what went wrong instead of swallowing it\n');

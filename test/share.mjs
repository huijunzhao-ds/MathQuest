// A puzzle written by one child is shown to another, so the rules about what can
// travel are tested rather than trusted — including the case where the link itself
// has been edited by hand.
//
// The design under test: a shared link carries NO prose. A generated puzzle is an
// id; a child-built one is a shape index, two word indices and two numbers. So the
// question these tests ask is not "did the filter catch the bad word" — a word
// blocklist cannot be complete and this app no longer relies on one — but "can a
// link, however it is edited, ever produce something that is not one of the puzzles
// the app itself would build".

global.btoa ??= s => Buffer.from(s, 'binary').toString('base64');
global.atob ??= s => Buffer.from(s, 'base64').toString('binary');

const S = await import('../public/shared/share.js');
const A = await import('../public/shared/authoring.js');
const { hydrate, diagnose, safeEval, MISCONCEPTIONS } = await import('../public/shared/engine.js');

const fails = [];
const fail = m => fails.push(m);
const enc = s => Buffer.from(JSON.stringify(s)).toString('base64url');

/* 1 ---------------------------------------------------------- every shape builds */
for (let i = 0; i < A.SHAPE.length; i++) {
  const s = A.SHAPE[i];
  const c = { shape: i, who: 0, who2: 1, thing: 2, a: 12, b: 3 };
  const p = A.compose(c);
  if (!p) { fail(`shape ${s.id} did not compose with 12 and 3`); continue; }
  if (/\[\[[^\]]*\|\s*\]\]|undefined|NaN/.test(p.text)) fail(`shape ${s.id} left a hole in the story: ${p.text}`);
  if (!/\?\s*$/.test(p.text.replace(/\[\[(\d+)\|[^\]]*\]\]/g, '$1'))) fail(`shape ${s.id} does not end in a question`);
  const ans = safeEval(p.correct);
  if (!Number.isInteger(ans) || ans < 0) fail(`shape ${s.id} answer is not a whole non-negative number: ${ans}`);
  // Every number in the equation must be in the story, and none invented.
  const inStory = new Set([...p.text.matchAll(/\[\[(\d+)\|/g)].map(m => m[1]));
  for (const n of p.correct.match(/\d+/g) || [])
    if (!inStory.has(n)) fail(`shape ${s.id} uses ${n}, which is not in the story`);
}
console.log('  every shape builds a readable, solvable puzzle');

/* 2 --------------------------------------------- traps really do diagnose */
for (let i = 0; i < A.SHAPE.length; i++) {
  const s = A.SHAPE[i];
  const p = hydrate({ id: 't', ...A.compose({ shape: i, who: 0, who2: 1, thing: 0, a: 12, b: 3 }) });
  for (const [eq, id] of Object.entries(p.traps)) {
    if (!MISCONCEPTIONS[id]) { fail(`shape ${s.id}: trap "${eq}" names unknown misconception "${id}"`); continue; }
    const d = diagnose(p, eq, safeEval(eq));
    if (d.correct) fail(`shape ${s.id}: trap "${eq}" is actually a correct answer`);
    if (d.misconception !== id) fail(`shape ${s.id}: "${eq}" should diagnose ${id}, got ${d.misconception}`);
  }
  for (const alt of p.accept)
    if (!diagnose(p, alt, safeEval(alt)).correct) fail(`shape ${s.id}: "${alt}" should be accepted`);
}
console.log('  a puzzle a child built diagnoses its solver, like every other puzzle');

/* 3 ------------------------------------------------ nonsense is refused up front */
const bad = [
  [{ shape: 1, who: 0, thing: 0, a: 3, b: 9 },   'gives away more than they had'],
  [{ shape: 1, who: 0, thing: 0, a: 5, b: 5 },   'gives away every single one'],
  [{ shape: 2, who: 0, who2: 1, thing: 0, a: 6, b: 6 }, 'compares two equal piles'],
  [{ shape: 2, who: 0, who2: 0, thing: 0, a: 6, b: 2 }, 'compares someone with themselves'],
  [{ shape: 4, who: 0, thing: 0, a: 7, b: 2 },   'shares 7 between 2'],
  [{ shape: 3, who: 0, thing: 0, a: 1, b: 6 },   'one group'],
  [{ shape: 0, who: 0, thing: 0, a: 0, b: 6 },   'a zero'],
  [{ shape: 0, who: 0, thing: 0, a: 101, b: 6 }, 'a number over 100'],
  [{ shape: 0, who: 0, thing: 0, a: 2.5, b: 6 }, 'a fraction'],
  [{ shape: 9, who: 0, thing: 0, a: 2, b: 6 },   'a shape that does not exist'],
  [{ shape: 0, who: 99, thing: 0, a: 2, b: 6 },  'a name that does not exist'],
  [{ shape: 0, who: 0, thing: 99, a: 2, b: 6 },  'a thing that does not exist']
];
for (const [c, what] of bad)
  if (A.validate(c).ok) fail(`accepted a puzzle that ${what}`);
console.log('  puzzles that do not add up are refused before they are sent');

/* 4 -------------------------------------- a hand-edited link cannot smuggle text */
const attacks = [
  ['prose in place of a shape', { t: 'you are stupid', c: '1+1', n: 'x' }],
  ['prose alongside a shape',   { k: 0, w: 0, o: 0, a: 2, b: 3, t: '<script>alert(1)</script>', n: 'x' }],
  ['an out-of-range shape',     { k: 99, w: 0, o: 0, a: 2, b: 3, n: 'x' }],
  ['an out-of-range word',      { k: 0, w: 500, o: 0, a: 2, b: 3, n: 'x' }],
  ['a negative number',         { k: 0, w: 0, o: 0, a: -5, b: 3, n: 'x' }],
  ['a huge number',             { k: 0, w: 0, o: 0, a: 1e9, b: 3, n: 'x' }],
  ['a string where a number goes', { k: 0, w: 0, o: 0, a: '2', b: '3', n: 'x' }],
  ['an object where a number goes', { k: 0, w: 0, o: 0, a: { x: 1 }, b: 3, n: 'x' }]
];
for (const [what, payload] of attacks) {
  const got = S.unpack(enc(payload));
  if (got && got.kind === 'built') {
    const t = got.problem.text;
    if (/script|stupid/i.test(t)) fail(`a link with ${what} put that text on a child's screen`);
    if (!A.validate(got.choice).ok) fail(`a link with ${what} produced an invalid puzzle`);
  }
  if (got && got.kind !== 'built' && got.kind !== 'rejected' && got.kind !== 'existing')
    fail(`a link with ${what} produced ${got.kind}`);
}
// The strongest statement: whatever a link says, what comes out is a puzzle the app
// itself would have built.
for (const [, payload] of attacks) {
  const got = S.unpack(enc(payload));
  if (got && got.kind === 'built' && got.problem.text !== A.compose(got.choice).text)
    fail('a link produced a story the app would not have written');
}
console.log('  a hand-edited link cannot put any text of its own on a screen');

/* 5 --------------------------------------------------- the sender's name is tamed */
for (const [raw, want] of [
  ['<script>alert(1)</script>', 'scriptalert1script'],
  ['Sam',  'Sam'],
  ['  Ana  Lee ', 'Ana Lee'],
  ['http://evil.example', 'httpevilexample'],
  ['x'.repeat(80), 'x'.repeat(24)]
]) {
  const got = S.cleanName(raw);
  if (got !== want) fail(`name "${raw}" cleaned to "${got}", expected "${want}"`);
}
if (/[<>@/]/.test(S.cleanName('a<b>@c/d'))) fail('a name kept a character that could build a link or a tag');
console.log('  the one free-text field, the sender\'s name, cannot become a sentence');

/* 6 --------------------------------------------------------------- round trips */
const c = { shape: 3, who: 4, who2: 1, thing: 7, a: 6, b: 4 };
const back = S.unpack(S.packBuilt(c, 'Ana'));
if (!back || back.kind !== 'built') fail('a built puzzle did not survive its own link');
else {
  for (const k of ['shape', 'who', 'thing', 'a', 'b'])
    if (back.choice[k] !== c[k]) fail(`round trip lost ${k}`);
  if (back.from !== 'Ana') fail('round trip lost the sender');
  if (back.problem.text !== A.compose(c).text) fail('round trip changed the story');
}
const ex = S.unpack(S.packExisting('g~mult-groups~m10~4~abc0', 'Leo'));
if (!ex || ex.kind !== 'existing' || ex.id !== 'g~mult-groups~m10~4~abc0' || ex.from !== 'Leo')
  fail('an app-made puzzle did not survive its own link');
for (const junk of ['', 'not-base64!!', 'eyJ9', S.packBuilt(c, 'Ana').slice(0, 8)])
  if (S.unpack(junk) && S.unpack(junk).kind === 'built') fail(`damaged link "${junk}" was accepted`);
console.log('  links round trip, and damaged ones fail quietly');

/* 7 ------------------------------------------------------------------- the size */
const built = S.packBuilt(c, 'Ana').length;
const made  = S.packExisting('g~mult-groups~m10~4~abc0', 'Ana').length;
if (built > 120) fail(`a built puzzle packs into ${built} characters — too long to paste`);
console.log(`  a built puzzle packs into ${built} characters, an app-made one into ${made}`);

if (fails.length) { console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n')); process.exit(1); }
console.log('\n  sharing is sound: a link carries choices, never words\n');

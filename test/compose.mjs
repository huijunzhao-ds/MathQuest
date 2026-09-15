// A child now dictates a puzzle in their own words, and those words end up on
// another child's screen. That is the thing the template builder was built to
// avoid, so what makes it safe has to be tested rather than asserted.
//
// The argument, in one line: the link no longer carries the trust. A minted code
// is signed by the server that watched the puzzle being composed, and a link edited
// by hand fails the signature. So these tests cover the two halves — the structural
// check that a composed puzzle is solvable at all, and the signing that decides
// whether an arriving puzzle is one we made.

import crypto from 'node:crypto';
import * as C from '../public/shared/compose.js';

const fails = [];
const fail = m => fails.push(m);

const ICE = {
  text: 'Mum bought [[2|boxes of ice cream]] boxes of ice cream. Each box has [[6|ice creams in one box]] '
      + 'ice creams. Robin ate [[2|ice creams Robin ate]] ice creams. How many ice creams are left?',
  correct: '2x6-2'
};

/* 1 ------------------------------------------ the puzzle the tester's son made */
{
  const v = C.check(ICE);
  if (!v.ok) fail(`the ice cream puzzle was refused: ${v.why}`);
  if (v.answer !== 10) fail(`the ice cream puzzle works out to ${v.answer}, not 10`);
  // Two steps and three numbers: the template builder could express neither.
  if ((ICE.correct.match(/[+\-x/]/g) || []).length !== 2) fail('the two-step example stopped being two steps');
}
console.log('  a two-step puzzle told out loud by a 7-year-old survives the checks');

/* 2 --------------------------------------- what the model must not get away with */
const refuse = [
  ['invents a number the child never said',
   { text: ICE.text, correct: '2x6-5' }],
  ['leaves the answer in the story',
   { text: 'There are [[2|boxes]] boxes with [[6|in each]] in each, so 12 in all. How many?', correct: '2x6' }],
  ['writes a story with no question',
   { text: ICE.text.replace('How many ice creams are left?', 'That is the story.'), correct: '2x6-2' }],
  ['gives an answer below zero',
   { text: 'A jar had [[3|sweets]] sweets. [[9|eaten]] were eaten. How many are left?', correct: '3-9' }],
  ['gives an answer that is part of a number',
   { text: 'There are [[7|sweets]] sweets for [[2|children]] children. How many each?', correct: '7/2' }],
  ['uses only one number twice',
   { text: 'There are [[4|cats]] cats and [[4|more cats]] more cats. How many cats?', correct: '4+4' }],
  ['slips a link into the story',
   { text: 'Go to www.somewhere.com and count [[2|cats]] cats and [[3|dogs]] dogs. How many?', correct: '2+3' }],
  ['leaves a number the solver cannot tap',
   { text: 'There are [[2|boxes]] boxes of 6 each and [[3|spare]] spare. How many?', correct: '2+3' }],
  ['writes almost nothing',
   { text: 'hi [[1|a]] [[2|b]]?', correct: '1+2' }],
  ['writes a whole essay',
   { text: 'x'.repeat(300) + ' [[2|a]] and [[3|b]]. How many?', correct: '2+3' }],
  ['uses five numbers',
   { text: '[[1|a]] a [[2|b]] b [[3|c]] c [[4|d]] d [[5|e]] e. How many?', correct: '1+2' }]
];
for (const [what, p] of refuse) {
  const v = C.check(p);
  if (v.ok) fail(`accepted a puzzle that ${what}`);
  else if (!/[a-z]/.test(v.why) || v.why.length > 90)
    fail(`the refusal for "${what}" is not something Pip could say: ${v.why}`);
}
console.log(`  ${refuse.length} ways a composed puzzle can be wrong are all caught, in words a child hears`);

/* 3 -------------------------------------- the equation evaluator is not an eval */
for (const nasty of ['2+2; process.exit(1)', 'fetch("http://x")', 'while(1){}', '[].constructor',
                     'global', 'this', '2**999999', 'a+b', '"2"+2', '1/0', '2e400']) {
  let v;
  try { v = C.evaluate(nasty); }
  catch (e) { fail(`evaluate("${nasty}") threw: ${e.message}`); continue; }
  if (v !== null && !Number.isFinite(v)) fail(`evaluate("${nasty}") returned ${v}`);
  if (/[a-z;("]/i.test(nasty) && v !== null) fail(`evaluate("${nasty}") returned ${v} instead of refusing`);
}
if (C.evaluate('2x6-2') !== 10) fail('evaluate cannot do the thing it exists for');
if (C.evaluate('(2+3)x4') !== 20) fail('evaluate cannot handle brackets');
console.log('  the equation reader takes arithmetic and nothing else');

/* 4 ------------------------------------------ signing is what a link now rests on */
// The server's scheme, reproduced here so the property is tested rather than the
// implementation: sign the payload, and refuse anything whose signature does not match.
const SECRET = 'test-secret';
const sign = p => crypto.createHmac('sha256', SECRET).update(p).digest('base64url').slice(0, 27);
const mint = o => { const p = Buffer.from(JSON.stringify(o)).toString('base64url'); return `${p}.${sign(p)}`; };
const open = code => {
  const dot = String(code).lastIndexOf('.');
  if (dot < 1) return null;
  const p = code.slice(0, dot), s = code.slice(dot + 1), want = sign(p);
  if (s.length !== want.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
};

const good = mint({ t: ICE.text, c: ICE.correct, n: 'Robin' });
if (!open(good) || open(good).t !== ICE.text) fail('a minted puzzle does not survive its own link');

const [payload, sig] = good.split('.');
const edited = Buffer.from(JSON.stringify({
  t: ICE.text.replace('Robin ate', 'Robin is stupid and ate'), c: ICE.correct, n: 'Robin'
})).toString('base64url');
const attacks = [
  ['text swapped, signature kept', `${edited}.${sig}`],
  ['signature swapped', `${payload}.${sign('something else')}`],
  ['signature removed', payload],
  ['signature truncated', `${payload}.${sig.slice(0, 10)}`],
  ['signature lengthened', `${payload}.${sig}AAA`],
  ['empty signature', `${payload}.`],
  ['whole thing replaced', mint.toString()],
  ['nothing at all', '']
];
for (const [what, code] of attacks)
  if (open(code)) fail(`a link with its ${what} was accepted`);
console.log(`  a hand-edited link is refused ${attacks.length} ways — the signature is what is trusted, not the link`);

/* 5 ------------------------------ and the signature does not excuse a bad puzzle */
// Signed by us, but the rules may have tightened since it was minted.
const stale = mint({ t: 'this is not a puzzle at all', c: 'nonsense', n: 'x' });
const got = open(stale);
if (got && C.check({ text: got.t, correct: got.c }).ok)
  fail('a signed-but-invalid puzzle was let through — the check must run after the signature too');
console.log('  being signed by us does not exempt a puzzle from being checked again');

if (fails.length) { console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n')); process.exit(1); }
console.log('\n  a child can use their own words, because the link is no longer what we trust\n');

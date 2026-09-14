// The grown-ups view makes claims about a child's mind. Two things have to hold,
// and neither is checkable by clicking around:
//
//   1. Nothing a child WROTE survives into storage. The trace holds every sentence
//      they typed at Pip; the summary must hold none of it.
//   2. No observation is made on thin evidence, and every one carries its count.
//
// A parent acting on "rushes and then corrects" when it rests on three problems is
// worse served than a parent shown nothing.

import * as I from '../public/shared/insight.js';

const fails = [];
const fail = m => fails.push(m);
const T = (t, type, value) => ({ t, type, value });

/* 1 ------------------------------------------- nothing the child wrote survives */
const secret = 'my mum said the answer is twelve and i think leo is stupid';
const trace = [
  T(1000, 'problem-shown', 'g~add-join~a10~1~abc'),
  T(1500, 'read-aloud'),
  T(2000, 'ask-word', 'pack'),
  T(3000, 'say', secret),
  T(4000, 'voice-ask', secret),
  T(5000, 'tap-number', 4),
  T(6000, 'tap-operator', '+'),
  T(7000, 'submit', `4+3 = ${secret}`),
  T(8000, 'hint')
];
const rec = I.summarise(trace, { concept: 'add-join', band: 'a10', solved: true, attempts: 1 });
const asText = JSON.stringify(rec);
for (const word of ['mum', 'stupid', 'twelve', 'leo']) {
  if (asText.toLowerCase().includes(word)) fail(`the summary kept "${word}" — a child's own words reached storage`);
}
if (!rec.w.includes('pack')) fail('the summary lost the word that was looked up');
if (asText.length > 400) fail(`one problem summarises to ${asText.length} characters — too heavy to sync`);
console.log('  a problem summarises to numbers and looked-up words, never to what a child wrote');

/* 2 ------------------------------------------------- a looked-up word is a word */
for (const junk of ['what does pack mean?', '<script>', 'a'.repeat(40), '', 42, null, 'two words'])
  if (I.summarise([T(0, 'problem-shown'), T(1, 'ask-word', junk)], {}).w.length)
    fail(`"${junk}" was stored as a looked-up word`);
console.log('  only single plain words are kept from lookups');

/* 3 --------------------------------------------------- the question, or the hint */
const q = (evts) => I.summarise([T(0, 'problem-shown'), ...evts], {}).q;
if (q([]) !== 'none') fail('a problem where Pip never asked was counted as asked');
if (q([T(5, 'hint')]) !== 'hint') fail('opening the hint with no reply was not counted as a hint');
if (q([T(5, 'say', 'because'), T(9, 'hint')]) !== 'answered')
  fail('answering and THEN opening the hint should still count as answered');
if (q([T(5, 'hint'), T(9, 'say', 'because')]) !== 'hint')
  fail('a reply AFTER the hint was counted as answering the question');
console.log('  answering Pip and reaching past him are told apart, in the right order');

/* 4 ------------------------------------------------ thin evidence says nothing */
const one = I.summarise([T(0, 'problem-shown'), T(900, 'tap-number', 1), T(3000, 'submit', '1+1 = 2')],
                        { concept: 'add-join', solved: true, attempts: 1 });
for (let n = 0; n < 6; n++) {
  const obs = I.observe(Array(n).fill(one));
  if (obs.length) fail(`${n} problems produced ${obs.length} observation(s) — too few to claim anything`);
  if (I.confidence(Array(n).fill(one)).level !== 'none') fail(`${n} problems was not reported as too little`);
}
console.log('  fewer than six problems produces no claims at all');

/* 5 -------------------------------------------- every observation carries a count */
const rushed = I.summarise(
  [T(0, 'problem-shown'), T(800, 'tap-number', 1), T(1200, 'tap-operator', '+'),
   T(1600, 'tap-number', 2), T(3000, 'submit', '1+2 = 9'), T(9000, 'submit', '1+2 = 3')],
  { concept: 'add-join', solved: true, attempts: 2 });
const obs = I.observe(Array(12).fill(rushed));
if (!obs.length) fail('twelve identical problems produced no observations at all');
for (const o of obs) {
  if (!o.title || !o.detail) fail('an observation was missing its title or its detail');
  if (!(o.n > 0)) fail(`observation "${o.title}" does not say how many problems it rests on`);
  if (o.n > 12) fail(`observation "${o.title}" claims ${o.n} problems out of 12`);
  if (/\balways\b|\bnever\b|\bclearly\b/i.test(o.detail))
    fail(`observation "${o.title}" overstates: ${o.detail}`);
}
if (!obs.some(o => /fast|rush/i.test(o.title))) fail('a child who answers in 3s then corrects was not noticed');
for (let i = 1; i < obs.length; i++)
  if (obs[i].n > obs[i - 1].n) fail('observations are not ordered by how much evidence they rest on');
console.log('  every observation states its evidence, and the best-evidenced comes first');

/* 6 ---------------------------------------------------------- history is bounded */
let h = [];
for (let i = 0; i < I.KEEP + 40; i++) h = I.remember(h, { ...one, at: i });
if (h.length !== I.KEEP) fail(`history grew to ${h.length}, past the ${I.KEEP} cap`);
if (h[0].at !== 40) fail('the cap dropped the newest records instead of the oldest');
console.log(`  history stays at ${I.KEEP} problems, dropping the oldest`);

/* 7 ------------------------------------------------------- junk in, no crash out */
for (const junk of [null, undefined, 'nonsense', 42, [{}], [{ type: 'submit' }], [{ t: NaN }]]) {
  try { I.summarise(junk, {}); I.observe(junk); I.confidence(junk); }
  catch (e) { fail(`insight threw on ${JSON.stringify(junk)}: ${e.message}`); }
}
console.log('  damaged or missing history is survived, not thrown on');

if (fails.length) { console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n')); process.exit(1); }
console.log('\n  the grown-ups view keeps a child\'s words out and its own claims honest\n');

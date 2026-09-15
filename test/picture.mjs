// "Picture it for me" has two jobs and both are easy to get quietly wrong.
//
//   1. It must not offer to draw a story it cannot draw, and must not refuse one
//      it can. canShowSituation() is what the button, the chat request and the
//      post-mistake offer all read, so a gap in it is a gap in three places.
//   2. It must not draw the answer. The whole design of the situation picture is
//      that it stops before the total: a drawing that counts up for the child is
//      an answer key with animation.

import { generateSet, BANDS } from '../public/shared/generator.js';

// mathviz.js touches the DOM at import time, so the two pure functions under test
// are read out of the source rather than dragging a whole DOM in behind them.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../public/mathviz.js', import.meta.url), 'utf8');
const grab = name => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in mathviz.js`);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
};
const canShowSituation = new Function(grab('subKind') + '\n' + grab('canShowSituation')
  + '\nreturn canShowSituation;')();

const fails = [];
const fail = m => fails.push(m);
const quantities = p => [...p.text.matchAll(/\[\[(\d+)\|([^\]]*)\]\]/g)]
  .map(m => ({ value: Number(m[1]), label: m[2] }));

/* 1 ------------------------------------- how much of the game can be drawn now */
const cover = {};
for (const concept of Object.keys(BANDS)) {
  let can = 0, all = 0;
  for (const band of BANDS[concept]) {
    for (const p of generateSet(concept, band.id, 12, 'cover')) {
      all++;
      if (canShowSituation({ ...p, quantities: quantities(p) })) can++;
    }
  }
  cover[concept] = Math.round(can / all * 100);
}
for (const [c, pctCan] of Object.entries(cover)) {
  if (c === 'multi-step') {
    if (pctCan > 0) fail(`two-step stories claim to be drawable (${pctCan}%) — there is no single picture for them`);
  } else if (pctCan < 50) {
    fail(`only ${pctCan}% of ${c} problems can be drawn — the button would be dim more often than not`);
  }
}
console.log('  drawable: ' + Object.entries(cover).map(([c, v]) => `${c} ${v}%`).join(', '));

/* 2 ------------------------------ the small end of every world is always drawable */
for (const concept of Object.keys(BANDS)) {
  if (concept === 'multi-step') continue;
  const easiest = BANDS[concept][0];
  const missed = generateSet(concept, easiest.id, 20, 'easy')
    .filter(p => !canShowSituation({ ...p, quantities: quantities(p) }));
  if (missed.length)
    fail(`${missed.length}/20 problems in ${concept}'s easiest level cannot be drawn — that is where a stuck child lives`);
}
console.log('  every problem in the easiest level of every world can be drawn');

/* 3 ----------------------------------------- a picture never draws the answer */
// The captions are the part a child reads. None of them may state the total, and
// the last one must hand the counting back.
const situation = src.slice(src.indexOf('export function mountSituation'));
// Captions are written as plain template literals and inside ternaries, so every
// backtick string in the drawing code is treated as something a child might read.
const captions = [...situation.matchAll(/`([^`]*)`/g)].map(m => m[1])
  .filter(t => /[a-z]{3}.*[.?]/i.test(t));
if (captions.length < 9) fail(`only ${captions.length} captions found — the drawings may not all have been read`);
for (const c of captions) {
  if (/\b(altogether is|in total is|equals|makes|that is \$\{total\}|answer)\b/i.test(c))
    fail(`a caption gives the answer away: "${c}"`);
  if (/\$\{(total|each|sum)\}/.test(c) && !/count/i.test(c))
    fail(`a caption prints a computed total: "${c}"`);
}
const finals = captions.filter(c => /whole story/i.test(c));
if (finals.length < 4) fail(`only ${finals.length} drawings stop at "that is the whole story" — each shape needs its own`);
for (const c of finals)
  if (!/count/i.test(c)) fail(`a drawing ends without handing the counting back: "${c}"`);
console.log(`  all ${captions.length} captions stop before the total and hand the counting back`);

/* 4 ------------------------------------------ take-away and compare are told apart */
const subKind = new Function(grab('subKind') + '\nreturn subKind;')();
for (const p of generateSet('sub-difference', 's20', 24, 'kinds')) {
  const k = subKind(p);
  if (k !== p.kind) fail(`"${p.text.slice(0, 50)}" is ${p.kind} but was drawn as ${k}`);
}
// And without the template's help, the words alone still get it right.
for (const p of generateSet('sub-difference', 's20', 24, 'kinds')) {
  const guessed = subKind({ text: p.text });
  if (guessed !== p.kind) fail(`from its words alone, a ${p.kind} story reads as ${guessed}: "${p.text.slice(0, 60)}"`);
}
console.log('  giving away and comparing are told apart, by the template and by the words alone');

/* 5 --------------------------------- sharing and grouping are told apart */
const divKind = new Function(grab('divKind') + '\nreturn divKind;')();
for (const band of BANDS['div-share']) {
  for (const p of generateSet('div-share', band.id, 16, 'dk')) {
    if (divKind(p) !== p.kind) fail(`"${p.text.slice(0, 55)}" is ${p.kind} but drawn as ${divKind(p)}`);
    if (divKind({ text: p.text }) !== p.kind)
      fail(`from its words alone, a ${p.kind} story reads as ${divKind({ text: p.text })}: "${p.text.slice(0, 60)}"`);
  }
}
// The noun a child is asked to count has to come out of the question itself.
const askedNoun = new Function(grab('askedNoun') + '\nreturn askedNoun;')();
for (const p of generateSet('div-share', 'd10', 16, 'nouns')) {
  const n = askedNoun(p);
  if (!/^[a-z][a-z'-]*$/.test(n)) fail(`unreadable noun from: "${p.text.slice(0, 70)}" -> "${n}"`);
}
console.log('  sharing between people and making groups of a size are told apart');

/* 6 --------------------------------------------- the captions read like English */
// "count what one children got" is the kind of sentence that makes a child stop
// trusting the voice, and it is invisible in a screenshot of any other problem.
const singular = new Function(
  src.slice(src.indexOf('const IRREGULAR'), src.indexOf("/** Take-away or compare")) + '\nreturn singular;')();
for (const w of ['bus', 'child', 'person', 'box', 'bunch', 'tray', 'friend'])
  if (singular(w) !== w) fail(`"${w}" is already singular but came back as "${singular(w)}"`);
for (const [plural, want] of [
  ['children', 'child'], ['people', 'person'], ['friends', 'friend'], ['cousins', 'cousin'],
  ['players', 'player'], ['boxes', 'box'], ['bunches', 'bunch'], ['buses', 'bus'],
  ['cartons', 'carton'], ['trays', 'tray'], ['babies', 'baby'], ['bags', 'bag']
]) {
  const got = singular(plural);
  if (got !== want) fail(`"one ${got}" — ${plural} should read as ${want}`);
}
// Singularising twice must change nothing, or some noun is being eaten a letter
// at a time; and no caption may re-pluralise, which is how "buses" becomes "buss".
for (const p of generateSet('div-share', 'd10', 30, 'nouns2')) {
  const one = singular(askedNoun(p));
  if (singular(one) !== one) fail(`"${askedNoun(p)}" keeps shrinking: ${one} -> ${singular(one)}`);
}
if (/singular\([^)]*\)\}s\b/.test(src))
  fail('a caption builds a plural by adding s to a singular — "bus" becomes "buss"');
console.log('  "one child", not "one children" — the captions read like English');

if (fails.length) { console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n')); process.exit(1); }
console.log('\n  the picture covers the game, and still never draws the answer\n');

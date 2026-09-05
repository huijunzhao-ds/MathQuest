// The arithmetic pictures are generated, so they get checked like the problems.
// A wrong picture teaches a wrong method, which is worse than no picture at all.

import { describe as viz, canExplain, parseSimple } from '../public/mathviz.js';

const fails = [];
const fail = (eq, m) => fails.push(`${eq}  ${m}`);
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/* --- what should and should not get a picture --- */
for (const [e, want] of [
  ['14+9', true], ['7+8', true], ['60+40', true], ['60+41', false],   // over 100
  ['23-9', true], ['100-1', true], ['9-23', false],                    // negative
  ['3x6', true], ['12x12', true], ['13x2', false],                     // past the tables
  ['12/3', true], ['48/6', true], ['30/3', true],
  ['12/5', false], ['144/12', false], ['80/5', false],                 // not whole, or too tall
  ['3x6-5', false], ['560+339', false]                                 // multi-step, too big
]) if (canExplain(e) !== want) fail(e, `canExplain said ${!want}, expected ${want}`);

/* --- every picture actually shows the right sum --- */
const cases = [];
for (let a = 1; a <= 60; a++) for (const b of [1, 3, 6, 8, 9, 12, 17, 25, 40]) {
  cases.push(`${a}+${b}`, `${a}-${b}`);
  if (a <= 12 && b <= 12) cases.push(`${a}x${b}`, `${a * b}/${b}`);
}

let checked = 0;
for (const e of cases) {
  if (!canExplain(e)) continue;
  const d = viz(e);
  checked++;
  if (!d) { fail(e, 'describe returned nothing for an explainable equation'); continue; }
  const { a, b, op, cells, PITCH, PER_ROW } = d;
  const answer = op === '+' ? a + b : op === '-' ? a - b : op === 'x' ? a * b : a / b;
  const live = cells.filter(c => !c.gone);
  const slot = c => (c.y / PITCH) * PER_ROW + c.x / PITCH;

  if (!d.captions.length) fail(e, 'no captions');
  if (d.captions.some(c => !c || /undefined|NaN/.test(c))) fail(e, 'a caption is broken');

  if (op === '+') {
    // Every block must end in the combined stack, filling rows of ten with no holes.
    if (live.length !== a + b) fail(e, `${live.length} blocks on screen, expected ${a + b}`);
    const slots = live.map(slot).sort((x, y) => x - y);
    if (!eq(slots, slots.map((_, i) => i))) fail(e, 'blocks do not form contiguous rows of ten');
    if (!d.captions[d.captions.length - 1].includes(String(answer)))
      fail(e, `final caption never says ${answer}`);
    // A bridging sum must actually say how many are needed to fill the ten.
    const onesA = a % PER_ROW, need = PER_ROW - onesA;
    if (onesA > 0 && b >= need && a + b > PER_ROW &&
        !d.captions.some(c => c.includes(`just ${need} more`)))
      fail(e, `make-ten step missing (needed ${need})`);
  }

  if (op === '-') {
    if (live.length !== answer) fail(e, `${live.length} blocks left, expected ${answer}`);
    if (cells.filter(c => c.gone).length !== b) fail(e, `${cells.filter(c => c.gone).length} taken away, expected ${b}`);
    const slots = live.map(slot).sort((x, y) => x - y);
    if (!eq(slots, slots.map((_, i) => i))) fail(e, 'what is left is not a contiguous block');
    if (!d.captions[d.captions.length - 1].includes(String(answer))) fail(e, `final caption never says ${answer}`);
  }

  if (op === 'x') {
    if (live.length !== a * b) fail(e, `${live.length} blocks, expected ${a * b}`);
    const rows = new Set(live.map(c => c.y)), cols = new Set(live.map(c => c.x));
    if (rows.size !== a) fail(e, `${rows.size} rows, expected ${a}`);
    if (cols.size !== b) fail(e, `${cols.size} columns, expected ${b}`);
    if (!d.captions[d.captions.length - 1].includes(String(a * b))) fail(e, `final caption never says ${a * b}`);
  }

  if (op === '/') {
    if (live.length !== a) fail(e, `${live.length} blocks, expected ${a}`);
    const byCol = {};
    for (const c of live) byCol[c.x] = (byCol[c.x] || 0) + 1;
    const groups = Object.values(byCol);
    if (groups.length !== b) fail(e, `${groups.length} groups, expected ${b}`);
    if (groups.some(g => g !== answer)) fail(e, `groups are ${groups.join('/')}, expected ${b} lots of ${answer}`);
    if (!d.captions[d.captions.length - 1].includes(String(answer))) fail(e, `final caption never says ${answer}`);
  }
}

console.log(`\n  ${checked} arithmetic pictures checked\n`);
if (fails.length) {
  fails.slice(0, 20).forEach(f => console.log('  FAIL  ' + f));
  if (fails.length > 20) console.log(`  ... and ${fails.length - 20} more`);
  console.log(`\n  ${fails.length} failures\n`);
  process.exit(1);
}
console.log('  every picture shows the right sum\n');

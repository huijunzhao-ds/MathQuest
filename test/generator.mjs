// Generated problems are only safe if they are BORING to verify. This walks every
// concept x band x template, many seeds deep, and asserts the properties that make
// a word problem usable by a seven-year-old:
//
//   - the story reads (no template leftovers, every quantity labelled)
//   - the maths comes out whole and non-negative
//   - every number in the story is used, and no number is invented
//   - no trap is secretly the right answer, and no two traps are the same equation
//   - the id rebuilds the identical problem
//   - and the real diagnose() actually returns the misconception each trap claims
//
// The last one is the point: it tests the whole chain, not just the generator.

import { BANDS, generateSet, problemFromId, fitsBand, shapeBand, bandOfProblem } from '../public/shared/generator.js';
import { hydrate, diagnose, safeCanonical, safeEval, MISCONCEPTIONS } from '../public/shared/engine.js';

const SEEDS = 40;          // seeds per band
const PER_SEED = 6;        // problems per seed
let checked = 0, stories = new Set();
const fails = [];

const fail = (p, msg) => fails.push(`${p ? p.id : '?'}  ${msg}`);

for (const [concept, bands] of Object.entries(BANDS)) {
  for (const band of bands) {
    for (let s = 0; s < SEEDS; s++) {
      for (const raw of generateSet(concept, band.id, PER_SEED, `t${s}`)) {
        const p = hydrate(raw);
        checked++;
        stories.add(p.text);

        /* --- the story reads --- */
        // plainText is the story as a child reads it: markup already resolved.
        if (/\$\{|undefined|NaN|\[\[|\]\]/.test(p.plainText)) fail(p, `template leftover: ${p.plainText.slice(0, 70)}`);
        if (p.quantities.length < 2) fail(p, `only ${p.quantities.length} tappable number(s)`);
        for (const q of p.quantities) {
          if (!q.label || !q.label.trim()) fail(p, 'a quantity has no label');
          if (!Number.isFinite(q.value)) fail(p, 'a quantity is not a number');
        }
        if (!/\?\s*$/.test(p.plainText.trim())) fail(p, 'story does not end in a question');

        /* --- the maths works out --- */
        const value = safeEval(p.correct);
        if (value === null) fail(p, `correct "${p.correct}" does not parse`);
        else {
          if (!Number.isInteger(value)) fail(p, `answer ${value} is not a whole number`);
          if (value < 0) fail(p, `answer ${value} is negative`);
          if (value === 0) fail(p, 'answer is zero');
        }
        // Two-step subtraction must not dip below zero on the way.
        if (band.id === 'x-sub') {
          const [a, b] = p.correct.split('-').map(Number);
          if (a - b < 0) fail(p, 'first step goes negative');
        }

        /* --- every number used, none invented --- */
        const inStory = p.quantities.map(q => q.value).sort((x, y) => x - y).join(',');
        const inEq = (p.correct.match(/\d+/g) || []).map(Number).sort((x, y) => x - y).join(',');
        if (inStory !== inEq) fail(p, `story has [${inStory}] but the equation uses [${inEq}]`);

        /* --- traps are distinct, wrong, and named --- */
        const correctCanon = safeCanonical(p.correct);
        const seenCanon = new Map();
        for (const [trap, key] of Object.entries(p.traps || {})) {
          const tc = safeCanonical(trap);
          if (tc === null) { fail(p, `trap "${trap}" does not parse`); continue; }
          if (tc === correctCanon) fail(p, `trap "${trap}" IS the correct answer`);
          if (seenCanon.has(tc)) fail(p, `traps "${seenCanon.get(tc)}" and "${trap}" are the same equation`);
          seenCanon.set(tc, trap);
          if (!MISCONCEPTIONS[key]) fail(p, `trap "${trap}" names unknown misconception "${key}"`);

          // The whole chain: does diagnose actually return this misconception?
          const d = diagnose(p, trap, safeEval(trap), []);
          if (d.correct) fail(p, `diagnose called the trap "${trap}" correct`);
          else if (d.misconception !== key) fail(p, `trap "${trap}" diagnosed as "${d.misconception}", expected "${key}"`);
        }

        /* --- alternative correct forms really are correct --- */
        for (const alt of p.accept || []) {
          if (safeEval(alt) !== value) fail(p, `accept "${alt}" gives a different answer`);
          if (safeCanonical(alt) === correctCanon) fail(p, `accept "${alt}" is not an alternative at all`);
          const d = diagnose(p, alt, value, []);
          if (!d.correct) fail(p, `alternative "${alt}" was marked wrong`);
        }

        /* --- the right answer is right --- */
        const ok = diagnose(p, p.correct, value, []);
        if (!ok.correct) fail(p, `diagnose rejected the correct equation (${ok.misconception})`);
        const slip = diagnose(p, p.correct, value + 1, []);
        if (slip.misconception !== 'computation-slip') fail(p, 'a arithmetic slip was not read as a slip');

        /* --- equal-groups problems know which number is which --- */
        if (concept === 'mult-groups') {
          if (!(p.groups > 0 && p.per > 0)) fail(p, 'no groups/per, so the situation cannot be drawn');
          else if (p.groups * p.per !== safeEval(p.correct))
            fail(p, `${p.groups} groups of ${p.per} is not ${p.correct}`);
        }

        /* --- the problem is actually IN the band it claims --- */
        // The bug this catches: a level labelled "Up to 10" serving 7 + 8 = 15.
        if (concept === 'multi-step') {
          if (shapeBand(p.correct) !== band.id)
            fail(p, `shape ${p.correct} is not ${band.id}`);
        } else {
          const nums = (p.correct.match(/\d+/g) || []).map(Number);
          if (!fitsBand(concept, band.id, { a: nums[0], b: nums[1] }))
            fail(p, `${p.correct} does not belong in ${band.id} (${band.label})`);
          if (bandOfProblem(p) !== band.id)
            fail(p, `classifier files ${p.correct} under ${bandOfProblem(p)}, not ${band.id}`);
        }

        /* --- the id rebuilds the problem --- */
        const again = problemFromId(p.id);
        if (!again) fail(p, 'id does not rebuild');
        else if (again.text !== raw.text || again.correct !== raw.correct)
          fail(p, 'id rebuilds a DIFFERENT problem');
      }
    }
  }
}

/* --- and the hand-written eight file themselves correctly too --- */
{
  const { PROBLEMS } = await import('../public/shared/problems.js');
  const { bandsFor } = await import('../public/shared/generator.js');
  for (const raw of PROBLEMS) {
    const id = bandOfProblem(raw);
    if (!id) { fails.push(`${raw.id}  could not be filed in any band`); continue; }
    if (!bandsFor(raw.concept).some(b => b.id === id))
      fails.push(`${raw.id}  filed under "${id}", which is not a band of ${raw.concept}`);
    if (raw.concept === 'mult-groups' && !(raw.groups > 0 && raw.per > 0))
      fails.push(`${raw.id}  hand-written equal-groups problem has no groups/per`);
    if (raw.concept !== 'multi-step') {
      const nums = (raw.correct.match(/\d+/g) || []).map(Number);
      if (!fitsBand(raw.concept, id, { a: nums[0], b: nums[1] }))
        fails.push(`${raw.id}  filed under "${id}" but ${raw.correct} does not fit it`);
    }
  }
  console.log(`  ${PROBLEMS.length} hand-written problems filed into the right difficulty band`);
}

const bandCount = Object.values(BANDS).reduce((n, b) => n + b.length, 0);
console.log(`\n  ${checked} problems checked across ${Object.keys(BANDS).length} worlds and ${bandCount} difficulty bands`);
console.log(`  ${stories.size} distinct stories\n`);

if (fails.length) {
  const show = fails.slice(0, 25);
  for (const f of show) console.log('  FAIL  ' + f);
  if (fails.length > show.length) console.log(`  ... and ${fails.length - show.length} more`);
  console.log(`\n  ${fails.length} failures\n`);
  process.exit(1);
}
console.log('  all invariants hold\n');

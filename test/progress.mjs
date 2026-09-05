// Plays simulated children through the whole progression.
//
// The bug this exists to catch is the one you cannot click your way to: a child
// who never solves cleanly getting permanently stuck, or a star requirement that
// promises something the rules will not actually grant. Both were real. Both are
// asserted here.

import * as G from '../public/shared/progress.js';
import { bandsFor } from '../public/shared/generator.js';
import { CONCEPTS } from '../public/shared/problems.js';

const ORDER = Object.entries(CONCEPTS).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
const fails = [];
const fail = m => fails.push(m);

const blank = () => ({ bands: {}, concepts: {} });
function solve(P, concept, bandId, clean) {
  const k = G.bandKey(concept, bandId);
  const s = (P.bands[k] ||= { solved: 0, firstTry: 0 });
  s.solved++; if (clean) s.firstTry++;
}
const openList = P => ORDER.flatMap(c =>
  G.openBands(P, c).filter(b => b.open).map(b => ({ concept: c, band: b.id, index: b.index })));

/* 1 -- a child who always solves first time reaches everything */
{
  const P = blank();
  let steps = 0;
  while (steps < 4000) {
    const target = openList(P).find(b => G.bandStars(G.bandStat(P, b.concept, b.band)) < 3);
    if (!target) break;
    solve(P, target.concept, target.band, true); steps++;
  }
  if (G.totalStars(P, ORDER) !== G.maxStars(ORDER))
    fail(`clean player reached ${G.totalStars(P, ORDER)}/${G.maxStars(ORDER)} stars, not all of them`);
  for (const c of ORDER) if (!G.worldUnlocked(P, c)) fail(`clean player never unlocked ${c}`);
  console.log(`  a child who never misses: every world open, ${G.maxStars(ORDER)} stars, ${steps} solves`);
}

/* 2 -- THE DEAD-END TEST. A child who always needs a second try, or who leans on
       "Where do I start?" every single time, still has to be able to go forward. */
{
  const P = blank();
  let steps = 0;
  const allBandCount = ORDER.reduce((n, c) => n + bandsFor(c).length, 0);
  while (steps < 6000) {
    const open = openList(P);
    if (open.length === allBandCount) break;
    // A plausible struggling child: works the earliest level that still has
    // something to give, and moves on once it has stopped opening anything.
    const target = open.find(b => G.bandStat(P, b.concept, b.band).solved < G.BAND_UNLOCK_SOLVED)
                || open.find(b => G.bandStars(G.bandStat(P, b.concept, b.band)) < 3)
                || open[0];
    solve(P, target.concept, target.band, false);
    steps++;
  }
  const allBands = ORDER.reduce((n, c) => n + bandsFor(c).length, 0);
  const open = openList(P).length;
  if (open < allBands) fail(`a child who never solves cleanly stalls at ${open}/${allBands} levels (dead end)`);
  for (const c of ORDER) if (!G.worldUnlocked(P, c)) fail(`never-clean player never reached ${c}`);
  console.log(`  a child who never solves cleanly: all ${allBands} levels still reachable, ${steps} solves`);
}

/* 3 -- random children never dead-end and never lose ground */
for (let seed = 0; seed < 300; seed++) {
  const P = blank();
  const rate = (seed % 11) / 10;            // 0.0 .. 1.0 clean-solve rate
  let rnd = seed * 9301 + 49297;
  const next = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  let prevOpen = 0, prevStars = 0;
  for (let i = 0; i < 400; i++) {
    const open = openList(P);
    if (!open.length) { fail(`seed ${seed}: nothing is playable at all`); break; }
    // Progress must never go backwards.
    if (open.length < prevOpen) fail(`seed ${seed}: a level that was open became locked`);
    const stars = G.totalStars(P, ORDER);
    if (stars < prevStars) fail(`seed ${seed}: stars went down`);
    prevOpen = open.length; prevStars = stars;
    const pick = open[Math.floor(next() * open.length)];
    solve(P, pick.concept, pick.band, next() < rate);
  }
  // 400 solves is a lot of play. Everyone should be past the first world by then.
  if (!G.worldUnlocked(P, 'sub-difference'))
    fail(`seed ${seed} (clean rate ${rate}): still stuck in the first world after 400 solves`);
}
console.log('  300 random children: no dead ends, no lost ground, all past world one');

/* 4 -- the promise a star makes is one the rules keep */
{
  let checked = 0;
  for (let solved = 0; solved <= 8; solved++) for (let clean = 0; clean <= solved; clean++) {
    const stat = { solved, firstTry: clean };
    const n = G.nextStar(stat);
    if (!n) continue;
    checked++;
    // Do exactly what the caption says, then the star must actually appear.
    const after = { solved: solved + n.needTotal, firstTry: clean + n.needFirst };
    if (G.bandStars(after) < n.target)
      fail(`"${n.text}" from ${solved}/${clean} does not actually earn ${n.target} stars`);
    // And it must not be padded: one fewer should NOT be enough.
    if (n.needTotal > 0) {
      const short = { solved: solved + n.needTotal - 1, firstTry: clean + Math.max(0, n.needFirst - 1) };
      if (G.bandStars(short) >= n.target) fail(`"${n.text}" from ${solved}/${clean} asks for more than it needs`);
    }
  }
  console.log(`  ${checked} "next star" promises checked — each is exactly what it costs`);
}

/* 5 -- every locked thing can say why, and names something reachable */
{
  const P = blank();
  for (const c of ORDER) {
    bandsFor(c).forEach((b, i) => {
      if (G.bandUnlocked(P, c, i)) return;
      const r = G.lockReason(P, c, i);
      if (!r) fail(`${c} level ${i + 1} is locked but gives no reason`);
      else if (r.kind === 'world' && !r.needs.length) fail(`${c} says it is world-locked but needs nothing`);
      else if (r.kind === 'band' && !r.prev) fail(`${c} level ${i + 1} names no previous level`);
    });
  }
  console.log('  every locked level explains itself');
}

/* 6 -- progress saved under the OLD per-world star system survives the change */
{
  // What his son's browser actually holds today: per-world totals, no bands.
  const legacy = { concepts: { 'add-join': { solved: 12, firstTry: 9 },
                               'sub-difference': { solved: 4, firstTry: 3 } },
                   solvedIds: ['garden'], misconceptions: {} };
  const P = G.migrate({ ...legacy });
  if (!P.bands) fail('migration produced no bands');
  if (G.worldStars(P, 'add-join') < 3) fail('migration lost the addition mastery');
  for (const c of ['sub-difference', 'mult-groups'])
    if (!G.worldUnlocked(P, c)) fail(`migration re-locked ${c} for a child who had already earned it`);
  // And migrating twice must not double-count.
  const again = G.migrate(P);
  if (again.bands[G.bandKey('add-join', 'a10')].solved !== 12) fail('migrating twice changed the numbers');
  console.log('  progress saved under the old star system survives the change');
}

/* 7 -- skipping ahead: a child who already knows this can prove it in two */
{
  const P = blank();
  // A third-grader who knows addition: challenge "Up to 100" straight away.
  G.markTestedOut(P, 'add-join', 'a100');
  if (!G.bandUnlocked(P, 'add-join', 2)) fail('testing out did not open the level it was for');
  if (!G.bandUnlocked(P, 'add-join', 1)) fail('testing out of Up to 100 left Up to 20 shut');
  if (G.bandUnlocked(P, 'add-join', 3)) fail('testing out opened a level ABOVE the one challenged');
  if (!G.worldUnlocked(P, 'sub-difference')) fail('proving addition did not open what addition gates');
  if (G.worldStars(P, 'add-join') !== 0) fail('testing out invented stars that were never earned');
  if (G.totalStars(P, ORDER) !== 0) fail('testing out inflated the star total');

  // And it must not break the ordinary route: from here, play on as normal.
  let steps = 0;
  while (steps < 4000) {
    const t = openList(P).find(b => G.bandStars(G.bandStat(P, b.concept, b.band)) < 3);
    if (!t) break;
    solve(P, t.concept, t.band, true); steps++;
  }
  if (G.totalStars(P, ORDER) !== G.maxStars(ORDER))
    fail('a child who skipped ahead cannot go on to earn every star');
  console.log('  skipping ahead: opens below, not above; stars stay unearned; road still completable');
}

/* 8 -- a child who skips ahead everywhere still cannot dead-end */
for (let seed = 0; seed < 60; seed++) {
  const P = blank();
  let rnd = seed * 7919 + 13;
  const next = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 60; i++) {
    const locked = [];
    for (const c of ORDER) {
      if (!G.worldUnlocked(P, c)) continue;
      bandsFor(c).forEach((b, k) => { if (!G.bandUnlocked(P, c, k)) locked.push({ c, b }); });
    }
    if (next() < 0.5 && locked.length) {
      const pick = locked[Math.floor(next() * locked.length)];
      G.markTestedOut(P, pick.c, pick.b.id);
    } else {
      const open = openList(P);
      if (!open.length) { fail(`seed ${seed}: nothing playable after skipping`); break; }
      const pick = open[Math.floor(next() * open.length)];
      solve(P, pick.concept, pick.band, next() < 0.5);
    }
    if (!openList(P).length) { fail(`seed ${seed}: skipping ahead closed everything`); break; }
  }
}
console.log('  60 children skipping ahead at random: never dead-ended');

console.log('');
if (fails.length) {
  fails.slice(0, 15).forEach(f => console.log('  FAIL  ' + f));
  if (fails.length > 15) console.log(`  ... and ${fails.length - 15} more`);
  console.log(`\n  ${fails.length} failures\n`); process.exit(1);
}
console.log('  progression is sound\n');

// Progression: what a star means, what unlocks what, and where the worlds sit
// on the map.
//
// This is deliberately a pure module with no DOM in it, because a progression
// system that can DEAD-END is a bug you cannot find by clicking — you find it
// when a child has played for two weeks and cannot reach the next thing.
// test/progress.mjs plays thousands of simulated children through it.
//
// The design answers a complaint from the seven-year-old tester: he could not
// tell what the level number or the stars were for. So:
//   - there is now ONE currency, the star. XP still accrues for the grown-ups
//     view, but a child never sees it.
//   - a star is earned at a NAMED PLACE (this world, this difficulty level),
//     not for a whole world, so what earned it is visible on the map.
//   - every locked thing says what would open it, and every star says what the
//     next one needs, in words, in the place where you would look.

import { bandsFor } from './generator.js';

/* ------------------------------- the graph ---------------------------------- */
// Real dependencies, not a queue: subtraction and multiplication both build on
// addition, division builds on multiplication, and two-step puzzles need the
// four operations underneath them. That is why the map is a graph.

export const PREREQS = {
  'add-join':       [],
  'sub-difference': ['add-join'],
  'mult-groups':    ['add-join'],
  'div-share':      ['mult-groups'],
  'multi-step':     ['sub-difference', 'div-share']
};

// x is a percentage of the map width, row is a vertical slot.
export const MAP_POS = {
  'add-join':       { x: 50, row: 0 },
  'sub-difference': { x: 20, row: 1 },
  'mult-groups':    { x: 74, row: 1 },
  'div-share':      { x: 74, row: 2 },
  'multi-step':     { x: 44, row: 3 }
};

export const MAP_ROWS = 4;

/* -------------------------------- the star ---------------------------------- */
// Stars come from solving cleanly — first try, no help — so grinding easy
// remedial problems can never buy mastery.

export const STAR_RULES = [
  { stars: 1, solved: 1, firstTry: 0 },
  { stars: 2, solved: 3, firstTry: 2 },
  { stars: 3, solved: 5, firstTry: 4 }
];

export const bandKey = (concept, bandId) => `${concept}:${bandId}`;

export function bandStat(P, concept, bandId) {
  return (P.bands && P.bands[bandKey(concept, bandId)]) || { solved: 0, firstTry: 0 };
}

export function bandStars(stat) {
  let n = 0;
  for (const r of STAR_RULES) if (stat.solved >= r.solved && stat.firstTry >= r.firstTry) n = r.stars;
  return n;
}

/**
 * What the next star needs, phrased for a child, as REMAINING work rather than
 * a total — "2 more without help" is actionable; "solve 5 with 4 first try" is
 * a specification.
 */
export function nextStar(stat) {
  const have = bandStars(stat);
  const rule = STAR_RULES.find(r => r.stars === have + 1);
  if (!rule) return null;
  const needSolved = Math.max(0, rule.solved - stat.solved);
  const needFirst = Math.max(0, rule.firstTry - stat.firstTry);
  const star = '★'.repeat(rule.stars);
  // A first-try solve is also a solve, so the two requirements overlap. What the
  // child actually has left to do is the larger of the two, with the clean ones
  // called out only when they are not the whole of it.
  const needTotal = Math.max(needSolved, needFirst);
  let text;
  if (needFirst > 0 && needSolved > needFirst) text = `${needSolved} more (${needFirst} on the first try) → ${star}`;
  else if (needFirst > 0) text = `${needFirst} more on the first try → ${star}`;
  else text = `${needSolved} more → ${star}`;
  return { target: rule.stars, needSolved, needFirst, needTotal, text };
}

/* ------------------------------- unlocking ---------------------------------- */

export function worldStars(P, concept) {
  return bandsFor(concept).reduce((n, b) => n + bandStars(bandStat(P, concept, b.id)), 0);
}
export const worldMaxStars = concept => bandsFor(concept).length * 3;

export function worldSolved(P, concept) {
  return bandsFor(concept).reduce((n, b) => n + bandStat(P, concept, b.id).solved, 0);
}

// THE SAFETY NET, and it is not optional. Two stars needs two first-try solves,
// and a child who leans on "Where do I start?" for every problem never gets one.
// Gating purely on stars would leave exactly the child who needs the most help
// permanently stuck on the first level of the first world. So effort opens doors
// too: enough attempts moves you on even if none of them were clean.
export const WORLD_UNLOCK_STARS = 2, WORLD_UNLOCK_SOLVED = 10;
export const BAND_UNLOCK_STARS = 2, BAND_UNLOCK_SOLVED = 8;

/* ------------------------------ skipping ahead ------------------------------ */
// A third-grader who already knows addition should not have to walk from "Up to
// 10". Any locked level can be CHALLENGED: get two right, first try, and it is
// yours. Nothing is fabricated — the stars stay unearned and the parent view can
// tell "tested out" from "worked through", which is more informative, not less.

export const TEST_OUT_REQUIRED = 2;

export const testedOut = (P, concept, bandId) => !!(P.testedOut && P.testedOut[bandKey(concept, bandId)]);

/** The furthest level in a world the child has tested out of, or -1. */
export function testedOutIndex(P, concept) {
  const bands = bandsFor(concept);
  let best = -1;
  bands.forEach((b, i) => { if (testedOut(P, concept, b.id)) best = Math.max(best, i); });
  return best;
}

export function markTestedOut(P, concept, bandId) {
  (P.testedOut ||= {})[bandKey(concept, bandId)] = true;
  return P;
}

export function worldUnlocked(P, concept) {
  return (PREREQS[concept] || []).every(p =>
    worldStars(P, p) >= WORLD_UNLOCK_STARS ||
    worldSolved(P, p) >= WORLD_UNLOCK_SOLVED ||
    // Proving you can do the harder addition proves whatever addition gates.
    testedOutIndex(P, p) >= 0);
}

/** Difficulty levels open one at a time: two stars, or enough tries, opens the next. */
export function bandUnlocked(P, concept, index) {
  if (!worldUnlocked(P, concept)) return false;
  if (index <= 0) return true;
  // Testing out of a level opens everything below it too — proving you can do
  // "Up to 100" and then being told "Up to 20" is shut would be absurd.
  if (index <= testedOutIndex(P, concept)) return true;
  const prev = bandsFor(concept)[index - 1];
  if (!prev) return false;
  const stat = bandStat(P, concept, prev.id);
  return bandStars(stat) >= BAND_UNLOCK_STARS || stat.solved >= BAND_UNLOCK_SOLVED;
}

/**
 * When a child is struggling, the level BELOW the one they are on — if there is
 * one they have not mastered. Pip offers it; it is never forced.
 */
export function easierBand(P, concept, bandId) {
  const bands = bandsFor(concept);
  const i = bands.findIndex(b => b.id === bandId);
  if (i <= 0) return null;
  const prev = bands[i - 1];
  return bandStars(bandStat(P, concept, prev.id)) >= 3 ? null : prev;
}

/** Why a locked thing is locked, said in words a child can act on. */
export function lockReason(P, concept, index = null) {
  if (!worldUnlocked(P, concept)) {
    const missing = (PREREQS[concept] || []).filter(p =>
      worldStars(P, p) < WORLD_UNLOCK_STARS && worldSolved(P, p) < WORLD_UNLOCK_SOLVED);
    return { kind: 'world', needs: missing };
  }
  if (index !== null && index > 0 && !bandUnlocked(P, concept, index)) {
    const prev = bandsFor(concept)[index - 1];
    const have = bandStars(bandStat(P, concept, prev.id));
    return { kind: 'band', prev, need: BAND_UNLOCK_STARS - have };
  }
  return null;
}

/* ------------------------------ where to play ------------------------------- */

export function openBands(P, concept) {
  return bandsFor(concept).map((b, i) => ({ ...b, index: i, open: bandUnlocked(P, concept, i) }));
}

/** The furthest level that is open and not yet finished — where "Play" goes. */
export function recommendedBand(P, concept) {
  const list = openBands(P, concept).filter(b => b.open);
  if (!list.length) return null;
  return list.find(b => bandStars(bandStat(P, concept, b.id)) < 3) || list[list.length - 1];
}

export function recommendedWorld(P, order) {
  const open = order.filter(c => worldUnlocked(P, c));
  return open.find(c => worldStars(P, c) < worldMaxStars(c)) || open[open.length - 1] || order[0];
}

export function totalStars(P, order) { return order.reduce((n, c) => n + worldStars(P, c), 0); }
export function maxStars(order) { return order.reduce((n, c) => n + worldMaxStars(c), 0); }

/* -------------------------------- migration --------------------------------- */

/**
 * Progress saved before stars moved to difficulty levels only knows per-WORLD
 * totals. Dropping it would lock a child out of worlds they had already earned,
 * so it is folded into each world's first level.
 */
export function migrate(P) {
  if (P.bands) return P;
  P.bands = {};
  for (const [concept, stat] of Object.entries(P.concepts || {})) {
    if (!stat || !stat.solved) continue;
    const first = bandsFor(concept)[0];
    if (!first) continue;
    P.bands[bandKey(concept, first.id)] = { solved: stat.solved, firstTry: stat.firstTry || 0 };
  }
  return P;
}

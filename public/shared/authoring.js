// What a child is allowed to make, and therefore what a link is able to carry.
//
// The earlier design let a child type the story and ran a word blocklist over it.
// That is the wrong shape of defence for a public URL: a blocklist matches whole
// English words from a fixed list, so misspellings, other languages and plain
// unkindness ("nobody likes you") all walk through it — and because the puzzle
// travels in the link, an adult can hand-write one and send it to a child. Filtering
// free prose written by one child and shown to another is not a checkbox inside a
// two-day feature.
//
// So the child never writes prose at all. They choose a SHAPE, choose the words
// from fixed lists, and choose the numbers. The link carries small integers, and
// checking one on arrival is bounds-checking, not judging content: there is no
// string in it that could say anything.
//
// This costs nothing pedagogically. The hard part of composing a word problem is
// picking the structure and the numbers — deciding that "8 boxes of 3" is a
// multiplication and that 8 and 3 make it interesting — not writing the sentence.
// And it BUYS something free prose could never have: because the shape is known,
// the authored puzzle inherits the whole diagnosis layer. A friend who adds when
// they should multiply gets told what they did, on a puzzle their friend invented.

import { modelFor } from './generator.js';

/** Whoever the story is about. First names only, no surnames, nothing typed. */
export const WHO = ['Maya', 'Leo', 'Nia', 'Ravi', 'Ana', 'Sam', 'Ivy', 'Omar', 'Zoe',
                    'Jonah', 'Amara', 'Theo', 'Priya', 'Felix', 'Luca', 'Mina', 'Kofi',
                    'Elsie', 'Dev', 'Rosa'];

/** Countable things. `one` is only needed where a sentence says "each". */
export const THING = [
  { many: 'stickers',   one: 'sticker' },
  { many: 'marbles',    one: 'marble' },
  { many: 'apples',     one: 'apple' },
  { many: 'cookies',    one: 'cookie' },
  { many: 'pencils',    one: 'pencil' },
  { many: 'shells',     one: 'shell' },
  { many: 'coins',      one: 'coin' },
  { many: 'buttons',    one: 'button' },
  { many: 'crayons',    one: 'crayon' },
  { many: 'conkers',    one: 'conker' },
  { many: 'beads',      one: 'bead' },
  { many: 'grapes',     one: 'grape' },
  { many: 'balloons',   one: 'balloon' },
  { many: 'cards',      one: 'card' },
  { many: 'acorns',     one: 'acorn' },
  { many: 'feathers',   one: 'feather' },
  { many: 'bricks',     one: 'brick' },
  { many: 'socks',      one: 'sock' }
];

/** The five shapes, one per world, each written as a fill-in-the-blanks sentence. */
export const SHAPE = [
  {
    id: 'join', concept: 'add-join', label: 'Put two piles together',
    hint: 'Two amounts joined into one total.',
    aName: 'first pile', bName: 'second pile',
    f: (w, t, a, b) =>
      `${w} found [[${a}|${t.many} in the morning]] ${t.many} in the morning and ` +
      `[[${b}|${t.many} in the afternoon]] more ${t.many} in the afternoon. ` +
      `How many ${t.many} did ${w} find altogether?`
  },
  {
    id: 'take', concept: 'sub-difference', label: 'Give some away',
    hint: 'You start with an amount and some of it goes.',
    aName: 'started with', bName: 'gave away', bMax: 'a', kind: 'take',
    f: (w, t, a, b) =>
      `${w} had [[${a}|${t.many} at the start]] ${t.many}. ${w} gave ` +
      `[[${b}|${t.many} given away]] of them to a friend. ` +
      `How many ${t.many} does ${w} have left?`
  },
  {
    id: 'compare', concept: 'sub-difference', label: 'Who has more, and by how much',
    hint: 'Two people, and the gap between them.',
    aName: 'the bigger pile', bName: 'the smaller pile', bMax: 'a',
    f: (w, t, a, b, w2) =>
      `${w} has [[${a}|${w}'s ${t.many}]] ${t.many}. ${w2} has ` +
      `[[${b}|${w2}'s ${t.many}]] ${t.many}. How many more ${t.many} does ${w} have than ${w2}?`
  },
  {
    id: 'groups', concept: 'mult-groups', label: 'Equal groups',
    hint: 'The same number in every group. This is the one that catches people out.',
    aName: 'how many boxes', bName: 'in each box',
    f: (w, t, a, b) =>
      `${w} fills [[${a}|number of boxes]] boxes with ${t.many}. Each box holds ` +
      `[[${b}|${t.many} in one box]] ${t.many}. How many ${t.many} are there in total?`
  },
  {
    id: 'share', concept: 'div-share', label: 'Share them out fairly',
    hint: 'Split a pile evenly. Pick numbers that divide exactly.',
    aName: 'how many to share', bName: 'how many friends', exact: true,
    f: (w, t, a, b) =>
      `${w} shares [[${a}|${t.many} to share]] ${t.many} equally between ` +
      `[[${b}|number of friends]] friends. How many ${t.many} does each friend get?`
  }
];

export const MAX_NUM = 100;

/** Every choice is an index or a small number, so this is arithmetic, not judgement. */
export function validate({ shape, who, who2, thing, a, b }) {
  const s = SHAPE[shape];
  if (!s) return { ok: false, why: 'Pick what kind of puzzle it is.' };
  if (!Number.isInteger(who)  || who  < 0 || who  >= WHO.length)   return { ok: false, why: 'Pick who the story is about.' };
  if (!Number.isInteger(thing)|| thing< 0 || thing>= THING.length) return { ok: false, why: 'Pick what they are counting.' };
  if (s.id === 'compare') {
    if (!Number.isInteger(who2) || who2 < 0 || who2 >= WHO.length) return { ok: false, why: 'Pick the second person.' };
    if (who2 === who) return { ok: false, why: 'Pick two different people, or there is nothing to compare.' };
  }
  for (const [v, name] of [[a, s.aName], [b, s.bName]]) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_NUM)
      return { ok: false, why: `Choose a number from 1 to ${MAX_NUM} for "${name}".` };
  }
  // A puzzle whose answer is negative or a fraction is not wrong of the child — it
  // is the app's job to say so before their friend meets it.
  if (s.bMax === 'a' && b > a)
    return { ok: false, why: `"${s.bName}" cannot be more than "${s.aName}" — the answer would go below zero.` };
  if (s.id === 'take' && b === a)
    return { ok: false, why: 'Giving away every single one makes the answer 0. Try leaving a few.' };
  if (s.id === 'compare' && a === b)
    return { ok: false, why: 'Both the same means the answer is 0. Make one bigger.' };
  if (s.exact && a % b !== 0)
    return { ok: false, why: `${a} does not share equally between ${b}. Try numbers that divide exactly.` };
  if (s.id === 'groups' && (a === 1 || b === 1))
    return { ok: false, why: 'One group, or one in each group, is too easy. Try 2 or more of both.' };
  return { ok: true };
}

/** The story a child built, as the same object shape every other problem uses. */
export function compose(choice) {
  const v = validate(choice);
  if (!v.ok) return null;
  const s = SHAPE[choice.shape];
  const w = WHO[choice.who], t = THING[choice.thing];
  const w2 = s.id === 'compare' ? WHO[choice.who2] : null;
  const { a, b } = choice;
  return {
    concept: s.concept,
    shape: s.id,
    text: s.f(w, t, a, b, w2),
    ...equationFor(s, a, b)
  };
}

/** Correct answer, alternatives and traps — from the generator, so an authored
 *  puzzle diagnoses its solver exactly the way every other puzzle does. Keeping a
 *  second copy of the trap table here is how the two quietly drift apart. */
export function equationFor(s, a, b) {
  const { correct, accept, traps } = modelFor(s.concept, null, { a, b }, s.kind || null);
  // A trap that IS the correct answer would mark a right answer wrong; at 2 x 2 the
  // "added instead of grouping" trap and correct repeated addition are the same string.
  const canon = x => String(x).replace(/\s+/g, '');
  const clean = {};
  for (const [k, v] of Object.entries(traps))
    if (canon(k) !== canon(correct) && !accept.some(alt => canon(alt) === canon(k))) clean[k] = v;
  return { correct, accept, traps: clean };
}

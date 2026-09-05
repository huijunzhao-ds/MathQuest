// The rule engine. Runs identically in the browser and on the server.
//
// It does two jobs:
//   1. Turn an equation the child BUILT into a named misconception.
//   2. Produce a Socratic question, a hint, an explanation, and targeted practice
//      for that misconception — so the app is fully playable with no API key.
//
// When ANTHROPIC_API_KEY is set, the server sends the same reasoning trace to
// Claude and prefers its response; this file is the floor, not the ceiling.

import { PROBLEMS, CONCEPTS } from './problems.js';
import {
  BANDS, bandsFor, bandById, bandForProgress, bandOfProblem, fitsBand, shapeBand,
  generateSet, problemFromId, isGeneratedId
} from './generator.js';

/* ---------------------------------- parsing --------------------------------- */

const PREC = { '+': 1, '-': 1, 'x': 2, '/': 2 };

export function parseExpr(str) {
  const tokens = String(str).match(/\d+(?:\.\d+)?|[+\-x/()]/g);
  if (!tokens) return null;
  const out = [], ops = [];
  const pop = () => {
    const op = ops.pop(), r = out.pop(), l = out.pop();
    if (!op || l === undefined || r === undefined) throw new Error('bad expression');
    out.push({ op, l, r });
  };
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push({ num: Number(t) });
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') pop();
      if (ops.pop() !== '(') throw new Error('unbalanced');
    } else {
      while (ops.length && PREC[ops[ops.length - 1]] >= PREC[t]) pop();
      ops.push(t);
    }
  }
  while (ops.length) pop();
  if (out.length !== 1) throw new Error('bad expression');
  return out[0];
}

export function evalNode(n) {
  if (!n) return null;
  if ('num' in n) return n.num;
  const l = evalNode(n.l), r = evalNode(n.r);
  switch (n.op) {
    case '+': return l + r;
    case '-': return l - r;
    case 'x': return l * r;
    case '/': return r === 0 ? null : l / r;
  }
  return null;
}

// Canonical form: commutative operands sorted, so 2x10 === 10x2 but 6-15 !== 15-6.
export function canonical(node) {
  if (!node) return '';
  if ('num' in node) return String(node.num);
  const l = canonical(node.l), r = canonical(node.r);
  if (node.op === '+' || node.op === 'x') {
    const [a, b] = [l, r].sort();
    return `(${a}${node.op}${b})`;
  }
  return `(${l}${node.op}${r})`;
}

export function safeCanonical(str) {
  try { return canonical(parseExpr(str)); } catch { return null; }
}

export function safeEval(str) {
  try { return evalNode(parseExpr(str)); } catch { return null; }
}

/* --------------------------------- problems --------------------------------- */

const QUANT_RE = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;

// Split "[[10|classes]] children" into renderable tokens.
export function parseStory(text) {
  const tokens = [];
  let last = 0, m, idx = 0;
  QUANT_RE.lastIndex = 0;
  while ((m = QUANT_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
    tokens.push({ type: 'num', value: Number(m[1]), label: m[2], qid: idx++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

export function quantitiesOf(problem) {
  return parseStory(problem.text).filter(t => t.type === 'num');
}

export function hydrate(problem) {
  const tokens = parseStory(problem.text);
  return {
    ...problem,
    tokens,
    quantities: tokens.filter(t => t.type === 'num'),
    answer: safeEval(problem.correct),
    plainText: tokens.map(t => (t.type === 'num' ? t.value : t.value)).join('')
  };
}

export function problemById(id) {
  const p = PROBLEMS.find(x => x.id === id);
  if (p) return hydrate(p);
  // A generated id encodes its own problem, so it survives a reload, a different
  // device, and eventually a link sent to a friend.
  if (isGeneratedId(id)) { const g = problemFromId(id); return g ? hydrate(g) : null; }
  return null;
}

/** A run of generated problems for one world at one difficulty band. */
export function problemsFor(concept, bandId, count = 6, seed = null) {
  return generateSet(concept, bandId, count, seed).map(hydrate);
}

export function allProblems() { return PROBLEMS.map(hydrate); }

/* ------------------------------ misconceptions ------------------------------ */

export const MISCONCEPTIONS = {
  'additive-instead-multiplicative': {
    label: 'Added the numbers instead of seeing equal groups',
    why: 'The child sees two numbers and a word like "altogether" and reaches for addition, without noticing that one number tells you how many groups and the other tells you how big each group is.',
    ask: 'Why did you choose adding? Which part of the story tells you how many are in ONE group?',
    hint: 'Look again: one number counts the groups, the other counts what is inside each group. If you have several equal groups, adding the two numbers only puts them side by side.',
    explain: 'You picked + because you saw two numbers. But the story has equal groups. Try drawing one group first, then ask: how many of those groups are there?'
  },
  'multiplicative-instead-additive': {
    label: 'Made groups when the story only joins two amounts',
    why: 'The child reaches for multiplication whenever two numbers appear, without checking whether the story actually describes equal groups. Here the two amounts are simply different things being counted together.',
    ask: 'Are the two numbers in this story equal groups, or are they just two different piles?',
    hint: 'Multiplying makes many copies of the same group. Look at your two numbers — do they describe the same kind of group, or two separate amounts?',
    explain: 'When two different amounts are put together, you join them. Multiplying would mean every one of the first amount had a whole group of its own.'
  },
  'divide-instead-multiply': {
    label: 'Split the groups apart instead of putting them together',
    why: 'The child recognises a grouping relationship but runs it backwards — sharing instead of collecting.',
    ask: 'When you divide, are you making more things or fewer things? Does the story end with more or fewer?',
    hint: 'Dividing breaks one pile into smaller shares. Here you already have the shares and you want the whole pile.',
    explain: 'You have several equal groups and you want the total. That means putting the groups together, not splitting them apart.'
  },
  'multiply-instead-divide': {
    label: 'Combined the groups instead of sharing them out',
    why: 'The child spots a grouping relationship but points it the wrong way — building a bigger total when the story asks for one share.',
    ask: 'Should each person end up with more than we started with, or less?',
    hint: 'The story starts with one whole pile and asks how big each fair share is. That means splitting, not stacking.',
    explain: 'You already have the total. The question asks for one share, so you break the total into equal parts.'
  },
  'operand-order-reversed': {
    label: 'Put the numbers in the wrong order',
    why: 'Subtraction and division are not commutative, but the child treats them as if order does not matter — often taking the numbers in the order they appear in the sentence.',
    ask: 'Which number is the amount we START with? Should that one come first?',
    hint: 'For taking away and for sharing, the order matters. The whole amount goes first.',
    explain: 'Order changes the meaning here. 15 - 6 is "start with 15, take 6 away". 6 - 15 would mean starting with only 6.'
  },
  'keyword-trap-add': {
    label: 'Followed a keyword instead of the situation',
    why: 'Words like "altogether", "in all", or "more" have been learned as signals for addition, so the child applies them without checking what is actually happening in the story.',
    ask: 'Forget the words for a second — is the amount getting bigger or smaller in this story?',
    hint: 'A word like "altogether" does not always mean add. Picture what is happening: is something being joined, taken away, grouped, or shared?',
    explain: 'Keywords can trick you. The safest move is to picture the story, then choose the operation that matches the picture.'
  },
  'keyword-trap-subtract': {
    label: 'Followed a keyword instead of the situation',
    why: 'Words like "left", "gave away", or "than" have been learned as subtraction signals and are applied without checking the situation.',
    ask: 'Is anything actually being taken away here? What is happening to the amount?',
    hint: 'The words sound like taking away, but check the picture: are things leaving, or are groups being collected?',
    explain: 'Words are hints, not rules. Draw or picture the story first, and let the picture choose the operation.'
  },
  'stopped-halfway': {
    label: 'Solved the first step and stopped',
    why: 'The child handled the first relationship correctly but did not carry the result into the second part of the question.',
    ask: 'Nice — that first part is right. Now read the last sentence again: what still has to happen?',
    hint: 'You found the total correctly. The story is not finished though — something happens to that total afterwards.',
    explain: 'This is a two-step puzzle. Your first step was right; now use that answer in the second step.'
  },
  'ignored-a-quantity': {
    label: 'Left one of the numbers out',
    why: 'The child anchored on two numbers and did not use a third that the question depends on.',
    ask: 'There is a number in the story you have not used yet. What job does it do?',
    hint: 'Check every number in the story. If one is never used, the equation is probably missing a step.',
    explain: 'Every number in a word problem usually has a job. Find the leftover one and ask what it changes.'
  },
  'invented-quantity': {
    label: 'Used a number that is not in the story',
    why: 'The child brought in a number from outside the problem, often from a remembered fact or the previous question.',
    ask: 'Where in the story did that number come from? Can you point to it?',
    hint: 'Only use numbers you can point to in the story.',
    explain: 'Every number in your equation should be one you can find in the story.'
  },
  'computation-slip': {
    label: 'Right thinking, small arithmetic slip',
    why: 'The mathematical model is correct — this is a calculation error, not a misunderstanding, and should be treated very differently.',
    ask: 'Your equation is exactly right! Want to check the arithmetic once more?',
    hint: 'You set it up perfectly. Just recount carefully.',
    explain: 'You understood the story correctly. The only thing that slipped was the counting.'
  },
  'incomplete': {
    label: 'Equation is not finished',
    why: 'The child has not yet built a complete equation.',
    ask: 'Almost there — what still needs to go into your equation?',
    hint: 'Pick a number, then an operation, then another number.',
    explain: 'An equation needs numbers on both sides of the operation.'
  },
  'unknown': {
    label: 'Something else is going on',
    why: 'The equation does not match any known pattern for this problem.',
    ask: 'Tell me how you decided on that. Which part of the story did you start from?',
    hint: 'Try reading the story one sentence at a time and saying what each number means.',
    explain: 'Let us rebuild it together, one sentence at a time.'
  }
};

/**
 * Is this equation the same number added over and over? That is the picture of
 * multiplication before a child has the symbol for it, and it deserves a
 * different response from any other correct answer: name what they did, then
 * hand them the shorthand.
 */
export function repeatedAdditionOf(built) {
  const parts = String(built).split('+').map(t => t.trim());
  if (parts.length < 2) return null;
  if (!parts.every(t => /^\d+$/.test(t))) return null;
  if (!parts.every(t => t === parts[0])) return null;
  return { times: parts.length, each: Number(parts[0]) };
}

/* -------------------------------- diagnosis --------------------------------- */

/**
 * @param {object} problem   hydrated problem
 * @param {string} built     equation the child assembled, e.g. "10+2"
 * @param {number|null} answer  what the child typed as the result
 * @param {Array} trace      ordered interaction events
 */
export function diagnose(problem, built, answer, trace = []) {
  const correctCanon = safeCanonical(problem.correct);
  const builtCanon = safeCanonical(built);
  const expected = safeEval(problem.correct);
  const builtValue = safeEval(built);

  if (builtCanon === null) return finish('incomplete', { correct: false });

  // Right model? `accept` carries genuinely-correct alternatives that canonicalise
  // differently — a-(b+c) for a-b-c, or axc+bxc for (a+b)xc. A child who finds one
  // of those has reasoned BETTER, not worse, and must not be marked wrong.
  const alternates = (problem.accept || []).map(safeCanonical).filter(Boolean);
  if (builtCanon === correctCanon || alternates.includes(builtCanon)) {
    const via = repeatedAdditionOf(built);
    if (answer !== null && answer !== undefined && Number(answer) === expected) {
      return finish(null, { correct: true, builtValue, expected, via });
    }
    return finish('computation-slip', { correct: false, builtValue, expected, via });
  }

  // A number that does not appear in the story at all.
  const storyNums = new Set(problem.quantities.map(q => q.value));
  const usedNums = (String(built).match(/\d+/g) || []).map(Number);
  if (usedNums.some(n => !storyNums.has(n))) {
    return finish('invented-quantity', { correct: false, builtValue, expected });
  }

  // Known trap for this specific problem.
  for (const [trap, key] of Object.entries(problem.traps || {})) {
    if (safeCanonical(trap) === builtCanon) {
      return finish(key, { correct: false, builtValue, expected });
    }
  }

  // Generic structural checks.
  if (problem.concept === 'multi-step' && usedNums.length < problem.quantities.length) {
    return finish('ignored-a-quantity', { correct: false, builtValue, expected });
  }

  return finish('unknown', { correct: false, builtValue, expected });

  function finish(key, extra) {
    const m = key ? MISCONCEPTIONS[key] : null;
    return {
      source: 'rules',
      misconception: key,
      label: m ? m.label : 'Correct',
      why: m ? m.why : 'The child built a correct model and computed it correctly.',
      ask: m ? m.ask : null,
      hint: m ? m.hint : null,
      explain: m ? m.explain : null,
      revisions: trace.filter(e => e.type === 'undo' || e.type === 'clear').length,
      ...extra
    };
  }
}

/* ---------------------------- generated practice ---------------------------- */

/**
 * Practice after a wrong turn. Same world (so the same misconception is still
 * reachable — traps are structural, not per-story), one difficulty band EASIER
 * than where the child slipped, so the point is rebuilding the model rather than
 * fighting the arithmetic.
 */
export function generatePractice(problem, misconception, count = 3) {
  const concept = problem.concept;
  const bands = bandsFor(concept);
  if (!bands.length) return [];
  // Hand-written problems carry no band; treat them as sitting on the second rung.
  const at = problem.band ? bands.findIndex(b => b.id === problem.band) : 1;
  const target = bands[Math.max(0, (at < 0 ? 1 : at) - 1)];
  return generateSet(concept, target.id, count)
    .map(p => hydrate({ ...p, targets: misconception }));
}

export { CONCEPTS, PROBLEMS, BANDS, bandsFor, bandById, bandForProgress, bandOfProblem, fitsBand, shapeBand };

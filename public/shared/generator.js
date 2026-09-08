// Problem generator.
//
// The hand-written bank in problems.js is small on purpose: those eight are the
// signature problems. Everything else is generated here, so the supply is endless.
//
// Three things make this safe to generate rather than hand-write:
//
//   1. DETERMINISM. A problem's id fully encodes it (concept, band, template,
//      seed), so `problemFromId` rebuilds the identical problem later. Progress,
//      practice queues and — eventually — shared links can all store just an id.
//   2. STRUCTURAL TRAPS. A trap is a property of the SHAPE of a problem, not of
//      its story. "Added when the story has equal groups" is the same mistake in
//      every multiplication problem, so the trap table is derived, not authored.
//   3. INVARIANTS. test/generator.mjs generates thousands and asserts every one
//      of them: no negative results, division comes out whole, no trap collides
//      with the correct answer, every number in the story is used.
//
// Bands are the difficulty dial. For + - x / a band is MAGNITUDE (up to ten, up
// to a hundred...). For multi-step a band is a SHAPE (a+b+c, axb-c, (a+b)xc),
// because for two-step problems the structure is the difficulty, not the size of
// the numbers. Those are genuinely different axes and the map should treat them
// that way.

/* ------------------------------ seeded random ------------------------------- */

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seedStr) {
  const next = mulberry32(hashStr(String(seedStr)));
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)]
  };
}

const NAMES = ['Maya', 'Leo', 'Nia', 'Ravi', 'Ana', 'Sam', 'Ivy', 'Omar', 'Zoe', 'Jonah',
               'Amara', 'Theo', 'Priya', 'Felix', 'Luca', 'Mina', 'Kofi', 'Elsie', 'Dev', 'Rosa'];

/* ---------------------------------- bands ----------------------------------- */
// `label` is what a child reads on the map. `short` is the parent-facing meaning.

export const BANDS = {
  'add-join': [
    { id: 'a10',  label: 'Up to 10',      short: 'totals no bigger than 10' },
    { id: 'a20',  label: 'Up to 20',      short: 'totals no bigger than 20' },
    { id: 'a100', label: 'Up to 100',     short: 'two-digit numbers' },
    { id: 'a999', label: 'Big numbers',   short: 'three-digit numbers' }
  ],
  'sub-difference': [
    { id: 's10',  label: 'Up to 10',      short: 'starting amounts up to 10' },
    { id: 's20',  label: 'Up to 20',      short: 'starting amounts up to 20' },
    { id: 's100', label: 'Up to 100',     short: 'two-digit numbers' },
    { id: 's999', label: 'Big numbers',   short: 'three-digit numbers' }
  ],
  'mult-groups': [
    { id: 'm5',   label: '2s, 5s and 10s', short: 'the easiest tables' },
    { id: 'm10',  label: 'Tables to 10',   short: 'all tables up to 10x10' },
    { id: 'm12',  label: 'Tables to 12',   short: 'all tables up to 12x12' },
    { id: 'mbig', label: 'Bigger groups',  short: 'past the twelve times table' }
  ],
  'div-share': [
    { id: 'd5',   label: '2s, 5s and 10s', short: 'sharing into 2, 5 or 10' },
    { id: 'd10',  label: 'Tables to 10',   short: 'facts up to 100 / 10' },
    { id: 'd12',  label: 'Tables to 12',   short: 'facts up to 144 / 12' },
    { id: 'dbig', label: 'Bigger shares',  short: 'single-digit shares, bigger totals' }
  ],
  // For two-step problems the band is the SHAPE, not the size of the numbers.
  'multi-step': [
    { id: 'x-add', label: 'Three to add',      short: 'a + b + c' },
    { id: 'x-sub', label: 'Twice taken away',  short: 'a - b - c' },
    { id: 'x-mix', label: 'Add and take away', short: 'a + b - c' },
    { id: 'x-grp', label: 'Groups, then less', short: 'a x b - c' },
    { id: 'x-gpa', label: 'Groups, then more', short: 'a x b + c' },
    { id: 'x-par', label: 'Brackets',          short: '(a + b) x c' }
  ]
};

export function bandsFor(concept) { return BANDS[concept] || []; }
export function bandById(concept, id) { return bandsFor(concept).find(b => b.id === id) || bandsFor(concept)[0]; }

/* --------------------------------- templates -------------------------------- */
// `big: 1` marks a story that still reads naturally with three-digit numbers.
// (847 sparrows on a wire does not; 847 pages in a book does.)

const T = {
  'add-join': [
    { big: 0, f: (a, b) => `There are [[${a}|blue fish]] blue fish and [[${b}|orange fish]] orange fish in the tank. How many fish are in the tank altogether?` },
    { big: 1, f: (a, b, N) => `${N} read [[${a}|pages on Monday]] pages on Monday and [[${b}|pages on Tuesday]] pages on Tuesday. How many pages did ${N} read in all?` },
    { big: 1, f: (a, b) => `A jar holds [[${a}|green marbles]] green marbles and [[${b}|white marbles]] white marbles. How many marbles are in the jar?` },
    { big: 1, f: (a, b, N) => `${N} had [[${a}|stickers at the start]] stickers. ${N} was given [[${b}|stickers received]] more. How many stickers does ${N} have now?` },
    { big: 1, f: (a, b) => `A shelf has [[${a}|picture books]] picture books and [[${b}|chapter books]] chapter books. How many books are on the shelf altogether?` },
    { big: 1, f: (a, b) => `In the car park there are [[${a}|red cars]] red cars and [[${b}|blue cars]] blue cars. How many cars are in the car park?` },
    { big: 0, f: (a, b) => `[[${a}|sparrows first]] sparrows are at the bird feeder. [[${b}|sparrows that arrive]] more fly down to join them. How many birds are at the feeder now?` },
    { big: 0, f: (a, b, N) => `${N} found [[${a}|shells in the morning]] shells in the morning and [[${b}|shells in the afternoon]] shells in the afternoon. How many shells did ${N} find in total?` },
    { big: 0, f: (a, b) => `One class has [[${a}|children in the first class]] children and another class has [[${b}|children in the second class]] children. They go on a trip together. How many children go on the trip?` },
    { big: 1, f: (a, b, N) => `${N} has [[${a}|coins in one pocket]] coins in one pocket and [[${b}|coins in the other pocket]] coins in the other. How many coins does ${N} have altogether?` }
  ],

  'sub-difference': [
    { kind: 'take',    big: 1, f: (a, b, N) => `${N} had [[${a}|marbles at the start]] marbles. ${N} gave [[${b}|marbles given away]] of them to a friend. How many marbles does ${N} have left?` },
    { kind: 'take',    big: 0, f: (a, b) => `There were [[${a}|birds at the start]] birds on a wire. [[${b}|birds that flew away]] of them flew away. How many birds are still on the wire?` },
    { kind: 'take',    big: 0, f: (a, b, N) => `${N} baked [[${a}|cupcakes baked]] cupcakes. The family ate [[${b}|cupcakes eaten]] of them. How many cupcakes are left?` },
    { kind: 'take',    big: 1, f: (a, b, N) => `A book has [[${a}|pages in the book]] pages. ${N} has read [[${b}|pages already read]] pages. How many pages are left to read?` },
    { kind: 'take',    big: 1, f: (a, b) => `A train has [[${a}|seats on the train]] seats. [[${b}|seats taken]] seats are taken. How many seats are still empty?` },
    { kind: 'take',    big: 1, f: (a, b, N) => `${N} had [[${a}|stickers at the start]] stickers and used [[${b}|stickers used]] of them on a card. How many stickers does ${N} have now?` },
    { kind: 'compare', big: 0, f: (a, b) => `A red ribbon is [[${a}|length of the red ribbon]] cm long. A blue ribbon is [[${b}|length of the blue ribbon]] cm long. How much longer is the red ribbon than the blue one?` },
    { kind: 'compare', big: 0, f: (a, b) => `One tower is [[${a}|blocks in the tall tower]] blocks tall. Another tower is [[${b}|blocks in the short tower]] blocks tall. How many more blocks does the tall tower have?` },
    { kind: 'compare', big: 1, f: (a, b, N) => `${N} scored [[${a}|points ${N} scored]] points. A friend scored [[${b}|points the friend scored]] points. How many more points did ${N} score?` },
    { kind: 'compare', big: 0, f: (a, b, N) => `${N} has [[${a}|pencils ${N} has]] pencils. A friend has [[${b}|pencils the friend has]] pencils. How many more pencils does ${N} have?` }
  ],

  'mult-groups': [
    { f: (a, b) => `There are [[${a}|number of baskets]] baskets. Each basket has [[${b}|apples in each basket]] apples. How many apples are there altogether?` },
    { f: (a, b) => `A shelf holds [[${a}|number of boxes]] boxes of crayons. Each box has [[${b}|crayons in each box]] crayons. How many crayons in all?` },
    { f: (a, b) => `The hall has [[${a}|number of rows]] rows of chairs. Each row has [[${b}|chairs in each row]] chairs. How many chairs are there in total?` },
    { f: (a, b, N) => `${N} has [[${a}|number of sheets]] sheets of stickers. Each sheet has [[${b}|stickers on each sheet]] stickers. How many stickers does ${N} have in all?` },
    { f: (a, b, N) => `${N} buys [[${a}|number of packs]] packs of cards. Each pack holds [[${b}|cards in each pack]] cards. How many cards does ${N} have?` },
    { f: (a, b) => `There are [[${a}|number of bags]] bags of marbles. Each bag has [[${b}|marbles in each bag]] marbles. How many marbles are there altogether?` },
    { f: (a, b) => `A library has [[${a}|number of shelves]] shelves. Each shelf holds [[${b}|books on each shelf]] books. How many books are in the library?` },
    { f: (a, b) => `[[${a}|number of plates]] plates are put out. Each plate has [[${b}|cookies on each plate]] cookies on it. How many cookies are there in total?` },
    { f: (a, b) => `[[${a}|number of vans]] vans take children to a match. Each van carries [[${b}|children in each van]] children. How many children go to the match?` },
    { f: (a, b) => `A garden has [[${a}|number of flower beds]] flower beds. Each bed has [[${b}|plants in each bed]] plants. How many plants are in the garden?` }
  ],

  'div-share': [
    { kind: 'share', f: (a, b) => `There are [[${a}|cookies to share]] cookies. [[${b}|number of friends]] friends share them equally. How many cookies does each friend get?` },
    { kind: 'share', f: (a, b) => `[[${a}|pencils to share]] pencils are shared equally among [[${b}|number of children]] children. How many pencils does each child get?` },
    { kind: 'share', f: (a, b) => `[[${a}|total stickers]] stickers are split evenly into [[${b}|number of bags]] bags. How many stickers are in each bag?` },
    { kind: 'share', f: (a, b, N) => `${N} shares [[${a}|total sweets]] sweets equally between [[${b}|number of cousins]] cousins. How many sweets does each cousin get?` },
    { kind: 'share', f: (a, b) => `[[${a}|total marbles]] marbles are shared fairly among [[${b}|number of players]] players. How many marbles does each player get?` },
    { kind: 'group', f: (a, b) => `A baker puts [[${a}|total muffins]] muffins into trays. Each tray holds [[${b}|muffins in one tray]] muffins. How many trays does the baker need?` },
    { kind: 'group', f: (a, b) => `A school needs to seat [[${a}|students to seat]] students. Each bus holds [[${b}|seats on one bus]] students. How many buses does the school need?` },
    { kind: 'group', f: (a, b) => `There are [[${a}|total eggs]] eggs. Each carton holds [[${b}|eggs in one carton]] eggs. How many cartons are needed?` },
    { kind: 'group', f: (a, b) => `[[${a}|total books]] books are packed into boxes of [[${b}|books in one box]] books. How many boxes are used?` },
    { kind: 'group', f: (a, b) => `[[${a}|total flowers]] flowers are tied into bunches of [[${b}|flowers in one bunch]] flowers. How many bunches are made?` }
  ]
};

// Multi-step frames are per shape, because the story has to MEAN the shape.
const MULTI = {
  'x-add': [
    (a, b, c, N) => `${N} collected [[${a}|shells on Monday]] shells on Monday, [[${b}|shells on Tuesday]] on Tuesday and [[${c}|shells on Wednesday]] on Wednesday. How many shells did ${N} collect altogether?`,
    (a, b, c) => `A team scored [[${a}|points in the first game]] points in the first game, [[${b}|points in the second game]] in the second and [[${c}|points in the third game]] in the third. How many points did they score in total?`,
    (a, b, c, N) => `${N} put [[${a}|red beads]] red beads, [[${b}|blue beads]] blue beads and [[${c}|green beads]] green beads on a string. How many beads are on the string?`
  ],
  'x-sub': [
    (a, b, c, N) => `${N} had [[${a}|stickers at the start]] stickers. ${N} gave [[${b}|stickers given to the first friend]] to one friend and [[${c}|stickers given to the second friend]] to another. How many stickers does ${N} have left?`,
    (a, b, c) => `A jug held [[${a}|millilitres at the start]] ml of juice. [[${b}|millilitres poured first]] ml were poured out, then [[${c}|millilitres poured next]] ml more. How many ml are left in the jug?`,
    (a, b, c, N) => `${N} started with [[${a}|coins at the start]] coins. ${N} spent [[${b}|coins spent on Saturday]] coins on Saturday and [[${c}|coins spent on Sunday]] coins on Sunday. How many coins are left?`
  ],
  'x-mix': [
    (a, b, c, N) => `${N} had [[${a}|marbles at the start]] marbles. ${N} found [[${b}|marbles found]] more, then lost [[${c}|marbles lost]] of them. How many marbles does ${N} have now?`,
    (a, b, c) => `A bus had [[${a}|passengers at the start]] passengers. [[${b}|passengers who got on]] more got on, then [[${c}|passengers who got off]] got off. How many passengers are on the bus now?`,
    (a, b, c, N) => `${N} baked [[${a}|cupcakes baked]] cupcakes and was given [[${b}|cupcakes received]] more. The family ate [[${c}|cupcakes eaten]] of them. How many cupcakes are left?`
  ],
  'x-grp': [
    (a, b, c, N) => `${N} buys [[${a}|number of packs]] packs of juice. Each pack has [[${b}|juice boxes in each pack]] juice boxes. The family drinks [[${c}|juice boxes drunk]] of them. How many juice boxes are left?`,
    (a, b, c, N) => `${N} bakes [[${a}|number of trays]] trays of cookies with [[${b}|cookies on each tray]] cookies on each tray. ${N} eats [[${c}|cookies eaten]] cookies. How many are left?`,
    (a, b, c) => `A shop has [[${a}|number of shelves]] shelves with [[${b}|books on each shelf]] books on each. [[${c}|books sold]] books are sold. How many books remain?`
  ],
  'x-gpa': [
    (a, b, c, N) => `${N} has [[${a}|number of boxes]] boxes of pencils with [[${b}|pencils in each box]] pencils in each box, and [[${c}|loose pencils]] loose pencils as well. How many pencils does ${N} have altogether?`,
    (a, b, c) => `There are [[${a}|number of tables]] tables with [[${b}|chairs at each table]] chairs at each table, plus [[${c}|extra chairs]] extra chairs by the wall. How many chairs are in the room?`,
    (a, b, c, N) => `${N} plants [[${a}|number of rows]] rows of [[${b}|seeds in each row]] seeds, then plants [[${c}|seeds planted separately]] more seeds in a pot. How many seeds did ${N} plant?`
  ],
  'x-par': [
    (a, b, c) => `Each party bag holds [[${a}|stickers in one bag]] stickers and [[${b}|sweets in one bag]] sweets. There are [[${c}|number of party bags]] party bags. How many things are in the bags altogether?`,
    (a, b, c) => `Every lunch box has [[${a}|sandwiches in one box]] sandwiches and [[${b}|apples in one box]] apples. [[${c}|number of lunch boxes]] lunch boxes are made. How many items are packed in total?`,
    (a, b, c, N) => `${N} makes bracelets. Each one uses [[${a}|red beads on one bracelet]] red beads and [[${b}|blue beads on one bracelet]] blue beads. ${N} makes [[${c}|number of bracelets]] bracelets. How many beads does ${N} use?`
  ]
};

/* --------------------------------- numbers ---------------------------------- */

function numbersFor(concept, band, rng) {
  switch (concept) {
    // Never generate 1 as a quantity: "1 blocks tall" reads wrong, and a
    // seven-year-old should not have their attention taken by a grammar bump.
    // The second number is also kept in the same size range as the first, so a
    // "big numbers" problem is not secretly 695 - 4.
    case 'add-join': {
      const cap = { a10: 10, a20: 20, a100: 99, a999: 998 }[band] || 20;
      const lo  = { a10: 2,  a20: 4,  a100: 11, a999: 105 }[band] || 2;
      const a = rng.int(lo, Math.max(lo, cap - lo));
      const b = rng.int(lo, Math.max(lo, cap - a));
      return { a, b };
    }
    case 'sub-difference': {
      const [aLo, aHi, bLo, gap] = {
        s10:  [5,   10,  2,   2],
        s20:  [10,  20,  3,   3],
        s100: [30,  99,  11,  5],
        s999: [210, 999, 105, 20]
      }[band] || [10, 20, 3, 3];
      const a = rng.int(aLo, aHi);
      const b = rng.int(bLo, Math.max(bLo, a - gap));
      return { a, b };
    }
    case 'mult-groups': {
      if (band === 'm5')   return { a: rng.pick([2, 5, 10]), b: rng.int(2, 10) };
      if (band === 'm12')  return { a: rng.int(2, 12), b: rng.int(2, 12) };
      if (band === 'mbig') return { a: rng.int(2, 9),  b: rng.int(13, 25) };
      return { a: rng.int(2, 10), b: rng.int(2, 10) };
    }
    case 'div-share': {
      let d, q;
      if (band === 'd5')        { d = rng.pick([2, 5, 10]); q = rng.int(2, 10); }
      else if (band === 'd12')  { d = rng.int(2, 12);       q = rng.int(2, 12); }
      else if (band === 'dbig') { d = rng.int(3, 9);        q = rng.int(13, 16); }
      else                      { d = rng.int(2, 10);       q = rng.int(2, 10); }
      return { a: d * q, b: d, q };
    }
    case 'multi-step': {
      if (band === 'x-add') { const a = rng.int(3, 25), b = rng.int(3, 25), c = rng.int(3, 25); return { a, b, c }; }
      if (band === 'x-sub') { const b = rng.int(2, 12), c = rng.int(2, 12); return { a: b + c + rng.int(2, 20), b, c }; }
      if (band === 'x-mix') { const a = rng.int(6, 30), b = rng.int(2, 15); return { a, b, c: rng.int(2, a + b - 1) }; }
      if (band === 'x-grp') { const a = rng.int(2, 8), b = rng.int(3, 10); return { a, b, c: rng.int(2, a * b - 1) }; }
      if (band === 'x-gpa') { return { a: rng.int(2, 8), b: rng.int(3, 10), c: rng.int(2, 15) }; }
      /* x-par */             return { a: rng.int(2, 9), b: rng.int(2, 9), c: rng.int(2, 8) };
    }
  }
  return { a: 2, b: 2 };
}

/* ------------------------ equation, traps, alternatives ---------------------- */
// A trap is derived from the SHAPE. `accept` lists equations that are a different
// canonical string but still genuinely correct — a - b - c and a - (b + c) are the
// same reasoning, and (a+b)xc and axc+bxc is a child who has found the distributive
// law. Marking those wrong would punish the better thinker.

/** "3+3" and "2+2+2" for 2 x 3 — capped so the equation stays readable. */
function repeatedAdditions(a, b) {
  const out = [];
  if (a >= 2 && a <= 12) out.push(Array(a).fill(b).join('+'));
  if (b >= 2 && b <= 12 && b !== a) out.push(Array(b).fill(a).join('+'));
  return out;
}

export function modelFor(concept, band, n, kind) {
  const { a, b, c } = n;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  switch (concept) {
    case 'add-join':
      return { correct: `${a}+${b}`, accept: [], traps: {
        [`${hi}-${lo}`]: 'keyword-trap-subtract',
        [`${a}x${b}`]: 'multiplicative-instead-additive'
      } };
    case 'sub-difference':
      return { correct: `${a}-${b}`, accept: [], traps: {
        [`${b}-${a}`]: 'operand-order-reversed',
        [`${a}+${b}`]: 'keyword-trap-add',
        ...(kind === 'take' ? { [`${a}x${b}`]: 'multiplicative-instead-additive' } : {})
      } };
    case 'mult-groups':
      // REPEATED ADDITION IS NOT A MISTAKE. A child who writes 3 + 3 for two
      // plates of three cookies has modelled the situation correctly and has
      // simply not met the shorter notation yet — it is the developmental step
      // multiplication is built on. Marking it wrong punishes the child who
      // reasoned it out from scratch. Both groupings are accepted because 3 x 2
      // already is (canonical form sorts commutative operands).
      return { correct: `${a}x${b}`, accept: repeatedAdditions(a, b), traps: {
        [`${a}+${b}`]: 'additive-instead-multiplicative',
        [`${hi}-${lo}`]: 'keyword-trap-subtract',
        [`${hi}/${lo}`]: 'divide-instead-multiply'
      } };
    case 'div-share':
      return { correct: `${a}/${b}`, accept: [], traps: {
        [`${a}-${b}`]: 'keyword-trap-subtract',
        [`${a}x${b}`]: 'multiply-instead-divide',
        [`${b}/${a}`]: 'operand-order-reversed',
        [`${a}+${b}`]: 'keyword-trap-add'
      } };
    case 'multi-step':
      if (band === 'x-add') return { correct: `${a}+${b}+${c}`, accept: [], traps: {
        [`${a}+${b}`]: 'stopped-halfway',
        [`${a}+${b}-${c}`]: 'keyword-trap-subtract'
      } };
      if (band === 'x-sub') return { correct: `${a}-${b}-${c}`, accept: [`${a}-(${b}+${c})`], traps: {
        [`${a}-${b}`]: 'stopped-halfway',
        [`${a}-${b}+${c}`]: 'keyword-trap-add',
        [`${a}+${b}+${c}`]: 'keyword-trap-add'
      } };
      if (band === 'x-mix') return { correct: `${a}+${b}-${c}`, accept: [], traps: {
        [`${a}+${b}`]: 'stopped-halfway',
        [`${a}+${b}+${c}`]: 'keyword-trap-add',
        [`${a}-${b}-${c}`]: 'keyword-trap-subtract'
      } };
      if (band === 'x-grp') return { correct: `${a}x${b}-${c}`, accept: [], traps: {
        [`${a}x${b}`]: 'stopped-halfway',
        [`${b}-${c}`]: 'ignored-a-quantity',
        [`${a}x${b}+${c}`]: 'keyword-trap-add',
        [`${a}+${b}-${c}`]: 'additive-instead-multiplicative'
      } };
      if (band === 'x-gpa') return { correct: `${a}x${b}+${c}`, accept: [], traps: {
        [`${a}x${b}`]: 'stopped-halfway',
        [`${a}x${b}-${c}`]: 'keyword-trap-subtract',
        [`${a}+${b}+${c}`]: 'additive-instead-multiplicative'
      } };
      /* x-par */          return { correct: `(${a}+${b})x${c}`, accept: [`${a}x${c}+${b}x${c}`], traps: {
        [`${a}+${b}`]: 'stopped-halfway',
        [`${a}+${b}+${c}`]: 'additive-instead-multiplicative',
        [`${a}+${b}x${c}`]: 'stopped-halfway'
      } };
  }
  return { correct: `${a}+${b}`, accept: [], traps: {} };
}

/* --------------------------------- assembly --------------------------------- */

/* ------------------------------ band membership ----------------------------- */
// Which band a set of numbers BELONGS to. Two things need this and they must not
// disagree: the test that checks generated problems land in the band they claim,
// and the classifier that files the hand-written problems. Without it, a
// hand-written 7 + 8 = 15 was being served inside "Up to 10".

export function fitsBand(concept, bandId, nums) {
  const { a, b } = nums;
  switch (concept) {
    case 'add-join': {
      const t = a + b;
      return bandId === 'a10' ? t <= 10 : bandId === 'a20' ? t <= 20
           : bandId === 'a100' ? t <= 99 : t > 99;
    }
    case 'sub-difference': {
      const hi = Math.max(a, b);
      return bandId === 's10' ? hi <= 10 : bandId === 's20' ? hi <= 20
           : bandId === 's100' ? hi <= 99 : hi > 99;
    }
    case 'mult-groups': {
      const easy = [2, 5, 10], hi = Math.max(a, b), lo = Math.min(a, b);
      if (bandId === 'm5')  return (easy.includes(a) || easy.includes(b)) && hi <= 10;
      if (bandId === 'm10') return hi <= 10;
      if (bandId === 'm12') return hi <= 12;
      return hi > 12;
    }
    case 'div-share': {
      const q = a / b;
      if (bandId === 'd5')  return [2, 5, 10].includes(b) && q <= 10;
      if (bandId === 'd10') return b <= 10 && q <= 10;
      if (bandId === 'd12') return b <= 12 && q <= 12;
      return b > 12 || q > 12;
    }
    case 'multi-step':
      return true;   // multi-step bands are SHAPES, checked by shapeBand below
  }
  return true;
}

/** For two-step problems the band is the shape of the equation, not its size. */
export function shapeBand(correct) {
  const e = String(correct).replace(/\s+/g, '');
  if (/^\(\d+\+\d+\)x\d+$/.test(e)) return 'x-par';
  if (/^\d+x\d+-\d+$/.test(e)) return 'x-grp';
  if (/^\d+x\d+\+\d+$/.test(e)) return 'x-gpa';
  if (/^\d+\+\d+\+\d+$/.test(e)) return 'x-add';
  if (/^\d+-\d+-\d+$/.test(e)) return 'x-sub';
  if (/^\d+\+\d+-\d+$/.test(e)) return 'x-mix';
  return null;
}

/**
 * The band a problem belongs in, worked out from its own numbers. The
 * hand-written bank carries no band, so this is what files each of those eight
 * at the right difficulty instead of showing them wherever the child happens to be.
 */
export function bandOfProblem(problem) {
  if (problem.band) return problem.band;
  const concept = problem.concept;
  if (concept === 'multi-step') return shapeBand(problem.correct);
  const m = /^\s*(\d+)\s*([+\-x/])\s*(\d+)\s*$/.exec(String(problem.correct));
  if (!m) return null;
  const nums = { a: Number(m[1]), b: Number(m[3]) };
  const list = bandsFor(concept);
  return (list.find(x => fitsBand(concept, x.id, nums)) || list[list.length - 1]).id;
}

export const GEN_PREFIX = 'g';
const SEP = '~';

export function generateId(concept, bandId, tpl, seed) {
  return [GEN_PREFIX, concept, bandId, tpl, seed].join(SEP);
}

export function isGeneratedId(id) { return String(id).startsWith(GEN_PREFIX + SEP); }

/** Rebuild the exact problem an id names. The id IS the problem. */
export function problemFromId(id) {
  const parts = String(id).split(SEP);
  if (parts.length !== 5 || parts[0] !== GEN_PREFIX) return null;
  const [, concept, bandId, tplRaw, seed] = parts;
  if (!BANDS[concept]) return null;
  return build(concept, bandId, Number(tplRaw), seed);
}

/** One problem, fully determined by (concept, band, template index, seed). */
function build(concept, bandId, tplIndex, seed) {
  const band = bandById(concept, bandId);
  const rng = makeRng(`${concept}|${band.id}|${tplIndex}|${seed}`);
  const name = rng.pick(NAMES);
  const n = numbersFor(concept, band.id, rng);

  let text, kind = null;
  if (concept === 'multi-step') {
    const frames = MULTI[band.id] || MULTI['x-add'];
    text = frames[tplIndex % frames.length](n.a, n.b, n.c, name);
  } else {
    const list = T[concept];
    const tpl = list[tplIndex % list.length];
    kind = tpl.kind || null;
    text = tpl.f(n.a, n.b, name);
  }

  const { correct, accept, traps } = modelFor(concept, band.id, n, kind);

  // A trap that is canonically the correct answer — or one of the accepted
  // alternatives — would mark a right answer wrong. This bites hardest at 2 x 2,
  // where the "added instead of grouping" trap (2+2) is indistinguishable from
  // correct repeated addition. When we cannot tell the two apart, the child gets
  // the benefit of the doubt.
  for (const t of Object.keys(traps))
    if (sameShape(t, correct) || accept.some(alt => sameShape(t, alt))) delete traps[t];

  return {
    id: generateId(concept, band.id, tplIndex, seed),
    concept, band: band.id, bandLabel: band.label,
    generated: true,
    // Which number is the group count and which is the size of a group. Drawing
    // the situation needs to know, and the equation alone cannot say.
    ...(concept === 'mult-groups' ? { groups: n.a, per: n.b } : {}),
    text, correct, accept, traps
  };
}

// Local, dependency-free shape comparison so this module does not import the
// engine (the engine imports this one).
function sameShape(x, y) {
  const norm = s => String(s).replace(/\s+/g, '');
  if (norm(x) === norm(y)) return true;
  const m = /^(\d+)([+x])(\d+)$/.exec(norm(x)), k = /^(\d+)([+x])(\d+)$/.exec(norm(y));
  return !!(m && k && m[2] === k[2] && m[1] === k[3] && m[3] === k[1]);
}

/**
 * A run of `count` problems for one concept and band. `seed` makes a run
 * reproducible; leave it out for a fresh set each visit.
 */
// Not every story survives three-digit numbers. "847 sparrows on a wire" is
// absurd; "847 pages in a book" is fine. Templates carry `big`, and the largest
// bands draw only from the ones that still read.
const BIG_BANDS = new Set(['a999', 's999']);

function eligibleTemplates(concept, bandId) {
  if (concept === 'multi-step') {
    const frames = MULTI[bandById(concept, bandId).id] || [];
    return frames.map((_, i) => i);
  }
  const list = T[concept] || [];
  const all = list.map((_, i) => i);
  if (!BIG_BANDS.has(bandId)) return all;
  const big = all.filter(i => list[i].big);
  return big.length ? big : all;
}

export function generateSet(concept, bandId, count = 6, seed = null) {
  const base = seed == null ? Math.random().toString(36).slice(2, 8) : String(seed);
  const idx = eligibleTemplates(concept, bandId);
  if (!idx.length) return [];
  const rng = makeRng(`set|${concept}|${bandId}|${base}`);
  const offset = rng.int(0, idx.length - 1);
  const out = [], seen = new Set();
  for (let i = 0, guard = 0; out.length < count && guard < count * 6; i++, guard++) {
    const p = build(concept, bandId, idx[(offset + i) % idx.length], `${base}${i}`);
    if (!p || seen.has(p.correct)) continue;   // never the same sum twice in one run
    seen.add(p.correct);
    out.push(p);
  }
  return out;
}

/** Which band a child should be on, from how many they have solved in that world. */
export function bandForProgress(concept, solved = 0) {
  const bands = bandsFor(concept);
  if (!bands.length) return null;
  return bands[Math.min(bands.length - 1, Math.floor(solved / 5))];
}

export { NAMES };

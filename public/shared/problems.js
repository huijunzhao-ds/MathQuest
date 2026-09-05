// Problem bank.
//
// Story text uses [[value|what this number means]] to mark a tappable quantity.
// `correct` is the canonical equation the child should build (values + operators).
// `traps` maps a WRONG equation the child might build to the misconception it reveals.
// That map is what turns "wrong answer" into "wrong mental model" without any AI call.

// Each concept is a PLACE on the road, so progress reads as a journey.
// icon/colour/glow drive the map art and the accent of the world you are in.
// Each concept is a PLACE on a star map, so progress reads as a journey.
// `short` carries the actual meaning for the child; the name is flavour.
// `icon` is drawn inline so nothing depends on emoji fonts.
const ICON = {
  twin: '<svg viewBox="0 0 32 32" fill="none"><circle cx="12" cy="16" r="7.5" fill="currentColor" opacity=".9"/><circle cx="21" cy="16" r="7.5" fill="currentColor" opacity=".55"/></svg>',
  comet: '<svg viewBox="0 0 32 32" fill="none"><circle cx="21" cy="11" r="5.5" fill="currentColor"/><path d="M17 15 L5 27M14 12 L4 20M20 18 L11 27" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity=".65"/></svg>',
  cluster: '<svg viewBox="0 0 32 32" fill="none"><circle cx="10" cy="10" r="3.6" fill="currentColor"/><circle cx="22" cy="10" r="3.6" fill="currentColor"/><circle cx="10" cy="22" r="3.6" fill="currentColor"/><circle cx="22" cy="22" r="3.6" fill="currentColor"/><circle cx="16" cy="16" r="3.6" fill="currentColor" opacity=".55"/></svg>',
  ring: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6" fill="currentColor"/><ellipse cx="16" cy="16" rx="13" ry="4.6" stroke="currentColor" stroke-width="2.6" transform="rotate(-20 16 16)" opacity=".7"/></svg>',
  gate: '<svg viewBox="0 0 32 32" fill="none"><path d="M16 4 C 9 10, 9 22, 16 28 C 23 22, 23 10, 16 4Z" stroke="currentColor" stroke-width="2.6" opacity=".75"/><circle cx="16" cy="16" r="4.4" fill="currentColor"/></svg>'
};

export const CONCEPTS = {
  'add-join':       { label: 'Twin Moons',  short: 'Putting groups together', icon: ICON.twin,    color: '#7DD3FC', glow: 'rgba(125,211,252,.55)', order: 1 },
  'sub-difference': { label: 'Comet Trail', short: 'Taking away & comparing', icon: ICON.comet,   color: '#FCA5A5', glow: 'rgba(252,165,165,.5)',  order: 2 },
  'mult-groups':    { label: 'Star Cluster',short: 'Equal groups',            icon: ICON.cluster, color: '#FFC94A', glow: 'rgba(255,201,74,.55)',  order: 3 },
  'div-share':      { label: 'Ring Belt',   short: 'Sharing fairly',          icon: ICON.ring,    color: '#6EE7B7', glow: 'rgba(110,231,183,.5)',  order: 4 },
  'multi-step':     { label: 'Nebula Gate', short: 'Two-step puzzles',        icon: ICON.gate,    color: '#C4B5FD', glow: 'rgba(196,181,253,.55)', order: 5 }
};

export const PROBLEMS = [
  {
    id: 'classes',
    concept: 'mult-groups',
    text: 'There are [[10|children in one class]] children in one class. There are [[2|how many classes]] classes. How many children are there altogether?',
    // 2 x 10, not 10 x 2: the FIRST operand is always the number of groups, so
    // anything that draws the situation knows which number is which. The two are
    // the same to the diagnosis, which sorts commutative operands.
    correct: '2x10', groups: 2, per: 10,
    traps: {
      '10+2': 'additive-instead-multiplicative',
      '2+10': 'additive-instead-multiplicative',
      '10-2': 'keyword-trap-subtract',
      '10/2': 'divide-instead-multiply'
    }
  },
  {
    id: 'stickers',
    concept: 'mult-groups',
    text: 'Maya has [[4|number of sheets]] sheets of stickers. Each sheet has [[6|stickers on each sheet]] stickers. How many stickers does Maya have in all?',
    correct: '4x6', groups: 4, per: 6,
    traps: {
      '4+6': 'additive-instead-multiplicative',
      '6-4': 'keyword-trap-subtract',
      '6/4': 'divide-instead-multiply'
    }
  },
  {
    id: 'marbles',
    concept: 'sub-difference',
    text: 'Leo had [[15|marbles he started with]] marbles. He gave [[6|marbles he gave away]] marbles to his friend. How many marbles does Leo have left?',
    correct: '15-6',
    traps: {
      '6-15': 'operand-order-reversed',
      '15+6': 'keyword-trap-add',
      '15x6': 'multiplicative-instead-additive'
    }
  },
  {
    id: 'ribbons',
    concept: 'sub-difference',
    text: 'A blue ribbon is [[9|length of blue ribbon]] cm long. A red ribbon is [[14|length of red ribbon]] cm long. How much longer is the red ribbon than the blue one?',
    correct: '14-9',
    traps: {
      '9-14': 'operand-order-reversed',
      '14+9': 'keyword-trap-add'
    }
  },
  {
    id: 'cookies',
    concept: 'div-share',
    text: 'There are [[12|cookies to share]] cookies. [[3|number of friends]] friends want to share them equally. How many cookies does each friend get?',
    correct: '12/3',
    traps: {
      '12-3': 'keyword-trap-subtract',
      '12x3': 'multiply-instead-divide',
      '3/12': 'operand-order-reversed'
    }
  },
  {
    id: 'buses',
    concept: 'div-share',
    text: 'A school needs to seat [[40|students to seat]] students. Each bus holds [[8|seats on one bus]] students. How many buses does the school need?',
    correct: '40/8',
    traps: {
      '40-8': 'keyword-trap-subtract',
      '40x8': 'multiply-instead-divide',
      '8/40': 'operand-order-reversed'
    }
  },
  {
    id: 'garden',
    concept: 'add-join',
    text: 'In the garden there are [[7|red flowers]] red flowers and [[8|yellow flowers]] yellow flowers. How many flowers are in the garden altogether?',
    correct: '7+8',
    traps: {
      '8-7': 'keyword-trap-subtract',
      '7x8': 'multiplicative-instead-additive',
      '8/7': 'multiplicative-instead-additive'
    }
  },
  {
    id: 'party',
    concept: 'multi-step',
    text: 'Sam buys [[3|number of packs]] packs of juice. Each pack has [[6|juice boxes per pack]] juice boxes. His family drinks [[5|juice boxes drunk]] of them. How many juice boxes are left?',
    correct: '3x6-5',
    traps: {
      '3x6': 'stopped-halfway',
      '6-5': 'ignored-a-quantity',
      '3+6-5': 'additive-instead-multiplicative',
      '3x6+5': 'keyword-trap-add'
    }
  }
];

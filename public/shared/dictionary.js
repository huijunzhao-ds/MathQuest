// Offline word help. The AI layer writes better, story-aware explanations, but a
// child tapping a word must NEVER get "sorry, no connection" — so every word that
// appears in the problem bank has an answer here.
//
// The maths words matter as much as the objects: "altogether", "each" and "equally"
// are the exact words that cause the misconceptions this app diagnoses.

export const MATH_WORDS = {
  altogether: { emoji: '🧺', meaning: 'Altogether means all of them counted as one big amount.', careful: 'Careful — altogether does NOT always mean add. Sometimes the story has equal groups.' },
  'in all':   { emoji: '🧺', meaning: 'In all means the whole amount when everything is counted.', careful: 'It tells you what to find, not which operation to use.' },
  total:      { emoji: '🧮', meaning: 'The total is the whole amount when you put everything together.' },
  each:       { emoji: '🪣', meaning: 'Each means every single one, on its own. "6 in each basket" means every basket has 6.', careful: 'The word each is a big clue that the story has equal groups.' },
  equally:    { emoji: '⚖️', meaning: 'Equally means everyone gets exactly the same amount — nobody gets more.' },
  share:      { emoji: '🤝', meaning: 'To share is to split an amount into fair parts.' },
  shared:     { emoji: '🤝', meaning: 'Shared means it was split into fair, equal parts.' },
  left:       { emoji: '📦', meaning: 'Left means how many are still there after some are gone.' },
  longer:     { emoji: '📏', meaning: 'Longer means it measures more from end to end.' },
  than:       { emoji: '⚖️', meaning: 'Than is used when you compare two things, like "longer than" or "more than".' },
  more:       { emoji: '➕', meaning: 'More means a bigger amount.', careful: 'More does not always mean add — "how many more" often means compare.' },
  remain:     { emoji: '📦', meaning: 'Remain means how many are still left over.' },
  remains:    { emoji: '📦', meaning: 'Remains means how many are still left over.' },
  holds:      { emoji: '🪣', meaning: 'Holds means how much can fit inside.' },
  seat:       { emoji: '💺', meaning: 'To seat people is to give them somewhere to sit.' },
  split:      { emoji: '✂️', meaning: 'Split means to break an amount into parts.' },
  evenly:     { emoji: '⚖️', meaning: 'Evenly means every part is exactly the same size.' }
};

export const OBJECT_WORDS = {
  cookie: '🍪', cookies: '🍪',
  marble: '🔵', marbles: '🔵',
  sticker: '⭐', stickers: '⭐',
  sheet: '📄', sheets: '📄',
  ribbon: '🎀', ribbons: '🎀',
  flower: '🌸', flowers: '🌸',
  garden: '🌷',
  bus: '🚌', buses: '🚌',
  student: '🧒', students: '🧒',
  child: '🧒', children: '🧒',
  class: '🏫', classes: '🏫',
  school: '🏫',
  friend: '🧑‍🤝‍🧑', friends: '🧑‍🤝‍🧑',
  juice: '🧃', box: '📦', boxes: '📦',
  pack: '📦', packs: '📦',
  basket: '🧺', baskets: '🧺',
  apple: '🍎', apples: '🍎',
  crayon: '🖍️', crayons: '🖍️',
  row: '🪑', rows: '🪑', chair: '🪑', chairs: '🪑',
  hall: '🏛️',
  shell: '🐚', shells: '🐚',
  bird: '🐦', birds: '🐦', wire: '➖',
  pencil: '✏️', pencils: '✏️',
  muffin: '🧁', muffins: '🧁',
  tray: '🍽️', trays: '🍽️',
  baker: '👩‍🍳',
  bag: '👜', bags: '👜',
  fish: '🐠', tank: '🐟',
  page: '📃', pages: '📃',
  jar: '🫙',
  book: '📚', books: '📚',
  shelf: '📚', shelves: '📚',
  shop: '🏪',
  cm: '📏', m: '📏'
};

const COLORS = { red: '🔴', blue: '🔵', yellow: '🟡', green: '🟢', orange: '🟠', white: '⚪' };

export const normalizeWord = w => String(w || '').toLowerCase().replace(/[^a-z\s-]/g, '').trim();

export function lookupWord(raw, sentence = '') {
  const w = normalizeWord(raw);
  if (!w) return null;

  if (MATH_WORDS[w]) {
    const m = MATH_WORDS[w];
    return { word: w, emoji: m.emoji, meaning: m.meaning, note: m.careful || '', kind: 'math', source: 'dictionary' };
  }
  if (COLORS[w]) {
    return { word: w, emoji: COLORS[w], meaning: `${cap(w)} is a colour. Look for the ${w} things in the story.`, kind: 'word', source: 'dictionary' };
  }
  if (OBJECT_WORDS[w]) {
    return { word: w, emoji: OBJECT_WORDS[w], meaning: `${cap(w)} — this is one of the things the story is counting.`, kind: 'thing', source: 'dictionary' };
  }
  // Try the singular form.
  const singular = w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
  if (OBJECT_WORDS[singular]) {
    return { word: w, emoji: OBJECT_WORDS[singular], meaning: `${cap(w)} — more than one ${singular}. These are what the story is counting.`, kind: 'thing', source: 'dictionary' };
  }
  return { word: w, emoji: '❓', meaning: `I am not sure about "${w}" yet. Try reading the whole sentence out loud — the other words often give it away.`, kind: 'unknown', source: 'dictionary' };
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// The scaffold for a child who cannot begin. Deliberately concept-independent:
// none of these steps reveals which operation the problem needs.
export const START_LADDER = [
  { emoji: '🎯', text: 'Read the LAST sentence again. That is the question. What is it asking you to find?' },
  { emoji: '🔢', text: 'Now tap each number in the story. I will tell you what that number is counting.' },
  { emoji: '🎨', text: 'Picture it in your head, or draw it. Draw the first thing the story talks about, then ask: what happens to it next?' }
];

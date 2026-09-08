// Sharing a puzzle with a friend.
//
// A shared puzzle travels IN THE LINK. There is no row in a database, no account
// on either side, and nothing to look up — which is why a child can send one to a
// friend who has never opened the app before, and why this works the moment it is
// deployed rather than after a login flow.
//
// Two kinds, and NEITHER of them carries prose:
//   - a puzzle the app generated, which its id already describes completely, so
//     the link is about twenty characters
//   - a puzzle a child built, which carries a shape index, two word indices and
//     two numbers
//
// That second point is the whole safety design. Text written by one child and
// shown to another cannot be made safe by a word blocklist: a blocklist matches
// whole English words from a fixed list, so misspellings, other languages and
// ordinary unkindness walk straight through, and because the puzzle lives in the
// link an adult can hand-write one and send it to a child. So the child never
// writes prose. Checking a link on arrival is bounds-checking six small integers
// — there is no string in it that could say anything at all.

import { SHAPE, WHO, THING, MAX_NUM, validate, compose } from './authoring.js';

/* ------------------------------ url-safe base64 ----------------------------- */

const b64 = {
  enc(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s) {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
};

/* --------------------------------- names ------------------------------------ */
// The one free-text field left is the sender's own player name, which a parent
// typed and which only ever appears as "<name> sent you this puzzle". It is
// trimmed to letters, spaces and hyphens so a name cannot become a sentence.

const MAX_NAME = 24;
export function cleanName(n) {
  return String(n || '').replace(/[^\p{L}\p{N} '-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/* ---------------------------------- pack ------------------------------------ */

/** A puzzle the app made. Its id IS the puzzle, so the link is tiny. */
export function packExisting(problemId, fromName) {
  return b64.enc(JSON.stringify({ i: problemId, n: cleanName(fromName) }));
}

/** A puzzle a child built out of a shape, two words and two numbers. */
export function packBuilt(choice, fromName) {
  const { shape, who, who2, thing, a, b } = choice;
  return b64.enc(JSON.stringify({
    k: shape, w: who, w2: who2 ?? null, o: thing, a, b, n: cleanName(fromName)
  }));
}

/** Returns { kind:'existing'|'built'|'rejected', ... } or null if it is damaged. */
export function unpack(code) {
  let o;
  try { o = JSON.parse(b64.dec(String(code || ''))); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const from = cleanName(o.n);

  if (typeof o.i === 'string' && o.i) return { kind: 'existing', id: o.i, from };

  if (typeof o.k === 'number') {
    // Re-checked on the way IN as well as on the way out: a link can be edited by
    // hand, so trusting what was checked at share time would be trusting the
    // sender's browser. Here that check is arithmetic on six integers.
    const choice = { shape: o.k, who: o.w, who2: o.w2 ?? undefined, thing: o.o, a: o.a, b: o.b };
    const v = validate(choice);
    if (!v.ok) return { kind: 'rejected', why: 'That puzzle does not add up — ask your friend to make it again.', from };
    return { kind: 'built', choice, problem: compose(choice), from };
  }
  return null;
}

export const shareUrl = (origin, code) => `${origin}/?p=${code}`;
export { SHAPE, WHO, THING, MAX_NUM, validate, compose };

// Sharing a puzzle with a friend.
//
// A shared puzzle travels IN THE LINK. There is no row in a database, no account
// on either side, and nothing to look up — which is why a child can send one to a
// friend who has never opened the app before, and why this works the moment it is
// deployed rather than after a login flow.
//
// Two kinds:
//   - a puzzle the app generated, which its id already describes completely, so
//     the link carries about twenty characters
//   - a puzzle a child wrote, which carries its own text
//
// Anything a child WROTE is shown to another child, so it goes through check()
// first. That is a filter, not a moderator: it is here to stop the obvious and to
// make the failure a friendly message rather than a surprise on a friend's screen.

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

/* --------------------------------- safety ----------------------------------- */

// Deliberately short and boring. A longer list of banned words would give a false
// sense of completeness; what this actually buys is: no links out, no contact
// details, nothing enormous, and the shape of a real word problem.
const BLOCK = /\b(fuck|shit|bitch|bastard|cunt|dick|piss|slut|whore|nigg|fag|rape|kill yourself|kys)\b/i;
const CONTACT = /(https?:\/\/|www\.|\.com|\.net|\.org|@[a-z0-9]|\+?\d[\d\s().-]{8,})/i;

export const MAX_TEXT = 240;
export const MIN_TEXT = 12;

/**
 * Is this safe and sane to put on another child's screen?
 * Returns { ok } or { ok:false, why } with a message a child can act on.
 */
export function check(text, correct) {
  const t = String(text || '').trim();
  // Measure what a CHILD sees, not the raw string. "[[1|a]] [[2|b]]?" is
  // eighteen characters of markup and seven characters of story, and it was the
  // markup that was getting past the length check.
  const plain = t.replace(/\[\[(\d+)\|[^\]]*\]\]/g, '$1').trim();
  if (plain.length < MIN_TEXT) return { ok: false, why: 'Write a bit more so your friend knows the story.' };
  if (plain.length > MAX_TEXT) return { ok: false, why: `Keep it under ${MAX_TEXT} letters so it fits on the screen.` };
  if (BLOCK.test(plain)) return { ok: false, why: 'Let us keep it friendly — try different words.' };
  if (CONTACT.test(plain)) return { ok: false, why: 'Puzzles cannot have links, emails or phone numbers in them.' };

  const nums = [...t.matchAll(/\[\[(\d+)\|([^\]]{1,40})\]\]/g)];
  if (nums.length < 2) return { ok: false, why: 'Tap at least two numbers in your story so they can be used.' };
  if (nums.length > 4) return { ok: false, why: 'Four numbers is plenty for one puzzle.' };
  if (!/\?\s*$/.test(plain)) return { ok: false, why: 'End with a question, so your friend knows what to find.' };

  const eq = String(correct || '').trim();
  if (!/^[\d+\-x/() ]+$/.test(eq) || !/\d/.test(eq))
    return { ok: false, why: 'Build the answer equation by tapping your numbers.' };

  // Every number in the equation has to be one the story actually offers.
  const inStory = new Set(nums.map(m => m[1]));
  const used = eq.match(/\d+/g) || [];
  if (!used.every(n => inStory.has(n)))
    return { ok: false, why: 'Only use numbers that are in your story.' };
  if (new Set(used).size < 2)
    return { ok: false, why: 'Use at least two different numbers in the answer.' };
  return { ok: true };
}

/* ------------------------------ encode / decode ----------------------------- */

/** A puzzle the app generated: its id already IS the puzzle. */
export function packExisting(problemId, fromName) {
  return b64.enc(JSON.stringify({ i: problemId, n: (fromName || '').slice(0, 24) }));
}

/** A puzzle a child wrote. */
export function packAuthored({ text, correct, name }) {
  return b64.enc(JSON.stringify({
    t: String(text).slice(0, MAX_TEXT), c: String(correct), n: (name || '').slice(0, 24)
  }));
}

/** Returns { kind:'existing'|'authored', ... } or null if the link is damaged. */
export function unpack(code) {
  let o;
  try { o = JSON.parse(b64.dec(String(code || ''))); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const from = typeof o.n === 'string' ? o.n.slice(0, 24) : '';
  if (typeof o.i === 'string' && o.i) return { kind: 'existing', id: o.i, from };
  if (typeof o.t === 'string' && typeof o.c === 'string') {
    // Re-check on the way IN as well as on the way out. A link can be edited by
    // hand, so trusting what was checked at share time would be trusting the
    // sender's browser.
    const v = check(o.t, o.c);
    if (!v.ok) return { kind: 'rejected', why: v.why, from };
    return { kind: 'authored', text: o.t, correct: o.c, from };
  }
  return null;
}

export const shareUrl = (origin, code) => `${origin}/?p=${code}`;

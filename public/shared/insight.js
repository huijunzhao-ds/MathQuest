// What the app noticed about HOW a child works, for the grown-ups view.
//
// Everything else in the app is about one problem at a time. This is the only
// module that looks across problems, which is where style lives: whether they
// pause before starting, whether they answer Pip's question or reach past it for
// the hint, whether the words are the barrier rather than the arithmetic.
//
// Two rules hold this together.
//
// THE TRACE IS SUMMARISED, NEVER STORED RAW. A trace holds every tap and every
// sentence a child typed. That is a child's words, kept on a parent's screen, and
// nothing here needs it: what is kept per problem is a dozen numbers and the words
// they asked the meaning of. Nothing a child composed is retained.
//
// EVERY OBSERVATION CARRIES ITS EVIDENCE AND CAN SAY "NOT YET". A parent reading
// "rushes and then corrects" deserves to see it rests on 4 problems, not 40. An
// observation with too little behind it is not shown at all, because a confident
// sentence about a seven-year-old's mind, drawn from three data points, is worse
// than silence.

export const KEEP = 80;          // problems of history — bounded, so sync stays small
const ENOUGH = 6;                // below this, an observation is not worth making

/* -------------------------------- summarise --------------------------------- */

/** One problem's trace, reduced to what a pattern could be built from. */
export function summarise(trace, meta = {}) {
  const ev = Array.isArray(trace) ? trace : [];
  const at = type => ev.filter(e => e.type === type);
  const first = type => at(type)[0];
  // `t` is a real timestamp in the app and a small number in the tests. Using it
  // as a truth value means a zero start time silently disables every timing, so
  // the presence of a number is what is tested, never its truthiness.
  const t0raw = (first('problem-shown') || ev[0] || {}).t;
  const t0 = typeof t0raw === 'number' && isFinite(t0raw) ? t0raw : null;
  const since = e => (t0 === null || !e || typeof e.t !== 'number' || !isFinite(e.t))
    ? null : Math.max(0, e.t - t0);
  const firstTouch = ev.find(e => e.type === 'tap-number' || e.type === 'tap-operator');
  const submits = at('submit');
  const last = ev[ev.length - 1] || {};

  // What did they do at the moment Pip asked them something? The order matters:
  // a hint AFTER an answer is not the same as a hint INSTEAD of one.
  const askedAt = (first('hint') || first('explain') || {}).t;
  const replied = at('say').length > 0;
  const answered = replied && (!askedAt || at('say').some(e => e.t < askedAt));

  return {
    c: meta.concept || null,
    b: meta.band || null,
    ok: meta.solved ? 1 : 0,
    a: Math.max(1, meta.attempts || submits.length || 1),
    ms: Math.min(since(last) ?? 0, 30 * 60 * 1000),
    t1: since(firstTouch),
    s1: since(submits[0]),
    u: at('undo').length + at('clear').length,
    h: at('hint').length + at('explain').length,
    p: at('show-situation').length + at('viz').length + at('where-do-i-start').length,
    r: at('read-aloud').length,
    v: at('voice-ask').length,
    // The WORD, not the sentence: "pack", not what the child typed about it.
    w: at('ask-word').map(e => cleanWord(e.value)).filter(Boolean).slice(0, 6),
    q: answered ? 'answered' : askedAt ? 'hint' : 'none',
    m: Array.isArray(meta.misconceptions) ? meta.misconceptions.filter(Boolean).slice(0, 3) : [],
    at: meta.when || Date.now()
  };
}

/** A single word, letters only — never a phrase, never punctuation. */
function cleanWord(v) {
  const w = String(v || '').trim().toLowerCase();
  return /^[a-z][a-z'-]{1,20}$/.test(w) ? w : null;
}

/** Add one record to a child's history, keeping it bounded. */
export function remember(history, record) {
  const out = Array.isArray(history) ? history.slice() : [];
  out.push(record);
  return out.slice(-KEEP);
}

/* -------------------------------- observe ----------------------------------- */

const median = xs => {
  const a = xs.filter(n => typeof n === 'number' && isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};
const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
const secs = ms => (ms / 1000 >= 10 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1).replace(/\.0$/, ''));

/**
 * Observations about how this child works, strongest evidence first.
 * Each is { title, detail, n } where n is how many problems it rests on.
 */
export function observe(history = []) {
  const h = Array.isArray(history) ? history : [];
  const out = [];
  if (h.length < ENOUGH) return out;

  /* --- does the question get answered, or reached past? --- */
  const asked = h.filter(r => r.q !== 'none');
  if (asked.length >= ENOUGH) {
    const ans = asked.filter(r => r.q === 'answered').length;
    const p = pct(ans, asked.length);
    out.push({
      n: asked.length,
      title: p >= 60 ? 'Answers Pip rather than reaching past him'
           : p >= 25 ? 'Sometimes answers Pip, sometimes goes for the hint'
                     : 'Goes for the hint rather than answering',
      detail: `Pip asked something on ${asked.length} problems. ${ans} of those got an answer `
            + `before any hint was opened (${p}%). This app rests on a child being willing to be `
            + `asked something rather than told it, so it is the number worth watching.`
    });
  }

  /* --- the shape of the start --- */
  const t1 = median(h.map(r => r.t1));
  if (t1 !== null) {
    const fast = t1 < 6000;
    out.push({
      n: h.filter(r => r.t1 != null).length,
      title: fast ? 'Starts straight away' : 'Reads before touching anything',
      detail: `Half the time the first number is tapped within ${secs(t1)} seconds of the story appearing. `
            + (fast
              ? 'Quick starts are not the same as careless ones — read this next to the first-try rate rather than on its own.'
              : 'A pause before the first tap usually means the story is being read properly, which is what we want.')
    });
  }

  /* --- rushing, specifically: fast FIRST answer that then needed another go --- */
  const retried = h.filter(r => r.a > 1 && r.s1 != null);
  if (retried.length >= ENOUGH) {
    const quick = retried.filter(r => r.s1 < 8000).length;
    if (pct(quick, retried.length) >= 50) out.push({
      n: retried.length,
      title: 'Answers fast, then corrects',
      detail: `Of ${retried.length} problems that took more than one go, ${quick} had a first answer `
            + `within 8 seconds. The second answer is usually right, so this looks like speed rather than `
            + `not knowing — worth saying out loud to them once, not ten times.`
    });
  }

  /* --- reworking the equation before committing --- */
  const u = median(h.map(r => r.u));
  if (u !== null && u >= 1) out.push({
    n: h.length,
    title: 'Rebuilds the equation before checking it',
    detail: `Typically ${u} undo or clear${u === 1 ? '' : 's'} per problem. Changing your mind before `
          + `committing is a good habit, not a wobble.`
  });

  /* --- reading, not maths --- */
  const words = {};
  for (const r of h) for (const w of r.w || []) words[w] = (words[w] || 0) + 1;
  const list = Object.entries(words).sort((a, b) => b[1] - a[1]);
  if (list.length) {
    const total = list.reduce((n, [, v]) => n + v, 0);
    out.push({
      n: h.filter(r => (r.w || []).length).length,
      title: 'Asks what words mean',
      detail: `${total} word lookup${total === 1 ? '' : 's'} on ${h.filter(r => (r.w || []).length).length} problems: `
            + list.slice(0, 8).map(([w, v]) => v > 1 ? `${w} (${v})` : w).join(', ') + '. '
            + 'If these are the objects in the story rather than the maths words, the barrier was reading, '
            + 'and the maths underneath may be further along than the score suggests.'
    });
  }

  /* --- pictures --- */
  const pics = h.filter(r => r.p > 0).length;
  if (pics >= ENOUGH) out.push({
    n: pics,
    title: 'Uses the picture to get started',
    detail: `The situation drawing or the starting ladder was opened on ${pics} of ${h.length} problems. `
          + `Seeing the structure is a legitimate way in, not a crutch — it is deliberately never shown `
          + `before a child has committed to an equation.`
  });

  /* --- listening --- */
  const heard = h.filter(r => r.r > 0).length;
  if (heard >= ENOUGH) out.push({
    n: heard,
    title: 'Prefers the story read aloud',
    detail: `Read aloud on ${heard} of ${h.length} problems. Often a reading-speed signal rather than a maths one.`
  });

  return out.sort((a, b) => b.n - a.n);
}

/** How solid is any of this? Parents should be told, not left to guess. */
export function confidence(history = []) {
  const n = (history || []).length;
  if (n < ENOUGH) return { level: 'none', n,
    why: `Only ${n} problem${n === 1 ? '' : 's'} recorded so far. Patterns need about ${ENOUGH} before they mean anything.` };
  if (n < 20) return { level: 'early', n,
    why: `${n} problems recorded. Enough for a first impression, not enough to act on.` };
  if (n < 50) return { level: 'fair', n, why: `${n} problems recorded.` };
  return { level: 'good', n, why: `${n} problems recorded — the most recent ${KEEP} are kept.` };
}

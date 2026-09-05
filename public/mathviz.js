// Showing the arithmetic.
//
// This is deliberately NOT a model call. A picture of 14 + 9 has exactly one
// correct form, the strategy is a known one, and a wrong picture teaches a wrong
// method — so this is rules territory, like the trap table. It is also instant and
// free, which matters because a child who has miscounted twice should not wait.
//
// The strategies drawn here are the ones taught in K-5, not shortcuts:
//   +   make ten     14 + 9 -> 14 + 6 fills the ten, 3 left over -> 23
//   -   bridge back  23 - 9 -> take 3 to land on 20, then 6 more -> 14
//   x   array        3 x 6  -> three rows of six, counted a row at a time
//   /   sharing      12 / 3 -> deal one to each group, round by round
//
// Everything is absolutely-positioned divs animated with CSS transforms: no SVG
// transform quirks, works in every browser the app already supports.

const CELL = 22, GAP = 4, PITCH = CELL + GAP, PER_ROW = 10;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const at = i => ({ x: (i % PER_ROW) * PITCH, y: Math.floor(i / PER_ROW) * PITCH });
const rowsFor = n => Math.max(1, Math.ceil(n / PER_ROW));

/** Only binary whole-number arithmetic gets a picture. */
export function parseSimple(equation) {
  const m = /^\s*(\d+)\s*([+\-x/])\s*(\d+)\s*$/.exec(String(equation).replace(/[×]/g, 'x').replace(/[÷]/g, '/'));
  if (!m) return null;
  return { a: Number(m[1]), op: m[2], b: Number(m[3]) };
}

/**
 * Whether a picture would help rather than overwhelm. Three hundred and forty
 * blocks is not an explanation, so past these sizes we say nothing instead.
 */
export function canExplain(equation) {
  const p = parseSimple(equation);
  if (!p) return false;
  const { a, op, b } = p;
  if (op === '+') return a + b <= 100 && a > 0 && b > 0;
  if (op === '-') return a <= 100 && b < a && b > 0;
  if (op === 'x') return a <= 12 && b <= 12 && a > 0 && b > 0;
  // Sharing draws a pile AND the groups it is dealt into, so it grows in two
  // directions at once. Past this the card is taller than the screen, and a
  // picture a child has to scroll is not a picture.
  if (op === '/') return b > 0 && b <= 10 && a % b === 0 && a / b <= 10 && a <= 48;
  return false;
}

/* --------------------------------- plumbing --------------------------------- */

function cellEl(kind) {
  const d = document.createElement('div');
  d.className = 'mvcell mv-' + kind;
  return d;
}

function place(el, x, y, opts = {}) {
  el.style.transform = `translate(${x}px, ${y}px)` + (opts.scale ? ` scale(${opts.scale})` : '');
  if (opts.kind) el.className = 'mvcell mv-' + opts.kind;
  if (opts.fade !== undefined) el.style.opacity = opts.fade;
}

/* -------------------------------- strategies -------------------------------- */
// Each returns { width, height, cells(stage), steps: [{ caption, apply }] }.
// `apply` only moves cells that already exist; nothing is created mid-animation,
// so a step can be replayed or jumped to in any order.

function buildAdd(a, b) {
  const total = a + b;
  const onesA = a % PER_ROW;
  const gapRows = rowsFor(a) + 0.6;
  const need = onesA === 0 ? 0 : PER_ROW - onesA;
  const bridges = onesA > 0 && b >= need && total > PER_ROW;

  return {
    width: PER_ROW * PITCH,
    height: (rowsFor(a) + 1 + rowsFor(b)) * PITCH + 8,
    make(stage) {
      const A = [], B = [];
      for (let i = 0; i < a; i++) { const e = cellEl('a'); stage.appendChild(e); A.push(e); }
      for (let i = 0; i < b; i++) { const e = cellEl('b'); stage.appendChild(e); B.push(e); }
      return { A, B };
    },
    steps({ A, B }) {
      const s = [];
      s.push({
        caption: `${a} to start.` + (a > PER_ROW ? ` That is ${Math.floor(a / PER_ROW)} full ten${a >= 20 ? 's' : ''} and ${onesA} more.` : ''),
        apply() {
          A.forEach((e, i) => { const p = at(i); place(e, p.x, p.y); });
          B.forEach((e, i) => { const p = at(i); place(e, p.x, p.y + gapRows * PITCH, { fade: 0 }); });
        }
      });
      s.push({
        caption: `And ${b} more to add.`,
        apply() { B.forEach((e, i) => { const p = at(i); place(e, p.x, p.y + gapRows * PITCH, { fade: 1 }); }); }
      });
      if (bridges) {
        s.push({
          caption: `${a} needs just ${need} more to fill the next ten. Take ${need} from the ${b}.`,
          apply() { B.slice(0, need).forEach((e, i) => { const p = at(a + i); place(e, p.x, p.y); }); }
        });
        s.push({
          caption: `That makes ${a + need}. There ${b - need === 1 ? 'is' : 'are'} ${b - need} left over.`,
          apply() { B.slice(need).forEach((e, i) => { const p = at(a + need + i); place(e, p.x, p.y); }); }
        });
      } else {
        s.push({
          caption: 'Slide them together and count.',
          apply() { B.forEach((e, i) => { const p = at(a + i); place(e, p.x, p.y); }); }
        });
      }
      s.push({
        caption: total > PER_ROW
          ? `${Math.floor(total / PER_ROW)} ten${total >= 20 ? 's' : ''} and ${total % PER_ROW} makes ${total}.`
          : `${total} altogether.`,
        apply() { }
      });
      return s;
    }
  };
}

function buildSub(a, b) {
  const left = a - b;
  const onesA = a % PER_ROW;
  // Bridge back through the ten only when the ones are not enough on their own.
  const bridges = onesA > 0 && b > onesA && a > PER_ROW;
  const first = bridges ? onesA : b;

  return {
    width: PER_ROW * PITCH,
    height: rowsFor(a) * PITCH + 8,
    make(stage) {
      const A = [];
      for (let i = 0; i < a; i++) { const e = cellEl('a'); stage.appendChild(e); A.push(e); }
      return { A };
    },
    steps({ A }) {
      const s = [];
      s.push({
        caption: `${a} to start.`,
        apply() { A.forEach((e, i) => { const p = at(i); place(e, p.x, p.y, { kind: 'a', fade: 1 }); }); }
      });
      s.push({
        caption: `We are taking ${b} away. Here they are.`,
        apply() { A.slice(a - b).forEach((e, i) => { const p = at(a - b + i); place(e, p.x, p.y, { kind: 'gone' }); }); }
      });
      if (bridges) {
        s.push({
          caption: `Take ${first} first — that lands exactly on ${a - first}.`,
          apply() { A.slice(a - first).forEach((e, i) => { const p = at(a - first + i); place(e, p.x, p.y, { kind: 'gone', fade: 0, scale: .4 }); }); }
        });
        s.push({
          caption: `Now ${b - first} more, out of the ten.`,
          apply() { A.slice(left, a - first).forEach((e, i) => { const p = at(left + i); place(e, p.x, p.y, { kind: 'gone', fade: 0, scale: .4 }); }); }
        });
      } else {
        s.push({
          caption: `Take them away.`,
          apply() { A.slice(left).forEach((e, i) => { const p = at(left + i); place(e, p.x, p.y, { kind: 'gone', fade: 0, scale: .4 }); }); }
        });
      }
      s.push({ caption: `${left} left.`, apply() { } });
      return s;
    }
  };
}

function buildMul(a, b) {
  const W = b * PITCH;
  return {
    width: W,
    height: a * PITCH + 8,
    make(stage) {
      const rows = [];
      for (let r = 0; r < a; r++) {
        const row = [];
        for (let c = 0; c < b; c++) { const e = cellEl('a'); stage.appendChild(e); row.push(e); }
        rows.push(row);
      }
      return { rows };
    },
    steps({ rows }) {
      const s = [{
        caption: `${a} row${a > 1 ? 's' : ''} of ${b}. Let us build them.`,
        apply() { rows.forEach((row, r) => row.forEach((e, c) => place(e, c * PITCH, r * PITCH, { fade: 0, scale: .4 }))); }
      }];
      for (let r = 0; r < a; r++) {
        s.push({
          caption: `${r + 1} row${r ? 's' : ''} of ${b} — that is ${(r + 1) * b}.`,
          apply() { rows[r].forEach((e, c) => place(e, c * PITCH, r * PITCH, { fade: 1 })); }
        });
      }
      s.push({ caption: `${a} lots of ${b} is ${a * b}.`, apply() { } });
      return s;
    }
  };
}

function buildDiv(a, b) {
  const q = a / b;
  const GROUP_W = PITCH + 14;
  return {
    width: Math.max(PER_ROW * PITCH, b * GROUP_W),
    height: rowsFor(a) * PITCH + q * PITCH + 46,
    make(stage) {
      const A = [];
      for (let i = 0; i < a; i++) { const e = cellEl('a'); stage.appendChild(e); A.push(e); }
      const labels = [];
      for (let g = 0; g < b; g++) {
        const l = document.createElement('div');
        l.className = 'mvgroup';
        l.style.transform = `translate(${g * GROUP_W}px, ${(rowsFor(a) + 0.4) * PITCH + q * PITCH}px)`;
        l.textContent = String(g + 1);
        stage.appendChild(l);
        labels.push(l);
      }
      return { A, labels };
    },
    steps({ A }) {
      const top = (rowsFor(a) + 0.4) * PITCH;
      const s = [{
        caption: `${a} to share between ${b}.`,
        apply() { A.forEach((e, i) => { const p = at(i); place(e, p.x, p.y, { kind: 'a', fade: 1 }); }); }
      }];
      for (let round = 0; round < q; round++) {
        s.push({
          caption: round === 0
            ? `Give one to each of the ${b}.`
            : `Round ${round + 1}: one more each. Everyone has ${round + 1}.`,
          apply() {
            for (let g = 0; g < b; g++) {
              const idx = round * b + g;
              place(A[idx], g * GROUP_W, top + (q - 1 - round) * PITCH, { kind: 'b' });
            }
          }
        });
      }
      s.push({ caption: `Everything is shared out. Each one has ${q}.`, apply() { } });
      return s;
    }
  };
}

/* ----------------------------- the situation -------------------------------- */
// A different job from everything above. The explainer shows HOW TO COUNT once a
// child already has the right equation. This shows WHAT THE STORY SAYS, for a
// child who has no model at all — and it stops dead before the total.
//
// That gate is the whole design. Pip asks children to draw the story in four
// different places; this is the app finally doing it. But drawing the answer
// would make it an answer key, so there is no total, no running count, and no
// equation anywhere in here. The child counts.

/** "number of plates" -> "plates"; "cookies on each plate" -> "cookies". */
export function nounOf(label) {
  let t = String(label || '').trim();
  t = t.replace(/^(the\s+)?(number of|how many|total)\s+/i, '');
  t = t.split(/\s+(?:on each|in each|in one|per|to share)\b/i)[0];
  return t.trim() || String(label || '').trim();
}

/** Can the story be drawn without drawing the answer? */
export function canShowSituation(problem) {
  if (!problem) return false;
  if (problem.concept === 'mult-groups')
    return problem.groups >= 1 && problem.per >= 1 && problem.groups * problem.per <= 120;
  if (problem.concept === 'add-join') {
    const q = problem.quantities || [];
    return q.length === 2 && q[0].value + q[1].value <= 120;
  }
  return false;
}

export function mountSituation(host, problem) {
  if (!canShowSituation(problem)) return null;
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'mvstage';
  const caption = document.createElement('p');
  caption.className = 'mvcaption';
  host.appendChild(stage); host.appendChild(caption);

  const q = problem.quantities || [];
  let steps;

  if (problem.concept === 'mult-groups') {
    const g = problem.groups, per = problem.per;
    const groupNoun = nounOf(q.find(x => x.value === g)?.label || 'groups');
    const itemNoun = nounOf(q.find(x => x.value === per)?.label || 'things');
    const cols = Math.min(g, per > 6 ? 2 : 4);
    const rows = Math.ceil(g / cols);
    const boxW = per * PITCH + 18, boxH = PITCH + 16;
    stage.style.width = cols * (boxW + 14) + 'px';
    stage.style.height = rows * (boxH + 34) + 'px';

    const boxes = [];
    for (let i = 0; i < g; i++) {
      const box = document.createElement('div');
      box.className = 'mvgroupbox';
      box.style.width = boxW + 'px'; box.style.height = boxH + 'px';
      box.style.transform = `translate(${(i % cols) * (boxW + 14)}px, ${Math.floor(i / cols) * (boxH + 34)}px)`;
      stage.appendChild(box);
      const cells = [];
      for (let k = 0; k < per; k++) {
        const c = cellEl('a'); box.appendChild(c);
        place(c, 9 + k * PITCH, 8, { fade: 0, scale: .4 });
        cells.push(c);
      }
      boxes.push({ box, cells });
    }
    boxes.forEach(b => { b.box.style.opacity = 0; });

    steps = [
      { caption: `The story says there ${g === 1 ? 'is' : 'are'} ${g} ${groupNoun}.`,
        apply() { boxes.forEach(b => { b.box.style.opacity = 1; }); } },
      { caption: `And ${per} ${itemNoun} on each one.`,
        apply() { boxes.forEach(b => b.cells.forEach((c, k) =>
          setTimeout(() => place(c, 9 + k * PITCH, 8, { fade: 1, scale: 1 }), k * 60))); } },
      { caption: `That is the whole story. Now count the ${itemNoun} — how many altogether?`,
        apply() { } }
    ];
  } else {
    const [A, B] = q;
    const nounA = nounOf(A.label), nounB = nounOf(B.label);
    const total = A.value + B.value;
    stage.style.width = Math.min(PER_ROW, total) * PITCH + 'px';
    stage.style.height = (rowsFor(A.value) + rowsFor(B.value) + 1) * PITCH + 'px';
    const gapRows = rowsFor(A.value) + 0.6;
    const a = [], b = [];
    for (let i = 0; i < A.value; i++) { const e = cellEl('a'); stage.appendChild(e); a.push(e); }
    for (let i = 0; i < B.value; i++) { const e = cellEl('b'); stage.appendChild(e); b.push(e); }
    steps = [
      { caption: `${A.value} ${nounA}.`,
        apply() {
          a.forEach((e, i) => { const p = at(i); place(e, p.x, p.y, { fade: 1 }); });
          b.forEach((e, i) => { const p = at(i); place(e, p.x, p.y + gapRows * PITCH, { fade: 0 }); });
        } },
      { caption: `And ${B.value} ${nounB}.`,
        apply() { b.forEach((e, i) => { const p = at(i); place(e, p.x, p.y + gapRows * PITCH, { fade: 1 }); }); } },
      { caption: 'That is the whole story. Now count them.', apply() { } }
    ];
  }

  let timers = [], stopped = false;
  const stop = () => { stopped = true; timers.forEach(clearTimeout); timers = []; };
  function run() {
    stop(); stopped = false;
    const hold = reduced ? 260 : 1900;
    steps.forEach((st, i) => timers.push(setTimeout(() => {
      if (stopped) return;
      st.apply(); caption.textContent = st.caption;
    }, i === 0 ? 0 : hold * i)));
  }
  run();
  return { replay: run, stop };
}

/* ------------------------------- the explainer ------------------------------ */

const BUILDERS = { '+': buildAdd, '-': buildSub, 'x': buildMul, '/': buildDiv };

/**
 * The whole animation as data: every caption, and where each block ends up once
 * all the steps have run. No DOM timing, no waiting — this is what test/mathviz.mjs
 * asserts against, so the pictures are checked the same way the problems are.
 */
export function describe(equation) {
  const p = parseSimple(equation);
  if (!p || !canExplain(equation)) return null;
  const spec = BUILDERS[p.op](p.a, p.b);
  const stage = { appendChild() { } };
  const parts = spec.make(stage);
  const steps = spec.steps(parts);
  for (const st of steps) st.apply();
  const all = [];
  for (const group of Object.values(parts)) {
    for (const item of group.flat ? group.flat() : group) {
      if (!item || !item.className || !item.className.startsWith('mvcell')) continue;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(item.style.transform || '');
      all.push({
        x: m ? Number(m[1]) : null, y: m ? Number(m[2]) : null,
        kind: item.className.replace('mvcell mv-', ''),
        gone: item.style.opacity === 0 || item.style.opacity === '0'
      });
    }
  }
  return { op: p.op, a: p.a, b: p.b, width: spec.width, height: spec.height,
           captions: steps.map(x => x.caption), cells: all, PITCH, PER_ROW };
}

/**
 * Draw `equation` into `host` and play it. Returns a controller with replay()
 * and stop(); calling mount again on the same host replaces what was there.
 */
export function mountExplainer(host, equation, opts = {}) {
  const p = parseSimple(equation);
  if (!p || !canExplain(equation)) return null;
  const spec = BUILDERS[p.op](p.a, p.b);

  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'mvstage';
  stage.style.width = spec.width + 'px';
  stage.style.height = spec.height + 'px';
  const caption = document.createElement('p');
  caption.className = 'mvcaption';
  host.appendChild(stage);
  host.appendChild(caption);

  const parts = spec.make(stage);
  const steps = spec.steps(parts);

  let timers = [], stopped = false;
  const stop = () => { stopped = true; timers.forEach(clearTimeout); timers = []; };

  function run() {
    stop(); stopped = false;
    const hold = reduced ? 260 : (opts.hold || 1750);
    steps.forEach((st, i) => {
      timers.push(setTimeout(() => {
        if (stopped) return;
        st.apply();
        caption.textContent = st.caption;
        if (i === steps.length - 1 && opts.onDone) opts.onDone();
      }, i === 0 ? 0 : hold * i));
    });
  }

  run();
  return { replay: run, stop, steps: steps.length, seconds: Math.round(steps.length * (opts.hold || 1750) / 1000) };
}

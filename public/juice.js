// Game feel: sound, a character who reacts, and celebration.
// No asset files — every sound is synthesised, every graphic is inline SVG/CSS,
// so the whole app stays a zero-dependency folder you can open anywhere.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ----------------------------------- sound ---------------------------------- */

export const Sound = {
  on: load('mq.sound', true),
  ctx: null,

  init() {
    // Browsers only allow audio after a gesture, so this is called on first tap.
    if (this.ctx || !window.AudioContext) return;
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('mq.sound', JSON.stringify(this.on)); } catch {}
    if (this.on) { this.init(); this.note(660, 0.09, 'sine', 0.16); }
    return this.on;
  },

  // One shaped tone. Everything below is built from this.
  note(freq, dur = 0.12, type = 'sine', gain = 0.13, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    // quick attack, gentle exponential release — never clicky, never harsh
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  seq(notes, type = 'sine', gain = 0.13) {
    notes.forEach(([f, at, dur]) => this.note(f, dur ?? 0.16, type, gain, at));
  },

  number()  { this.init(); this.note(523, 0.09, 'triangle', 0.10); },
  operator(){ this.init(); this.note(392, 0.10, 'sine', 0.10); },
  undo()    { this.init(); this.note(294, 0.09, 'sine', 0.08); },
  // deliberately NOT a buzzer — this is curiosity, not failure
  curious() { this.init(); this.seq([[523, 0, 0.14], [466, 0.11, 0.20]], 'sine', 0.11); },
  correct() { this.init(); this.seq([[523, 0, 0.13], [659, 0.09, 0.13], [784, 0.18, 0.30]], 'triangle', 0.13); },
  cheer()   { this.init(); this.seq([[523, 0, .12], [659, .08, .12], [784, .16, .12], [1047, .24, .40]], 'triangle', .14); },
  levelUp() { this.init(); this.seq([[392, 0, .12], [523, .10, .12], [659, .20, .12], [784, .30, .12], [1047, .40, .50]], 'square', .09); },
  star()    { this.init(); this.note(1319, 0.18, 'triangle', 0.10); }
};

function load(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }

/* -------------------------------- celebration ------------------------------- */

const COLORS = ['#FFC94A', '#7DD3FC', '#C4B5FD', '#6EE7B7', '#FCA5A5', '#FFD97A'];

export function confetti(originEl, count = 34) {
  if (reduced) return;
  const r = originEl
    ? originEl.getBoundingClientRect()
    : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const layer = document.createElement('div');
  layer.className = 'fxlayer';
  document.body.appendChild(layer);

  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    const size = 6 + Math.random() * 7;
    p.style.cssText = `left:${x0}px;top:${y0}px;width:${size}px;height:${size * (0.5 + Math.random())}px;background:${COLORS[i % COLORS.length]};border-radius:${Math.random() < .4 ? '50%' : '2px'}`;
    layer.appendChild(p);

    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 2.1;
    const speed = 190 + Math.random() * 320;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;
    p.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) rotate(${Math.random() * 300 - 150}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy + 420}px) rotate(${Math.random() * 700 - 350}deg)`, opacity: 0 }
    ], { duration: 1100 + Math.random() * 700, easing: 'cubic-bezier(.15,.6,.4,1)' });
  }
  setTimeout(() => layer.remove(), 2100);
}

// A number "flies" out of the story and lands in the equation strip.
export function flyChip(fromEl, toEl) {
  if (reduced || !fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const ghost = document.createElement('span');
  ghost.className = 'chip flyghost';
  ghost.textContent = fromEl.textContent;
  ghost.style.cssText = `left:${a.left}px;top:${a.top}px`;
  document.body.appendChild(ghost);
  toEl.style.opacity = '0';
  ghost.animate([
    { transform: 'translate(0,0) scale(1)' },
    { transform: `translate(${(b.left - a.left) * .5}px, ${(b.top - a.top) * .5 - 26}px) scale(1.25)`, offset: .55 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(1)` }
  ], { duration: 340, easing: 'cubic-bezier(.3,.9,.4,1)' }).onfinish = () => {
    ghost.remove();
    toEl.style.opacity = '';
  };
}

export function pulse(el, cls = 'pulse') {
  if (!el || reduced) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* --------------------------------- the buddy -------------------------------- */
// "Pip" — reacts to what the child is doing. Expression is a CSS class on the
// wrapper; the SVG geometry is shared so transitions are smooth.

export const MASCOT_SVG = `
<svg class="pip-svg" viewBox="0 0 120 130" aria-hidden="true">
  <circle class="pip-halo" cx="60" cy="68" r="48"/>
  <circle class="pip-halo pip-halo-2" cx="60" cy="68" r="40"/>

  <g class="pip-orbit">
    <circle class="pip-moon" cx="60" cy="20" r="4"/>
  </g>

  <g class="pip-antenna">
    <path class="pip-stem" d="M60 30 L60 24"/>
    <path class="pip-star" d="M60 2l3.6 7.6 8.3 1.1-6 5.8 1.5 8.2L60 20.9 52.6 24.7l1.5-8.2-6-5.8 8.3-1.1z"/>
  </g>

  <circle class="pip-orb" cx="60" cy="68" r="32"/>
  <ellipse class="pip-cheek" cx="38" cy="76" rx="7" ry="4.6"/>
  <ellipse class="pip-cheek" cx="82" cy="76" rx="7" ry="4.6"/>

  <g class="pip-look">
    <g class="pip-eyes">
      <circle class="pip-eye" cx="49" cy="63" r="5.6"/>
      <circle class="pip-eye" cx="71" cy="63" r="5.6"/>
      <circle class="pip-glint" cx="51" cy="61" r="1.8"/>
      <circle class="pip-glint" cx="73" cy="61" r="1.8"/>
    </g>
  </g>

  <g class="pip-mouths">
    <path class="pip-mouth m-smile" d="M50 78 q10 8 20 0"/>
    <path class="pip-mouth m-flat"  d="M52 80 h16"/>
    <circle class="pip-mouth m-o"   cx="60" cy="80" r="4.6"/>
    <path class="pip-mouth m-big"   d="M47 75 q13 15 26 0 Z"/>
    <path class="pip-mouth m-wave"  d="M50 79 q5 -5 10 0 t10 0"/>
  </g>

  <g class="pip-spark">
    <path d="M17 42l1.7 3.6 3.9.5-2.8 2.7.7 3.9L17 50.9l-3.5 1.8.7-3.9-2.8-2.7 3.9-.5z"/>
    <path d="M103 86l1.4 2.9 3.2.4-2.3 2.2.6 3.2-2.9-1.5-2.9 1.5.6-3.2-2.3-2.2 3.2-.4z"/>
    <path d="M96 30l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z"/>
  </g>
</svg>`;

// Pip is meant to feel alive between states, not only at them: he blinks on his
// own schedule, follows the pointer with his eyes, glances around when nothing
// is happening, and moves his mouth while he is actually speaking.
export const Pip = {
  els: [],
  state: 'idle',
  mods: new Set(),
  _t: null,
  _blinkT: null,
  _idleT: null,
  _lastMove: 0,

  mount(...containers) {
    for (const c of containers) {
      if (!c) continue;
      c.innerHTML = MASCOT_SVG;
      this.els.push(c);
    }
    this.set('idle');
    if (!reduced) { this._startBlinking(); this._startLooking(); }
    return this;
  },

  _paint() {
    const cls = ['pip', 'pip-' + this.state, ...this.mods].join(' ');
    for (const el of this.els) el.className = cls;
  },

  set(state) {
    // An explicit state cancels a pending flash, so a stale timer can never
    // overwrite the expression the app just asked for. Modifiers (talking,
    // listening) are independent of expression and survive the change.
    clearTimeout(this._t);
    this.state = state;
    this._paint();
  },

  flash(state, ms = 1400, then = 'idle') {
    this.set(state);
    this._t = setTimeout(() => this.set(then), ms);
  },

  mod(name, on) {
    on ? this.mods.add(name) : this.mods.delete(name);
    this._paint();
  },

  /* ---- blinking: irregular, sometimes a double blink ---- */
  _blink() {
    for (const el of this.els) {
      const eyes = el.querySelector('.pip-eyes');
      if (!eyes) continue;
      eyes.classList.remove('blink');
      void eyes.offsetWidth;
      eyes.classList.add('blink');
    }
  },
  _startBlinking() {
    const tick = () => {
      this._blink();
      if (Math.random() < 0.25) setTimeout(() => this._blink(), 220);
      this._blinkT = setTimeout(tick, 2400 + Math.random() * 4200);
    };
    this._blinkT = setTimeout(tick, 1500 + Math.random() * 2000);
  },

  /* ---- eyes follow the pointer; glance around when nothing moves ---- */
  look(dx, dy) {
    for (const el of this.els) el.style.setProperty('--ex', dx.toFixed(2) + 'px');
    for (const el of this.els) el.style.setProperty('--ey', dy.toFixed(2) + 'px');
  },
  _startLooking() {
    const CLAMP = 3.4;
    addEventListener('pointermove', e => {
      this._lastMove = Date.now();
      for (const el of this.els) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.52;
        const dx = Math.max(-CLAMP, Math.min(CLAMP, (e.clientX - cx) / 42));
        const dy = Math.max(-CLAMP, Math.min(CLAMP, (e.clientY - cy) / 60));
        el.style.setProperty('--ex', dx.toFixed(2) + 'px');
        el.style.setProperty('--ey', dy.toFixed(2) + 'px');
      }
    }, { passive: true });

    const glance = () => {
      if (Date.now() - this._lastMove > 3800) {
        const dx = (Math.random() * 2 - 1) * CLAMP;
        const dy = (Math.random() * 2 - 1) * (CLAMP * 0.6);
        this.look(dx, dy);
        setTimeout(() => { if (Date.now() - this._lastMove > 3800) this.look(0, 0); }, 1100);
      }
      this._idleT = setTimeout(glance, 3000 + Math.random() * 3000);
    };
    this._idleT = setTimeout(glance, 4000);
  }
};

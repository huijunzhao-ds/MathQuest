// Reading aloud and listening. Both are optional: if a browser lacks either API
// the buttons hide themselves rather than failing when a child taps them.

export const Speech = {
  synth: window.speechSynthesis || null,
  voice: null,
  speaking: false,
  onstate: null,

  get canSpeak() { return Boolean(this.synth); },
  get canListen() { return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition); },

  init() {
    if (!this.synth) return;
    const pick = () => {
      const vs = this.synth.getVoices();
      if (!vs.length) return;
      // Prefer a natural en-US/en-GB voice; these names are the common good ones.
      const liked = ['Samantha', 'Karen', 'Moira', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny'];
      this.voice = vs.find(v => liked.some(n => v.name.includes(n)))
        || vs.find(v => v.lang && v.lang.startsWith('en') && v.localService)
        || vs.find(v => v.lang && v.lang.startsWith('en'))
        || vs[0];
    };
    pick();
    this.synth.addEventListener?.('voiceschanged', pick);
  },

  // Kid pace: a little slower than default, a little higher, never robotic-fast.
  //
  // The setTimeout is not a style choice. Chrome tears down the utterance it is
  // mid-way through preparing if speak() is called in the same tick as cancel(),
  // and never recovers: `speaking` goes true, no audio comes out, no events fire,
  // and every later call is swallowed until the page is reloaded. It is
  // intermittent, which is how it survived weeks of play-testing and then killed
  // the sound half way through a demo recording.
  say(text, { rate = 0.92, pitch = 1.12, onend } = {}) {
    if (!this.synth || !text) { onend?.(); return; }
    this.stop();
    clearTimeout(this._startT);
    this._startT = setTimeout(() => {
      const u = new SpeechSynthesisUtterance(String(text));
      if (this.voice) u.voice = this.voice;
      u.rate = rate; u.pitch = pitch; u.volume = 1;
      u.onstart = () => { this.speaking = true; this.onstate?.(true); this._watch(); };
      u.onend = u.onerror = () => {
        this.speaking = false; this._unwatch(); this.onstate?.(false); onend?.();
      };
      try { this.synth.speak(u); this._watch(); }
      catch { this.speaking = false; this._unwatch(); onend?.(); }
    }, 60);
  },

  // Chrome's other one: it stops speaking after roughly fifteen seconds unless
  // something pokes it. resume() on a paused-or-not queue is harmless, so this
  // just keeps poking while an utterance is outstanding. A story read aloud is
  // easily longer than fifteen seconds, so this is not hypothetical.
  _watch() {
    if (this._watchT) return;
    this._watchT = setInterval(() => {
      if (!this.synth || (!this.synth.speaking && !this.synth.pending)) return this._unwatch();
      try { this.synth.resume(); } catch {}
    }, 5000);
  },

  _unwatch() {
    clearInterval(this._watchT);
    this._watchT = null;
  },

  stop() {
    if (!this.synth) return;
    clearTimeout(this._startT);
    this._unwatch();
    try { this.synth.cancel(); } catch {}
    this.speaking = false;
    this.onstate?.(false);
  },

  // Returns a stop() function. onResult gets the transcript.
  listen({ onResult, onEnd, onError } = {}) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { onError?.('unsupported'); return () => {}; }
    let rec;
    try { rec = new Rec(); } catch { onError?.('failed'); return () => {}; }
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = e => onResult?.(e.results[0][0].transcript);
    rec.onerror = e => onError?.(e.error);
    rec.onend = () => onEnd?.();
    try { rec.start(); } catch { onError?.('failed'); }
    return () => { try { rec.stop(); } catch {} };
  }
};

Speech.init();

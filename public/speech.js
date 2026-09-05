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
  say(text, { rate = 0.92, pitch = 1.12, onend } = {}) {
    if (!this.synth || !text) { onend?.(); return; }
    this.stop();
    const u = new SpeechSynthesisUtterance(String(text));
    if (this.voice) u.voice = this.voice;
    u.rate = rate; u.pitch = pitch; u.volume = 1;
    u.onstart = () => { this.speaking = true; this.onstate?.(true); };
    u.onend = u.onerror = () => { this.speaking = false; this.onstate?.(false); onend?.(); };
    try { this.synth.speak(u); } catch { this.speaking = false; onend?.(); }
  },

  stop() {
    if (!this.synth) return;
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

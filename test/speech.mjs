// Reading aloud, and the two Chrome bugs that make it stop.
//
// This test exists because the sound died half way through recording the demo
// video and took an hour to understand. Both bugs are in Chrome, not in this app,
// but the app is what has to survive them:
//
//   1. cancel() and speak() in the SAME TICK wedges the speech queue. `speaking`
//      goes true, no audio comes out, no events fire, and every later utterance is
//      swallowed until the page is reloaded.
//   2. Chrome stops speaking after roughly fifteen seconds unless something calls
//      resume(). A word problem read aloud is easily longer than that.
//
// Neither is reproducible by clicking, which is exactly why they need a test.

const fails = [];
const fail = m => fails.push(m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------- a speechSynthesis that logs ------------------------ */
// It records the ORDER of calls, which is the whole point: it is the adjacency of
// cancel and speak that breaks Chrome, not either one alone.
const log = [];
let live = null;

const synth = {
  speaking: false,
  pending: false,
  paused: false,
  getVoices: () => [{ name: 'Samantha', lang: 'en-US', localService: true }],
  addEventListener() {},
  cancel() { log.push('cancel'); this.speaking = false; live = null; },
  resume() { log.push('resume'); },
  speak(u) {
    log.push('speak');
    live = u;
    this.speaking = true;
    // Chrome fires onstart asynchronously, after the audio device opens.
    setTimeout(() => u.onstart && u.onstart(), 5);
  }
};

globalThis.window = {
  speechSynthesis: synth,
  SpeechRecognition: function () {},
  matchMedia: () => ({ matches: false })
};
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};

const { Speech } = await import('../public/speech.js');

/* ---------------- 1 · cancel and speak never share a tick --------------------- */
log.length = 0;
Speech.say('two plates with three cookies on each');

const sameTick = log.join(',');
if (sameTick.includes('cancel,speak')) {
  fail('cancel() and speak() ran in the same tick — this is the wedge');
}
if (log.includes('speak')) {
  fail('speak() ran synchronously; it must be deferred past the cancel');
}
await sleep(120);
if (!log.includes('speak')) fail('speak() never ran at all');
console.log('  cancel() and speak() are never in the same tick');

/* ------------- 2 · the watchdog pokes resume() while speaking ----------------- */
// The real interval is 5s; waiting that long in a test is silly, so this asserts
// the watchdog EXISTS and is wired to the speaking state rather than its period.
if (!Speech._watchT) fail('no resume watchdog is running while an utterance is live');
console.log('  a resume watchdog runs for as long as an utterance is outstanding');

/* ------------------ 3 · stop() leaves nothing running ------------------------- */
Speech.stop();
if (Speech._watchT) fail('stop() left the resume watchdog running');
if (Speech.speaking) fail('stop() left `speaking` true');
console.log('  stop() clears the watchdog and the pending start');

/* --------- 4 · a second say() while the first is queued does not stack -------- */
log.length = 0;
Speech.say('first');
Speech.say('second');
await sleep(150);
const speaks = log.filter(x => x === 'speak').length;
if (speaks !== 1) fail(`two rapid say() calls produced ${speaks} speak() calls, expected 1`);
if (live && live.text !== 'second') fail(`the later utterance did not win (got "${live && live.text}")`);
console.log('  two calls in quick succession speak once, and the later one wins');

/* --------------- 5 · an end event stops the watchdog too ---------------------- */
Speech.say('done in a moment');
await sleep(120);
synth.speaking = false;
live.onend();
if (Speech._watchT) fail('the watchdog kept running after onend');
if (Speech.speaking) fail('`speaking` stayed true after onend');
console.log('  an utterance ending clears the watchdog');

if (fails.length) {
  console.error('\n  FAILED\n' + fails.map(f => '    - ' + f).join('\n'));
  process.exit(1);
}
console.log('\n  reading aloud survives both of Chrome\'s speech bugs\n');

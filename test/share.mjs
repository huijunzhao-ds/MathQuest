// Child-authored text is shown to another child, so the filter is tested rather
// than trusted — including the case where the link itself has been tampered with.

import * as S from '../public/shared/share.js';

const fails = [];
const fail = m => fails.push(m);
const ok = (t, c) => S.check(t, c).ok;

const GOOD = 'I have [[3|bags]] bags. Each bag has [[4|marbles in each]] marbles. How many marbles?';

/* 1 -- a sensible puzzle passes */
if (!ok(GOOD, '3x4')) fail('a perfectly good puzzle was rejected: ' + S.check(GOOD, '3x4').why);

/* 2 -- what must never reach another child's screen */
for (const [why, text, eq] of [
  ['too short',        'hi [[1|a]] [[2|b]]?',                                    '1+2'],
  ['no question',      'I have [[3|a]] and [[4|b]] cats.',                        '3+4'],
  ['one number only',  'I have [[3|a]] cats. How many?',                          '3'],
  ['a link',           'go to www.example.com with [[3|a]] and [[4|b]]. how many?','3+4'],
  ['an email',         'email me at a@b.co with [[3|a]] and [[4|b]]. how many?',   '3+4'],
  ['a phone number',   'call 555 123 4567 with [[3|a]] and [[4|b]]. how many?',    '3+4'],
  ['swearing',         'you are a bitch with [[3|a]] and [[4|b]]. how many?',      '3+4'],
  ['invented number',  GOOD,                                                      '3x9'],
  ['not an equation',  GOOD,                                                      'lots'],
  ['one number twice', GOOD,                                                      '3+3']
]) if (ok(text, eq)) fail(`${why}: got through the filter`);

/* 3 -- long text is capped rather than truncated on someone else's screen */
if (ok('x'.repeat(300) + ' [[1|a]] [[2|b]]?', '1+2')) fail('a 300-character story got through');

/* 4 -- a round trip survives, for both kinds */
{
  const a = S.unpack(S.packExisting('g~mult-groups~m10~4~abc0', 'Ava'));
  if (!a || a.kind !== 'existing' || a.id !== 'g~mult-groups~m10~4~abc0' || a.from !== 'Ava')
    fail('an app-made puzzle did not survive the round trip');

  const b = S.unpack(S.packAuthored({ text: GOOD, correct: '3x4', name: 'Ben' }));
  if (!b || b.kind !== 'authored' || b.text !== GOOD || b.correct !== '3x4' || b.from !== 'Ben')
    fail('a child-written puzzle did not survive the round trip');
}

/* 5 -- THE ONE THAT MATTERS: a hand-edited link is checked again on arrival */
{
  const nasty = Buffer.from(JSON.stringify({
    t: 'you are a bitch with [[3|a]] and [[4|b]]. how many?', c: '3+4', n: 'x'
  })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const got = S.unpack(nasty);
  if (!got || got.kind !== 'rejected')
    fail('a tampered link was accepted — the filter only ran on the sender side');
}

/* 6 -- damaged links fail quietly instead of throwing */
for (const junk of ['', 'not-base64!!', 'YWJj', S.packExisting('', '')]) {
  try { S.unpack(junk); } catch (e) { fail(`unpack threw on "${junk}": ${e.message}`); }
}

/* 7 -- links stay short enough to send in a message */
{
  const len = S.packExisting('g~multi-step~x-par~2~k3f9', 'Ava').length;
  if (len > 90) fail(`an app-made puzzle link is ${len} characters — too long to paste around`);
  console.log(`  an app-made puzzle packs into ${len} characters`);
}

console.log('');
if (fails.length) { fails.forEach(f => console.log('  FAIL  ' + f)); console.log(`\n  ${fails.length} failures\n`); process.exit(1); }
console.log('  sharing is sound: the filter holds on the way in as well as out\n');

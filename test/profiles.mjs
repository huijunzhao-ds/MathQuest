// Losing a real child's progress is the worst bug this change could have, so the
// migration is tested before anything is built on top of it.

import * as Pr from '../public/shared/profiles.js';

const fails = [];
const fail = m => fails.push(m);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

/* 1 -- a browser with weeks of progress under the OLD single key */
{
  localStorage.clear();
  const legacy = { xp: 240, concepts: { 'add-join': { solved: 12, firstTry: 9 } },
                   bands: { 'add-join:a10': { solved: 12, firstTry: 9 } },
                   solvedIds: ['garden'], misconceptions: { 'keyword-trap-add': 2 } };
  localStorage.setItem(Pr.LEGACY_KEY, JSON.stringify(legacy));

  const p = Pr.ensureProfile('Player 1');
  if (!p) fail('no profile was created');
  eq(Pr.loadProgress(p.id), legacy, 'migrated progress does not match what was there');

  // The original must still be sitting there, untouched, in case any of this is wrong.
  eq(JSON.parse(localStorage.getItem(Pr.LEGACY_KEY)), legacy, 'the old key was modified or removed');

  // Running it again must not create a second profile or re-migrate.
  const again = Pr.ensureProfile('Player 1');
  if (again.id !== p.id) fail('a second call created a different profile');
  eq(Pr.listProfiles().length, 1, 'profile count after two calls');
  console.log('  existing progress migrates into the first profile, original left intact');
}

/* 2 -- children on one browser do not see each other's road */
{
  localStorage.clear();
  const a = Pr.createProfile('Ava');
  Pr.saveProgress(a.id, { bands: { 'add-join:a10': { solved: 5, firstTry: 4 } } });
  const b = Pr.createProfile('Ben');
  eq(Pr.loadProgress(b.id), {}, "a new child inherited someone else's progress");
  Pr.saveProgress(b.id, { bands: { 'mult-groups:m5': { solved: 2, firstTry: 1 } } });
  eq(Pr.loadProgress(a.id).bands['add-join:a10'].solved, 5, "the first child's progress changed");
  eq(Pr.activeProfile().name, 'Ben', 'creating a profile did not switch to it');
  Pr.selectProfile(a.id);
  eq(Pr.activeProfile().name, 'Ava', 'switching profiles failed');
  console.log('  two children on one browser keep separate roads');
}

/* 3 -- reset clears the child, not the family; remove clears both */
{
  localStorage.clear();
  const a = Pr.createProfile('Ava'); Pr.saveProgress(a.id, { xp: 99 });
  const b = Pr.createProfile('Ben'); Pr.saveProgress(b.id, { xp: 7 });
  Pr.resetProgress(a.id);
  eq(Pr.loadProgress(a.id), {}, 'reset did not clear the progress');
  eq(Pr.listProfiles().length, 2, 'reset removed the profile as well');
  eq(Pr.loadProgress(b.id).xp, 7, "reset touched the other child");
  Pr.removeProfile(b.id);
  eq(Pr.listProfiles().length, 1, 'remove did not remove');
  eq(Pr.activeProfile().id, a.id, 'removing the active profile left no active one');
  console.log('  reset clears one road; remove clears the child too');
}

/* 4 -- names are trimmed and bounded, and never empty */
{
  localStorage.clear();
  eq(Pr.createProfile('   ').name, 'Player', 'a blank name should fall back');
  eq(Pr.createProfile('x'.repeat(60)).name.length, 24, 'a long name should be capped');
  eq(Pr.createProfile('  Mia  ').name, 'Mia', 'a name should be trimmed');
  console.log('  names are trimmed, capped and never empty');
}

/* 5 -- a fresh browser with nothing at all */
{
  localStorage.clear();
  const p = Pr.ensureProfile('Player 1');
  if (!p) fail('a brand new browser got no profile');
  eq(Pr.loadProgress(p.id), {}, 'a brand new profile started with something in it');
  console.log('  a brand new browser gets one empty profile');
}

/* 6 -- linking to an account never touches a child's progress */
{
  localStorage.clear();
  const a = Pr.createProfile('Ava');
  Pr.saveProgress(a.id, { xp: 42 });
  Pr.linkProfile(a.id, 'remote-1');
  eq(Pr.listProfiles()[0].remote, 'remote-1', 'link did not stick');
  eq(Pr.loadProgress(a.id).xp, 42, 'linking changed the progress');
  const b = Pr.createProfile('Ben', { activate: false });
  eq(Pr.activeProfile().id, a.id, 'a background create stole the active profile');
  eq(Pr.listProfiles().length, 2, 'background create did not add');
  Pr.unlinkAll();
  if (Pr.listProfiles().some(p => p.remote)) fail('unlink left a link behind');
  eq(Pr.loadProgress(a.id).xp, 42, 'signing out threw away local progress');
  console.log('  linking and unlinking never touch a child\'s progress');
}

/* 7 -- a placeholder profile is pruned once real children arrive, never otherwise */
{
  localStorage.clear();
  Pr.ensureProfile('Player 1');                       // auto placeholder, empty
  const real = Pr.createProfile('Ava', { activate: false });
  Pr.linkProfile(real.id, 'remote-1');
  Pr.saveProgress(real.id, { xp: 5 });
  eq(Pr.pruneAuto(), 1, 'the empty placeholder was not pruned');
  eq(Pr.listProfiles().map(p => p.name), ['Ava'], 'pruning removed the wrong profile');
  eq(Pr.activeProfile().name, 'Ava', 'pruning left no active profile');

  // A placeholder that has been PLAYED is a real child and must survive.
  localStorage.clear();
  const solo = Pr.ensureProfile('Player 1');
  Pr.saveProgress(solo.id, { xp: 3 });
  Pr.createProfile('Ben', { activate: false });
  eq(Pr.pruneAuto(), 0, 'pruning threw away a placeholder that had been played');

  // And it must never remove the last profile, leaving nobody.
  localStorage.clear();
  Pr.ensureProfile('Player 1');
  eq(Pr.pruneAuto(), 0, 'pruning removed the only profile');
  eq(Pr.listProfiles().length, 1, 'nobody is left to play');
  console.log('  placeholder profiles are pruned only when a real child replaces them');
}

/* 8 -- the school year rolls forward on its own, and is never a birthdate */
{
  localStorage.clear();
  const a = Pr.createProfile('Ava');
  Pr.updateProfile(a.id, { grade: 2 });
  const me = Pr.listProfiles()[0];
  eq(me.grade, 2, 'grade did not stick');
  eq(me.gradeYear, Pr.schoolYear(), 'the year it was set was not stamped');
  if ('dob' in me || 'birthday' in me) fail('a birthdate got stored');

  const set2026 = { grade: 2, gradeYear: 2026 };
  eq(Pr.currentGrade(set2026, new Date('2027-01-15')), 2, 'rolled over mid school year');
  eq(Pr.currentGrade(set2026, new Date('2027-08-02')), 3, 'did not roll over in August');
  eq(Pr.currentGrade(set2026, new Date('2029-09-01')), 5, 'three school years on');
  eq(Pr.currentGrade(set2026, new Date('2030-09-01')), 6, 'four school years on');
  eq(Pr.currentGrade(set2026, new Date('2040-09-01')), 6, 'should cap, not run away');
  eq(Pr.currentGrade({}, new Date()), null, 'a profile with no grade should say so');
  eq(Pr.gradeLabel(null), 'Not set', 'unset grade label');

  Pr.updateProfile(a.id, { grade: null });
  if ('grade' in Pr.listProfiles()[0]) fail('clearing the school year left it behind');
  console.log('  school year is stamped once, rolls forward in August, and caps');
}

console.log('');
if (fails.length) { fails.forEach(f => console.log('  FAIL  ' + f)); console.log(`\n  ${fails.length} failures\n`); process.exit(1); }
console.log('  profiles are sound\n');

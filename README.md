# MathQuest

A word-problem game for K-5 students that responds to **how a child is thinking**, not just
whether the answer is right — and that gets out of the way when the barrier is reading
rather than maths.

Visual direction: **Star Explorer** — a night-sky star map, glass surfaces, gold as the
reward currency, one sky-blue action colour. The five concepts are places on the map:
Twin Moons, Comet Trail, Star Cluster, Ring Belt, Nebula Gate. Every icon is drawn inline
as SVG, so nothing depends on emoji fonts.

**Play it:** <https://mathquest-czoy.onrender.com>

Built for the Nerdy AI hackathon, K–5 Math Game prompt.

## Run it

```bash
git clone https://github.com/huijunzhao-ds/mathquest.git
cd mathquest
npm start                 # → http://localhost:5173
```

Node 20 or newer. **No dependencies, no install step, no build.** `npm install` is a
no-op — the whole thing is the standard library plus browser ES modules, which is why
there is no lockfile and nothing to audit.

**It works fully with no configuration at all.** Every puzzle, the diagnosis of *how*
a child is thinking, the Socratic questions, the hints, the pictures, generated
practice, the star map and the progression all run on built-in engines. Everything
below is optional and adds to that floor rather than switching it on.

```bash
npm test                  # 5,280 problems, 1,070 arithmetic pictures, progression, profiles
npm run dev               # the server again, restarting on every save
```

`npm run leaktest` is separate because it needs a live provider key: it makes ~22 real
calls and fails both if Pip leaks the answer AND if he is merely evasive.

### Optional: the live AI tutor

```bash
cp .env.example .env      # put ONE provider key in it
npm start                 # the banner says which provider it picked
```

Three providers, auto-detected from whichever key is present — **Gemini**, **Anthropic**
or **OpenAI**. `AI_PROVIDER` forces one when several exist. Adding a fourth is one
adapter function in `server.js`; nothing else in the app knows which is in use.

With a key, the model writes Pip's wording and the practice problems. **Correct answers
and arithmetic slips never reach it** — the rule engine is certain about those, so they
are answered instantly and for free (see *Where the model is allowed to be in the loop*).


### Optional: parent accounts

Without this, players are kept in the browser and the grown-ups page says so. With it, a
parent signs in and their children's progress follows them to any device.

1. Create a project at [supabase.com](https://supabase.com), then run this in the SQL editor:

```sql
create table public.child (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  grade smallint,
  grade_year smallint,
  progress jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.child enable row level security;
create policy "own children only" on public.child
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
```

   That last policy is the line that actually protects the data. Without it every row is
   readable by anyone with the anon key.

2. **Authentication → Providers → Email → turn "Confirm email" OFF.** Left on, every new
   parent needs a confirmation email, and Supabase's built-in sender allows only **two an
   hour** — which is fine for one person testing and useless for a room of parents. With it
   off, signing up and signing in send no email at all.

3. Put the **project URL** and the **anon** key in `.env`:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

   Both are public values. There is deliberately no `service_role` key: every database call
   carries the signed-in parent's own token, so Postgres row level security decides what
   they can reach. Paste the REST URL by mistake and the server trims it for you.

4. Optional extras. `AUTH_GOOGLE=1` adds Google sign-in (needs an OAuth client in Google
   Cloud with `https://<project>.supabase.co/auth/v1/callback` as the redirect, and the
   provider enabled in Supabase). For the emailed-link option to work, add your origin to
   **Authentication → URL Configuration → Redirect URLs** as `http://localhost:5173/**`.

### Deploying it

Any host that runs a Node process works; the server binds `0.0.0.0` and reads `PORT` from
the environment. On Render: build `npm install`, start `npm start`, health check
`/api/status`, and set the same environment variables — **never `PORT`**, which the host
provides.

Then add the deployed origin to Supabase's **Redirect URLs** and **Site URL**, or the
emailed link silently falls back to Supabase's default site rather than your app.

Two things a public link needs that a laptop does not, both already in place: the model
endpoints carry a per-IP and global budget (`RATE_PER_IP`, `RATE_GLOBAL`) that degrades to
the offline engines rather than erroring, and `/api/selftest` refuses any request that
arrived through a proxy.

## What a child can do

**Build the equation.** Numbers in the story are tappable. Tap a number, an operator, another
number. Every tap is recorded as a reasoning trace.

**Get diagnosed, not marked.** A wrong equation is matched against a table of *plausible wrong
equations* and what each reveals about the child's mental model. Pip asks a question about the
specific choice they made, then a hint, then an explanation — never the answer.

**Practise the exact idea they got wrong.** Three generated problems that keep the same wrong
move tempting. Clearing all three retires the misconception.

**Travel the road.** The home screen is one winding road with 27 stops: five planets — Twin
Moons, Comet Trail, Star Cluster, Ring Belt, Nebula Gate — and the 22 difficulty levels that
branch off them, all on the same map. Each planet takes over the colour of the screen while you
are in it.

**Talk to Pip while you work.** The problem sits on the left, Pip and the conversation on the
right, and the chat keeps the whole history for that one problem — every question the child
asked, every equation they tried, and everything Pip answered. It resets with the next problem.

**Talk to Pip.** One conversation per problem, and Pip receives the whole transcript, so a
reply to his own question is answered as a reply. The buttons are labelled entry points into
that same conversation rather than separate features: "Where do I start?" sends `intent: start`,
tapping a word sends `intent: word`, typing sends neither. The input placeholder changes to
"Answer Pip…" whenever his last message ended in a question.

**Ask Pip about any word** — by tap, by typing, or out loud. Pip answers with a kid-level
meaning, a picture and, for maths words, a warning. This is the part that matters most:
"altogether", "each" and "equally" are the exact words that cause the misconceptions the app
diagnoses, so the vocabulary help and the tutoring point at the same thing.

**Have the story read aloud**, at a slower pace. Pip reads his own hints too.

**Ask "where do I start?"** — a three-step ladder for a child who cannot begin at all:
what is the question asking → what does each number count → picture it. None of the three
steps names an operation, so it never leaks the answer.

**Be shown, not just asked.** "Show me" draws the story as a picture — two plates with three
cookies on each — and stops before the total. It also appears on its own when questioning is
not working (see below).

**Skip ahead, or step back.** Any locked level can be challenged — two right on the
first try and it is yours, with everything below it. Pip offers the level below when a
child is struggling, and says which kind of trouble he can see.

**See where they are.** One currency: the star, earned at a named place on the road. Every
level says what the next star costs in words, and every locked one says what would open it.

## The loop

```
road → pick a world → read story (or have it read) → stuck on a word? ask Pip
                                                   → no idea where to start? ladder
                          ↓
            tap numbers → build equation → submit
                          │
        ┌─────────────────┴──────────────────┐
     correct                            not correct
        │                                     │
  stars · next level opens     diagnose the MISCONCEPTION
                                              │
                       Socratic question → hint → explanation
                                              │
                            wrong twice, or we cannot name it?
                                              │
                              DRAW THE STORY — stop asking
                                              │
                                           retry
                                              │
                            3 generated problems on that same idea
                                              │
                                     misconception retired
```

## Layout

| file | what it does |
|---|---|
| `server.js` | Static server + `/api/say` (the conversation), `/api/diagnose`, `/api/practice`, `/api/selftest`. Holds the API key server-side, owns every prompt, and adapts between Gemini / Anthropic / OpenAI. |
| `test/leak.mjs` | `npm run leaktest` — fourteen ways a child talks a tutor into the answer, plus three fair questions. Fails if Pip leaks (names an operation, gives the number, or describes the operation without naming it) AND fails if he is merely evasive — a Pip who refuses everything must not pass. `npm run leaktest -- --show` prints every reply; read them, because a word list cannot judge tutoring. It also fails Pip for repeating himself — asking the same question twice or opening two replies identically — which is how the first green run still turned out to be a bad tutor. Known limits of the checker itself: a number the child said first is not counted as a leak (Pip is told to route guesses to the Check button), skip-counting is matched by pattern rather than by the phrase "count by" (which collides with "count / by the end of the story"), and pointing at the Check button counts as helpful. |
| `public/shared/generator.js` | Problem generator. Story templates, difficulty bands, seeded RNG, and the structural trap tables. A generated problem's id fully encodes it, so `problemFromId` rebuilds it exactly. |
| `test/generator.mjs` | `npm run gentest` — walks every world x band x template, forty seeds deep, and asserts the properties that make a word problem usable by a seven-year-old: the story reads (no template leftovers, every quantity labelled, ends in a question), the answer is whole and positive, every number in the story is used and none invented, no trap is secretly the right answer, no two traps are the same equation, the id rebuilds the identical problem — and, the point of it, that the real `diagnose()` returns the misconception each trap claims. That last check tests the whole chain, not just the generator. |
| `public/shared/problems.js` | The eight hand-written signature problems. Stories, and the **trap table** — wrong equations mapped to the misconception each one reveals. |
| `public/shared/engine.js` | Expression parser, misconception catalogue, rule-based diagnosis, fallback problem generation. Runs in both browser and server. |
| `public/shared/dictionary.js` | Offline word help — objects and, more importantly, the maths words that mislead. Plus the starting-nudge ladder. |
| `public/app.js` | Road, story, equation builder, reasoning trace, Pip, feedback ladder, progression. |
| `public/shared/profiles.js` | Who is playing. Per-profile storage keys, the migration from the old single key, and the school year — stamped once with the year it was set so it rolls forward each August instead of going stale. |
| `test/profiles.mjs` | `npm run proftest` — the migration first, because losing a real child's progress is the worst bug this could have: a browser holding weeks of work under the old key has it moved into the first profile and **the old key is left untouched**. Then: two children on one browser keep separate roads, reset clears one road but not the child, linking to an account never touches progress, placeholder profiles are pruned only when a real child replaces them, and the school year rolls forward correctly and caps. |
| `public/cloud.js` | The parent's account from the browser's side. Fails soft everywhere — no account, no wifi or an expired token all leave the game exactly as it is. Retries once on a 401, because an expired token is the normal case rather than an error, and scrubs the session token out of the address bar the moment it is read. |
| `public/shared/progress.js` | What a star means, what unlocks what, and where the planets sit on the map. Pure functions, no DOM — because a progression that can dead-end is a bug you cannot find by clicking. |
| `test/progress.mjs` | `npm run progtest` — plays simulated children through the whole progression. A child who always solves first time; **a child who never solves cleanly** (the dead-end test — gating on stars alone would have stranded exactly the child who needs the most help, so effort opens doors too); 300 random children checked for dead ends and for progress never going backwards; every "next star" promise checked against what the rules actually charge; and old saved progress checked to survive the move from per-world to per-level stars. |
| `public/mathviz.js` | Draws the arithmetic when a child has the right equation but keeps miscounting: make ten, bridge back, arrays, equal sharing. Deterministic, no model call, no assets — absolutely-positioned divs animated with CSS transforms. |
| `test/mathviz.mjs` | `npm run viztest` — checks over a thousand pictures against a stubbed DOM: the blocks end up forming contiguous rows of ten, the number left after a subtraction is right, an array has the right rows and columns, sharing leaves equal groups, and the final caption says the actual answer. A wrong picture teaches a wrong method, so it gets the same treatment as a wrong problem. |
| `public/juice.js` | Synthesised sound, confetti, and Pip's expressions. No asset files. |
| `public/styles.css` | The whole look. Storybook palette and scenery, quest-map road, arcade button depth. |
| `public/speech.js` | Read-aloud and voice input. Both optional — the buttons hide themselves if a browser lacks the API. |

## Not everyone starts at the beginning

A third-grader who already knows addition should not have to walk up from "Up to 10".
So **every locked level is an invitation rather than a wall**: tap it and Pip offers
a challenge — *"Get 2 right on the first try and this level is yours."*

- Pass, and the level opens **and so does everything below it** — proving you can do
  "Up to 100" and then being told "Up to 20" is shut would be absurd. Proving a world
  at any level also opens whatever that world gates, so testing out of addition opens
  subtraction.
- Only **first-try** solves count, so it cannot be ground out. A miscount does not
  fail it — the claim is "I know this", and building the wrong model is what
  disproves that, not slipping on the arithmetic.
- Fail, and nothing is lost: *"That one was tricky — no harm done. Let us warm up on
  Up to 20 first."* with a button that takes them there, and another that says stay.
- **No stars are invented.** Skipping ahead is recorded in `P.testedOut`, separately
  from earned stars, so the map can mark it and the parent view can tell "tested out"
  from "worked through" — which is more informative, not less.

### And Pip offers the way back down

The same mechanism in reverse. If a child is struggling, Pip offers the level below —
once per visit, as an offer, never a demotion — and the wording depends on WHY:

- two arithmetic slips: *"Your thinking keeps being right — it is the counting with
  numbers this big that is hard. We could do Up to 20 for a bit and come back."*
- three modelling errors: *"These are fighting back a little. Up to 20 would build
  this up first — only if you want to."*

`npm run progtest` simulates children who skip ahead at random and asserts they can
never dead-end, never open a level ABOVE the one they challenged, and can still go on
to earn every star on the road.

## When to stop asking and start showing

Socratic questioning only works on a child who has a model to interrogate. A child
who does not know what they do not know cannot answer "why did you choose that?",
and asking a third time is pressure rather than teaching. Found by playtesting: a
grown-up played a seven-year-old who had never met multiplication, and the app kept
asking why.

So the app now switches from asking to SHOWING when:

- the child has been wrong twice on the same problem, or
- the diagnosis is `unknown` — we cannot name what they are thinking, so neither
  can they,
- or they tap **Show me**, which sits beside "Where do I start?" so the whole
  escalation is tappable. A stuck seven-year-old should not have to type their way
  out.

What it shows is `mountSituation()`: the STORY as a picture — two plates with three
cookies on each — and it stops dead before the total. No sum, no running count, no
equation. That gate is the whole design: Pip asks children to draw the story in four
different places, and this is the app finally doing it, without turning it into an
answer key. The child still counts.

### Repeated addition is not a mistake

A child who writes `3 + 3` for two plates of three cookies has modelled the situation
correctly and simply has not met the shorter notation yet — it is the step
multiplication is built on. The rule engine used to call it `unknown` and ask the
child to explain themselves, which is the worst possible answer for the one child who
reasoned it out from scratch. (The MODEL spotted it — it replied "Correct repeated
addition" — and was overruled, because the rule engine is authoritative on
correctness. The rule was the thing that was wrong.)

Equal-groups problems now accept both repeated-addition forms, and when one is used
Pip names it and hands over the shorthand: *"That is exactly right — 2 lots of 3 is 6.
You wrote it the long way... there is a shorter way to write it: 2 x 3."* That is the
moment multiplication is actually taught, and it only happens if the app notices.

One consequence worth knowing: at 2 x 2 the "added instead of grouping" trap (`2+2`)
is indistinguishable from correct repeated addition. Where we cannot tell them apart,
the child gets the benefit of the doubt — `npm run gentest` asserts no trap ever
collides with an accepted answer.

## Running it as a public link

A link anyone can open is a different thing from a laptop with one child on it.

**Fair use.** The model endpoints are open to whoever finds them, and one script can spend
a day's quota in a minute. There is a per-IP and a global budget (`RATE_PER_IP`,
`RATE_GLOBAL`), and going over does not error — it takes the exact path the app takes when
no key is set. A child who trips the limit gets a slightly more generic Pip; the person
hammering it gets the rule engine. Nothing to see, nothing to spend.

**Whose children are typing into it.** On Gemini's free tier, prompts and responses may be
used to improve Google's products and may be seen by human reviewers. The app sends only
the problem text, the tapped word and the equation built — no names, nothing from a
profile — but once strangers' children are using it, that is a decision to make on purpose.
The paid tier does not use prompts for product improvement.

**`/api/selftest` refuses anything that arrived through a proxy.** It names the provider,
shows a masked key and makes a real model call on every hit. Checking the socket address
alone was not enough: behind a load balancer that address *is* loopback, so the endpoint
was wide open on the first deploy. A forwarded header now means "from outside", whatever
the socket says.

## Where the model is allowed to be in the loop

The rule engine decides *whether* an equation is right; the model decides *how to
talk about it being wrong*. That boundary is also a latency and cost boundary:

- **Right answer** — settled locally, in the browser, in about a millisecond. No
  request, no tokens, no "let me think" between a child and their confetti. The
  engine is certain, so there is nothing for a model to add.
- **Right equation, wrong sum** — also settled locally. The rules already know
  the model was correct and only the counting slipped, and saying so is a fixed
  sentence. On the SECOND slip on the same problem the app draws the sum instead
  (see below) — a picture beats a paragraph, and a generated picture beats a
  generated paragraph.
- **Wrong equation** — this is where the model earns its keep, and where a two to
  four second pause is fine, because the child is about to be asked a question
  rather than handed a verdict. The rule engine still decides correctness and
  still supplies a fallback question if the call fails.

Both layers enforce it: `check()` in `app.js` never sends a correct answer or a
slip, and `/api/diagnose` returns the rule result immediately for both, so no
caller can spend a token on something already known for certain.

### Why the arithmetic pictures are not generated by a model

`mathviz.js` draws 14 + 9 as blocks: ten blue and four blue, nine green, then six
green move up to fill the second ten, leaving three. That is the make-ten strategy
as taught, and it has exactly one correct form. A model asked to draw it would be
slower, cost tokens, and could get it subtly wrong — and a wrong picture teaches a
wrong method, which is worse than no picture. So the strategies are hard-coded and
tested, the same argument as the trap table. Four are drawn: make ten, bridging
back through ten, arrays, and dealing into equal groups. Past the size where blocks
stop explaining anything (three-digit sums, 144 blocks in twelve piles) the app
shows nothing rather than a wall of squares.

## The idea worth defending in a demo

`problems.js` is the part judges should look at. A problem does not just carry a correct
answer — it carries a map of *plausible wrong equations*:

```js
correct: '10x2',
traps: {
  '10+2': 'additive-instead-multiplicative',   // sees two numbers, adds them
  '10-2': 'keyword-trap-subtract',             // followed a keyword
  '10/2': 'divide-instead-multiply'            // right relationship, wrong direction
}
```

That turns "wrong" into "here is how you were thinking" with no model call. The AI layer then
does what rules cannot: read the *trace* — hesitation, revisions, the order things were
tapped — and write a question aimed at that particular child.

Two things fall out of this that are worth saying out loud in the video:

- The engine separates a **careless arithmetic slip** (right equation, wrong number) from a
  real conceptual misunderstanding, and treats them completely differently.
- **Reading is not maths.** A child who cannot read "altogether" is not a child who cannot
  multiply. Read-aloud, word lookup and the starting ladder exist so the assessment measures
  the thing it claims to measure.

## Who is playing, and accounts

A shared laptop is the normal case: one child hands it to the next. Progress is keyed
per profile, and the header has a "who is playing" picker — switch, add someone, or
start one child fresh. Everything is local; no account is needed for any of it.
`npm run proftest` covers the part that would hurt most if it were wrong: a browser
holding weeks of progress under the old single key has it migrated into the first
profile, **and the old key is left exactly where it was**, so nothing is unrecoverable.

### Signing in

**Email and password is the front door**, and it can send NO email at all provided
"Confirm email" is off in Supabase. That matters more than it sounds: the built-in sender
allows two messages an hour — fine for one parent testing, useless for a room of them. An
emailed magic link is still offered as a secondary option, and Google sign-in appears when
`AUTH_GOOGLE=1`.

Passwords are hashed and checked by Supabase. This server forwards the credentials over
HTTPS and keeps nothing: the failure paths report Supabase's status code and a mapped
message, never the body of a request that carried a password.

**There is exactly one sign-in surface.** There were briefly two — a form inside the "who
is playing" panel and one on the grown-ups page — and they drifted: the password form went
into one, and the one people actually found still offered only the emailed link. The panel
now carries a status line and a button through to the single page that owns accounts.

Accounts sit ON TOP of local players, never underneath, and are optional:

- **The account belongs to the parent**, not the child. A child is a profile with a
  first name under a parent's email. This is the COPPA-shaped answer — collecting
  personal information from under-13s means verifiable parental consent — and it
  happens to be exactly the structure the parent view needs anyway.
- **Sign-in is a magic link.** No password is created, sent or stored, so there is
  nothing here to steal.
- **The server holds no service_role key.** Every database call carries the parent's
  own access token, so row level security in Postgres decides what they can reach. A
  bug in `server.js` cannot read another family's rows because the database refuses,
  not because this file is careful. Tested against a stand-in Supabase: one parent
  writing to another's child is rejected.
- **Refused writes are reported as refused.** RLS denies by matching zero rows rather
  than erroring, so a naive `PATCH` returns 200 and looks like a save. The endpoint
  asks for the row back and 404s when nothing came — telling a parent their child's
  progress was saved when it was not is the worst way to lose it.
- With `SUPABASE_URL` and `SUPABASE_ANON_KEY` unset, every account endpoint answers
  `{enabled:false}`, the grown-ups panel hides itself, and the app behaves exactly as
  it does with no account at all.
- **The token never stays in the address bar.** A magic link arrives as a URL
  fragment; it is read once, stored, and scrubbed with `replaceState`, because a URL
  with a session token in it gets copied, pasted and shared.
- **Adopt before creating.** A parent signing in on a laptop that already has "Ava"
  on it means the same child, not a second one. Merging matches an unlinked local
  profile by name and links it, keeping whichever copy is newer. Without this you get
  two Avas on the device and, after the next upload, two on the account.
- **Placeholder profiles are pruned.** A device seeing the account for the first time
  made an empty "Player 1" at boot, before the real children arrived. It is marked
  `auto` when created and dropped once a real child replaces it — never when it has
  been played, and never if it is the last one.
- Sync is last-write-wins on a timestamp, which suits one child on one device at a
  time. It is not a merge, and two devices played offline in parallel will lose the
  older run.

The whole flow is tested against a stand-in Supabase (`fakesupa.mjs`): send a link,
return through it, upload local children, then sign in on a second browser with
nothing on it and get the same child with the same stars.

## Two things deliberately NOT in this app

**No streak counter.** There was one — a flame with a day count. It came out because
streaks work by making you feel bad for breaking one, which is a poor mechanic to put in
front of a seven-year-old, and because it rewards showing up rather than thinking well.
The day counts are still recorded for the grown-ups view, where "played on 9 of the last
14 days" is context rather than pressure.

**No XP or level number.** Same reason the flame went: the tester could not say what it
was for. One visible currency, the star, earned at a named place on the road.

## The run to submission

Hackathon deadline is **Fri 18 Sept, 11:59pm CDT**; we submit **Thu 17 Sept** so the last
day is spare. Finalists 21-23 Sept, Demo Day 25 Sept.

**There are two freeze dates, not one.** Anything a child touches has to be deployed and
tried on a phone before the friends' playtest, so it freezes **Fri 11 Sept**. Anything only
a grown-up ever sees — the parent view, the README, the submission write-up — has no
playtest to survive and cannot regress the children's app, so it can move until **Tue 15
Sept**. That distinction is what sets the order below: child-facing work goes early,
grown-up-facing work goes late.

| date | what | status |
|---|---|---|
| **Sat 5 Sept** | Levels and stars made legible + the branching map. Surface the reasoning trace — Pip says what he noticed about *how* they worked, which is the one thing rules cannot do. | ✅
| **Sun 6 Sept** | Finish deploy. **Public git repo, LICENSE, and the submission assets**: a live URL, the written entry, and `/api/selftest` plus all four test suites shown in the README. | ✅
| **Mon 7 Sept** (holiday) | **Decide the safety policy on child-authored problems.** Decided: **fill-in-the-blanks only, no free prose.** Built on the 8th — see below. | ✅
| **Tue-Fri 8-11 Sept** | **Make and share problems and Parent mode** — built. Remaining: end-to-end test with the household tester, and the video script. | 🔄
| **Sat-Sun 12-13 Sept** | Playtest with his friends. **Film it** (with their parents' permission). Come back with the four numbers below. | ⏳
| **Mon-Wed 14-16 Sept** | Bug fixes and at most two feedback features. **Parent mode** — grown-up-facing, no child can reach it, so this is the right place for it. Cut and finish the video. | ⏳
| **Thu 17 Sept** | Submit. | ⏳

Rules that keep this from slipping:

- **The video script gets written BEFORE the playtest**, in the 8-11 Sept block, while
  there is still slack. It is cheap to write and impossible to rush. Write it as a
  structure with **one deliberate gap** in it: the playtest footage does not exist yet, and
  the shot of a real child's face changing is the emotional peak of the film, not b-roll to
  cut around.
- **After 14 Sept, only bugs and two small feature requests land.** Six-year-olds will
  generate a long list; the list is a gift for after the hackathon, not a plan for the final
  week. Parent mode is the single exception, and only because no child can see it, so it
  cannot break anything they use.
- **Nothing ships to the friends' playtest that has not been deployed and tried on a
  phone.** 12 Sept is the first time the app meets a device we do not own.
- **The safety policy is decided before anything is built on top of it.** Text written by
  one child and shown to another is not a checkbox inside a two-day feature. Either
  authoring is narrowed to **template fill-in-the-blank** — the child drops nouns and
  numbers into slots and never writes free prose, which turns the review from judging
  content into checking a word list, and costs nothing pedagogically because the hard part
  is choosing the trap and the numbers, not composing sentences — or the whole feature
  moves to after the hackathon and the demo uses problems our own tester wrote.
- **The repo and the live URL are shipped on 6 Sept, not on submission day.** They are the
  only items on this list whose absence disqualifies the entry outright, and they are the
  cheapest things here.

### What the playtest has to bring back

12-13 Sept is the highest-information event in the project, and "film it" is not a
measurement plan. Four numbers, every one of them already instrumented:

1. **Did they answer Pip's question, or go straight for the hint?** `track('hint')` and
   `state.usedHelp` already record it. Everything here rests on a seven-year-old being
   willing to be *asked* something rather than told it. If they all skip the question, the
   diagnosis layer is a grown-up feature wearing a child's costume — and it is far better
   to learn that on 13 Sept than after submitting.
2. **How many children actually retired a misconception?** The completion rate on the one
   mechanic the competition brief is asking for.
3. **Where did they stop?** The last screen before they wandered off.
4. **How often was word help used, and on which words?** The evidence for *reading is not
   maths*: if the lookups cluster on the maths words rather than the objects, the argument
   is made for us.

## Shipped on 7 Sept

- **Live at a public URL**, deployed from this repo. Node process, no build, health check
  on `/api/status`.
- **Players.** A shared laptop is the normal case: one child hands it to the next. Each has
  their own road, their own stars, and a picker in the header. Progress from before players
  existed is migrated into the first one.
- **Parent accounts**, optional and never in the way — the app opens on the star map and no
  child is asked to sign in to anything. Email and password, a magic link, or Google.
- **A grown-ups page** that owns everything to do with accounts: sign in, add a player, set
  a school year, remove one. Reachable in one tap from the map.
- **Fair-use budgets** on the model endpoints that degrade to the offline engines.

Four bugs found by testing rather than by clicking, each of which would have looked fine:
the server **crashed at boot** when a Gemini key was set without a model pinned (a `.env`
with both never showed it); `/api/selftest` was **wide open behind the proxy** because the
socket address is loopback there; the magic link **landed on the star map** because signing
in triggers a reload that threw away why you were there; and signing in on a device that
already had "Ava" **created a second Ava**.

## Shipped on 8 Sept — puzzles that travel, and the safety decision behind them

**The decision first, because it changed the build.** The 7 Sept item was one choice:
either child authoring is narrowed to fill-in-the-blanks, or the feature waits until after
the hackathon. It is narrowed. A first pass at free prose with a word blocklist was written
and then thrown away, and it is worth saying why, because the version that got deleted is
the one most people would ship:

- A blocklist matches whole English words from a fixed list. Misspellings, spacing, other
  languages and ordinary unkindness — *"nobody likes you"* — walk straight through it.
- The puzzle travels **in the link**, which is the feature's whole appeal. That also means an
  adult can hand-write a link and send it to a child. Re-checking on arrival helps only as
  much as the check itself is worth, and the check was a word list.
- It is client-side. Nothing is logged, nothing is reviewable, nobody is on call.

So **the child never types prose.** They choose a *shape*, choose the words from fixed
lists, and choose the numbers. The link carries a shape index, two word indices and two
numbers — 64 characters — and checking one on arrival is bounds-checking six integers.
There is no string in it that could say anything. `test/share.mjs` states the guarantee
directly: whatever a link says, what comes out is a puzzle **the app itself would have
built**.

This costs nothing pedagogically, and it buys something free prose could never have had:

- The hard part of composing a word problem is picking the structure and the numbers —
  deciding that "8 boxes of 3" is a multiplication and that 8 and 3 make it worth solving —
  not writing the sentence. The maker names the numbers by what they *mean* in the chosen
  shape (*"how many boxes"*, *"in each box"*), which is the lesson.
- Because the shape is known, **an authored puzzle inherits the whole diagnosis layer**. A
  friend who adds when they should multiply gets the *added instead of seeing equal groups*
  reply — on a puzzle their friend invented. Free prose would have fallen back to marking it
  right or wrong. The traps come from the generator's own `modelFor`, not a second copy, so
  the two cannot drift apart.
- Nonsense is refused while they build it, not after they press send: giving away more than
  you had, sharing 7 between 2, comparing two equal piles. A child told "no" at the end just
  stops making puzzles.

What else shipped:

- **Sharing, both ways round.** An app-made puzzle packs into 56 characters because a
  generated id already *is* the problem. No database row, no account on either side, and a
  friend who has never opened MathQuest can play it.
- **Hearts.** A liked puzzle comes back as a one-tap *send this one*, which is "I did one I
  liked and sent it on" without making them find it again.
- **Friends** are the children who actually sent you something. A name appears because a
  link arrived, and it can be forgotten in one tap. No graph, no requests, nothing to
  moderate. The only free-text field left anywhere in sharing is the sender's own player
  name, which a parent typed; it is stripped to letters so a name cannot become a sentence.
- **A shared puzzle claims no level** — no stars, no *"1 more → ★"* over someone's home-made
  problem, and no minting stars by sending yourself `1 + 1`.
- **Three tabs at the top**, not cards down the page. Puzzles & friends and the grown-ups
  page were under a full-height star map, which is the same as not existing.
- **Sync follows the child, not the device.** Progress already uploaded on every save when a
  parent is signed in; it now also flushes when the tab goes away (`keepalive`, so the last
  few answers are not killed mid-flight) and pulls when it comes back.

## To do

- [x] ~~**Switch the AI layer on**~~ — live on Gemini. Word help and the starting nudges are
      story-specific now; `/api/say` carries the transcript so follow-ups are followed up.
- [x] ~~**Run `npm run leaktest` against the live provider**~~ — 15/15 clean, 22 replies, no
      leaks and nothing evasive. Re-run it after ANY change to `SAY_SYSTEM`.
- [x] ~~**Word help should explain RELATIONSHIPS, not nouns**~~ — live answer is now "a pack is
      a bigger box or wrapper that holds 6 smaller juice boxes together". The OFFLINE dictionary
      still gives one generic line per object; worth improving if the app must work with no key.
- [x] ~~**Hand-written problems were served at the wrong difficulty.**~~ The eight
      signature problems carry no band, and `buildQueue` put them in front of whatever
      level the child opened — so "Up to 10" opened with 7 + 8 = 15, and the same problem
      appeared again in "Up to 20". `bandOfProblem()` now files each one by its own
      numbers (or, for two-step, by the shape of its equation) and it is only served
      there. Two generated bands overlapped the ones below them, which meant "which band
      is this in" had two right answers; `mbig` and `dbig` are now disjoint from the
      tables bands. `npm run gentest` asserts every problem — generated and hand-written —
      sits in a band it actually fits.

- [x] ~~**Far more problems — generate them, don't hand-write them.**~~ Done:
      `public/shared/generator.js`. Ten story templates per world, four to six difficulty
      bands each, and a seeded RNG, so the supply is effectively endless. A generated
      problem's id *is* the problem (`g~mult-groups~m10~4~k3f`) and rebuilds it exactly —
      which is what will let a shared link carry a problem later without a database.
      Traps are derived from the SHAPE of a problem rather than authored per story, so a new
      template inherits the whole diagnosis layer for free. `npm run gentest` checks 5,280 of
      them against every invariant that matters.

- [x] ~~**A map that branches.**~~ Done, as ONE winding road rather than a second screen.
      The journey is a single sequence you travel: the Twin Moons planet, then its four
      difficulty levels, then the Comet Trail planet, then its four, on to the two-step
      puzzles — 5 planets and 22 levels, 27 stops. It snakes, four to a row on a wide
      screen and two on a phone, alternate rows running back the other way.
      Two earlier attempts are recorded so they are not repeated: a dependency GRAPH of the
      five worlds (wrong — it hid the levels behind a second screen), then a hub column
      with rows of level cards (wrong — evenly spaced cards read as a TABLE, not a
      journey). The fix for the second was to push the stops off the grid: they zigzag
      vertically and wander sideways by an amount derived from each stop's index, so the
      road winds but is identical on every render. `roadtest.py` asserts that no two stops
      overlap and that every stop sits on the drawn road.

- [x] ~~**Let the child WRITE problems, and swap them with friends.**~~ Done, as
      fill-in-the-blanks rather than free writing — see *Shipped on 8 Sept* for the decision
      and why the free-prose version was deleted. The tester's own request. What was kept
      from the original notes: the problem a child builds is the same object as every other
      problem (`[[value|meaning]]` text plus `correct` plus `traps`), the trap table is
      generated so the author's puzzle can diagnose its solver, and sharing needs no backend
      at all. What changed: Pip does not help author free text, because there is no free text.

- [x] ~~**Levels and stars are not self-explanatory to a child.**~~ Done, by deleting one of
      the two currencies. The XP bar and level number are gone from the UI — a seven-year-old
      could not say what they were for, and two progress systems on one screen is one too
      many. XP is still recorded for the grown-ups view. What is left:
      - A star is earned at a NAMED PLACE — this planet, this difficulty level — so what
        earned it is visible rather than abstract.
      - Every level says what the next star costs, in words, as remaining work: *"2 more
        (1 on the first try) → ★★"*. `test/progress.mjs` checks that promise is exactly
        what the rules charge — no more, no less.
      - Every locked thing says what would open it: *"Get 2 more stars on Up to 10"*,
        *"Needs Comet Trail and Ring Belt first"*.
      - The "Level up!" popup now celebrates the two things a child can point at: a level
        mastered, and a new planet opening.

- [ ] **A learner profile that outlives one browser.** Progress is `localStorage` today, so a
      child is a different person on every device and nothing survives a cleared cache. This is
      the single dependency under both items below, and partly under sharing too. Decide the
      storage and the identity model once, here.
      PRIVACY, decide before writing any of it: this is a child's learning record. Store
      misconception patterns and summarised traces — not raw text the child typed, and not
      anything identifying beyond a name they choose. Say plainly in the parent view what is
      kept. A tutoring company's engineers will look for exactly this.

- [ ] **Parent mode — what the child has learnt, and how they think.** Review progression,
      summarise what has been mastered, and surface the thinking styles observed. Notes:
      - Most of the raw material ALREADY EXISTS: misconception counts, first-try rates and
        per-concept stats are all being collected. This is largely surfacing what is known,
        not new instrumentation.
      - What is NOT kept is the reasoning trace itself — every tap, hesitation and revision is
        thrown away at the end of a problem. Style observations ("guesses fast then corrects",
        "always re-reads the last sentence") need those traces summarised and persisted.
      - It can ship BEFORE accounts: a single-device parent view can read what is in
        `localStorage` today and needs no backend at all.
      - Gate it behind something a 7-year-old will not bother with, and keep it honest — it
        should say what the app does NOT know as well as what it does.

- [ ] **Memory and personalisation on the child's progression and style.** Adapt what is served
      and how Pip talks based on the profile above — which misconceptions recur, whether they
      rush or stall, which representations land. Sequenced last deliberately: its value is
      longitudinal and therefore INVISIBLE in a three-minute demo video. Strong product bet,
      weak hackathon bet.

- [ ] **Better voice.** Speech is currently the browser's Web Speech API reading through the OS's
      system voices, which sound synthetic — macOS ships compact voices by default and Apple does
      not expose the Siri voices to web pages. Three options, cheapest first:
      1. Free, no code: download a Premium/Enhanced English voice in
         *System Settings → Accessibility → Spoken Content → Manage Voices*, and rank it first in
         `speech.js`. Big improvement, still synthetic.
      2. Chunk long text by sentence — also dodges Chrome's 14-second utterance bug.
      3. A real TTS API behind a server route (`/api/speak`), returning audio the page plays, with
         Web Speech as the fallback. ElevenLabs ≈ $50–100 per million characters, Google Chirp 3 HD
         ≈ $30. At demo volume this is pennies. Cache by phrase — the same stories are read often.
- [ ] **Situation diagrams for word help.** Draw the *relationship* the problem describes
      (3 baskets of 6; 15 marbles with 6 crossed out; a bar comparing 14 and 9) from the
      problem's own data — deterministic SVG, no model call, no cost per tap. Must NOT be
      shown before the child has committed to an equation: a picture of the structure gives
      away the operation, the same way the starting ladder must never name one.
- [ ] Parent view — the misconception data is all there, it needs a screen
- [ ] Fractions and geometry worlds

## Known gaps

- Voice input needs Chrome or Safari; Firefox hides the mic button and typing still works
- Word help and starting nudges work with no server at all (the dictionary ships to the browser),
  but diagnosis and generated practice need the server running — `npm start` after any change to
  `server.js`, or the app falls back to asking you to try again.

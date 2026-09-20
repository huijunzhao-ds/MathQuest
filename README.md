# MathQuest

**A maths word-problem game for K–5 that diagnoses _how_ a child is thinking, not just
whether their answer is right.**

Most maths apps mark an answer wrong and move on. A child who writes `3 + 3` for *two
plates with three cookies on each* has modelled the problem **correctly** and simply
hasn't met multiplication's notation yet — that is the moment the idea is teachable, and
it is the moment most software calls a mistake. MathQuest is built around catching moments
like that.

**▶ Play it:** <https://mathquest-czoy.onrender.com>
**What it does, in one page:** (also the submission doc for a [hackathon](https://hackathon.nerdy.com/)) [SUBMISSION.md](SUBMISSION.md)

Built with my seven-year-old, who play-tested every level, asked for about half the
features.

---

## The problem

Word problems are where children who are fine at arithmetic start to fail, and the
reasons are rarely arithmetic:

- **The reading comes first.** "Altogether", "each" and "equally" are not vocabulary
  trouble; they are traps that push a child toward the wrong operation.
- **"Wrong" teaches nothing.** A cross tells a child the outcome and nothing about the
  thinking that produced it.
- **Every problem is about someone else.** Practice is something done *to* a child.
- **A parent sees a score, never the thinking**, and has no idea what to say at dinner.

---

## What it does

### A road worth travelling
Progress runs along one winding road: planets for the four operations and two-step
problems, with levels branching off each for number scale. A **star is earned only by
solving on the first try with no help**, so three stars means a child owns that level
rather than got through it. Every level says in words what the next star costs, and every
locked one says what would open it.

### Built for how young children actually read
The barrier is usually the reading, so a child can meet a problem however they need to:

- **Tap any word** for a kid-level explanation. Maths words come with a warning about what
  they *tempt you into* — the vocabulary help and the diagnosis point at the same traps.
- **Have the story read aloud**, slower than a normal reading voice.
- **Every number is labelled** with what it counts.
- **Speak instead of typing.** A seven-year-old thinks faster than they type.

### Pip, who asks instead of tells
Inspired by Socratic questioning and Pólya's problem-solving heuristics, the tutor never
hands over the answer.

A child builds the **equation** by tapping numbers in the story, not by typing a result —
so what is being assessed is the model of the situation, which is where word problems
actually break. When the equation is wrong it is matched against the wrong equations a
child plausibly builds *for that specific problem*, each mapped to a named misconception:

| what the child did | what it reveals |
|---|---|
| added when the story called for grouping | the situation was read as a total, not as repeated groups |
| followed a keyword instead of the situation | "altogether" was taken as an instruction |
| reversed the operands | the roles of the two quantities were swapped |
| stopped halfway | a two-step problem was treated as one step |
| used a number the story never gave | a quantity was invented to make the sum work |

Pip then asks a question about the choice the child **actually made**, then offers a hint,
then an explanation. Never the answer — and there is a test suite whose entire job is
trying to talk him into giving it.

**When asking stops working, Pip stops asking.** Two wrong tries, or a mistake he cannot
name, and the story is drawn instead — built from the problem's own numbers, stopping
before the total so the counting is still the child's.

Three new problems are then generated that keep the same wrong move tempting. Clearing all
three retires that misconception.

### Different children, different routes
- **Skip ahead.** Any locked level can be challenged; two correct first tries and it is
  yours, along with everything below it.
- **Or step back.** Pip offers the level below when he can see a child struggling, and says
  what kind of trouble it is. The way down is as visible as the way up.
- **"Picture it for me"** on demand, not only after a mistake. The same equation is drawn
  differently depending on the story, because *giving some away* and *comparing two
  amounts* are different situations that children confuse precisely because the arithmetic
  is identical.

### Made with friends, not against them
Friends are added by an **eight-character code** — no directory, nobody searchable, and
both children have to agree. Then they can see how each other is getting on: **listed,
never ranked**. After solving something: *"Nia and Theo have done this one too"* — never
who was first, never who was fastest, never who has not.

And a child can **make their own puzzle by saying it out loud**. Pip asks for whatever is
missing, one question at a time, and **never invents a number**, so the puzzle they send is
the one they made up. Composing a word problem demands a firmer grasp of its structure than
solving one does — and it turns practice into something social.

### Parent mode
Four numbers: problems solved, stars, first-try rate, and **how often their child answered
Pip's question rather than reaching past it for the hint** — the number this whole design
rests on. Then: which ideas are still tricky, **why each one makes sense to the child**,
and **the question worth asking at the kitchen table tonight**.

Nothing is claimed on fewer than six problems, every observation shows the evidence it
rests on, and **no words a child typed ever reach a parent's screen**.

---

## Run it

```bash
git clone https://github.com/huijunzhao-ds/MathQuest.git
cd MathQuest
npm start                 # → http://localhost:5173
```

Node 20 or newer. **No dependencies, no install step, no build.** `npm install` is a no-op
— the whole thing is the standard library plus browser ES modules, which is why there is no
lockfile and nothing to audit.

**It works fully with no configuration at all.** Every puzzle, the diagnosis, the Socratic
questions, the hints, the pictures, generated practice, the map and the progression all run
on built-in engines. Everything below is optional and adds to that floor rather than
switching it on.

```bash
npm test                  # 12 suites: 5,280 problems, the pictures, progression, routes, speech
```

### Optional · the live AI tutor

```bash
cp .env.example .env      # put ONE provider key in it
npm start                 # the banner says which provider it picked
```

Three providers, auto-detected from whichever key is present — **Gemini**, **Anthropic** or
**OpenAI**. `AI_PROVIDER` forces one when several exist. With a key, the model writes Pip's
wording and the practice problems. Correct answers and arithmetic slips never reach it: the
rule engine is certain about those, so they are answered instantly and for free.

`npm run leaktest` needs a live key. It makes ~22 real calls and fails both if Pip leaks the
answer **and** if he is merely evasive — a tutor who refuses everything must not pass.

### Optional · parent accounts and friends

Without this, players are kept in the browser and parent mode says so. With it, a parent
signs in and their children's progress follows them to any device.

1. Create a project at [supabase.com](https://supabase.com), open the SQL editor, and paste
   in the whole of **[`sql/setup.sql`](sql/setup.sql)**. That one script is the entire
   database: the `child` table, the row-level-security policy that protects it, friend
   codes, the `friendship` table, and the functions friends and parents see each other
   through. It is safe to re-run — every statement creates what is missing and leaves what
   is there alone. The last thing it prints is a list of checks; every row should say
   `true`.
2. **Authentication → Providers → Email → turn "Confirm email" OFF.** Left on, every new
   parent needs a confirmation email, and Supabase's built-in sender allows two an hour.
3. Put the project URL and the **anon** key in `.env`. Both are public values. There is
   deliberately no `service_role` key: every call carries the signed-in parent's own token,
   so Postgres row-level security decides what they can reach.

[`sql/check.sql`](sql/check.sql) is read-only diagnostics for when the database refuses
something — one row per thing worth knowing, all of which should read `true`.

---

## How it is built

**The rule engine is the floor; the model is the ceiling.** Misconceptions are derived from
the *structure* of a generated problem rather than authored per story, so most diagnoses
need no model call at all, a new story template inherits the whole diagnosis layer for
free, and a rate limit degrades Pip's wording rather than the app's function.

**Problems are deterministic and seeded.** A generated problem's id fully encodes it
(`g~mult-groups~m10~4~abc0`), so it can be rebuilt exactly — which is why a shared puzzle
needs no database row at all. Shared links are HMAC-signed, so a hand-edited one fails the
check rather than putting arbitrary text on another child's screen.

**Children's data sits behind row-level security with no service-role key.** Friends see
each other only through `SECURITY DEFINER` functions that return a fixed, narrow column
set and verify the caller owns the child they claim — the `child` table's own policy is
never widened.

**Twelve test suites**, including property tests that walk every world × level × template
forty seeds deep looking for dead ends, unreachable levels and undrawable problems; a leak
test for the tutor; and a route test that starts the real server and calls every path the
client mentions.

Plain JavaScript, no build step. Deployed on [Render](https://render.com), database on
[Supabase](https://supabase.com). Render's free tier sleeps after fifteen idle minutes, so
`.github/workflows/keep-warm.yml` pings it often enough to keep the demo link instant.

### Repo map

| path | what it is |
|---|---|
| `server.js` | Static server, the API, every prompt, and the provider adapters |
| `public/app.js` | Road, story, equation builder, reasoning trace, Pip, progression |
| `public/shared/generator.js` | Story templates, difficulty bands, seeded RNG, structural traps |
| `public/shared/engine.js` | Expression parser, misconception catalogue, rule-based diagnosis |
| `public/shared/insight.js` | What one finished problem leaves behind for parent mode |
| `public/mathviz.js` | The arithmetic pictures — drawn, never model-generated |
| `sql/setup.sql` | The whole database, re-runnable |
| `test/` | Twelve suites; `npm test` runs all but the leak test |
| `.github/workflows/keep-warm.yml` | Pings the demo so the free tier never sleeps |

---

## What's next

1. **A better voice**, so Pip sounds like someone a child wants to talk to.
2. **Personalisation** — remembering a child's progress and working style, and recommending
   problems from that profile rather than from the level alone.
3. **Fractions, geometry and harder topics**, past the four operations.
4. **Parent-approved friendships.** Today a friendship is live once both children agree and
   a parent can undo it afterwards: review, not approval. That is the right call for a
   private demo and the wrong one for a public launch with other people's children.

## Known gaps

- Voice input needs Chrome or Safari. Firefox hides the mic button; typing still works.
- Word help and the starting ladder work with no server at all — the dictionary ships to
  the browser — but diagnosis and generated practice need the server running.
- "Since you last looked" in parent mode is remembered per device, so checking on a laptop
  does not clear the badge on a phone.
- Two-step stories cannot be drawn. There is no single honest picture of a two-step story,
  and drawing half of one would mislead.

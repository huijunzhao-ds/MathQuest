# Hackathon submission

Submitted to the [Nerdy AI hackathon](https://hackathon.nerdy.com/), K–5 Math Game prompt,
on 18 September 2026. This is the answer to *"What did you build? What it does, how you
built it, what you'd do next."*, kept as submitted.

The demo video is linked from the [README](README.md).

---

MathQuest is a gamified learning tool for K–5 maths word problems, built around diagnosing
how a child thinks rather than just whether their answer is correct.

## What it does

**The game.** Progress runs along a winding road with planets for arithmetics and levels
for number scales. A star is earned by solving on the first try with no help, so three
stars means a child genuinely owns that level rather than got through it. Every level tells
what the next star costs, and every locked one says what would open it.

**Built for young children.** Word problems can be hard for both the maths and the reading,
so a child can meet the problem however they need to: any word can be tapped for a kid-level
explanation, the story can be read aloud at a slower pace, and every number is labelled with
what it counts. Children can also speak to Pip, the AI tutor, instead of typing.

**Inspired by heuristic learning theory** — Socratic questioning and Pólya's problem-solving
heuristics — Pip never hands over answers. A child builds the equation by tapping numbers in
the story, so they know where each number comes from. When the equation is wrong, the
mistake gets mapped to a named misconception: added when the story called for grouping,
followed a keyword instead of the situation, reversed the operands, stopped halfway, used a
number the story never gave. Pip then asks a question about the choice the child actually
made, then offers a hint, then an explanation. Never directly the answer. A child who
answers 3 + 3 for two plates of three cookies has modelled the problem correctly and simply
hasn't met the notation yet — MathQuest treats that as the moment multiplication becomes
teachable, not as an error. Three new problems are then generated that keep the same wrong
move tempting; clearing all three retires that misconception.

**We also considered that children learn differently.** A child who is already ahead can
challenge any locked level and take it with two correct first tries, and Pip offers the
level below when he can see a child struggling. "Picture it for me" draws the story from its
own numbers and stops before the total, so the counting is still theirs; the same equation
is drawn differently depending on the story, because "giving some away" and "comparing two
amounts" are situations children confuse precisely because the arithmetic is identical. For
children who would rather learn with friends than alone, friends are added by an
eight-character code rather than a user ID, so nobody can be searched for; when both agree,
they can see how each other is getting on. To encourage creativity, a child can make their
own puzzle by saying it out loud: Pip asks for whatever is missing, one question at a time,
and never invents a number, so the puzzle they send is the one they made up. Composing a
word problem demands a firmer grasp of its structure than solving one does — and it turns
practice into something social, a shared experience children actually want to be part of.

**Last but not least, parent mode.** Parents see four numbers — problems solved, stars,
first-try rate, and how often their child answered Pip's question rather than reaching past
it for the hint, which is the number this whole design rests on. Below that: which ideas are
still tricky, why each one makes sense to the child, and the question worth asking at the
kitchen table tonight; and how they work across problems — whether they read before touching
anything, whether they rebuild the equation before committing, which words they look up.
Nothing is claimed on fewer than six problems. No words a child typed ever reach a parent's
screen.

## How we built it

The most important thing we want to share is who it was built with: my seven-year-old son.
He play-tested every level, asked for a good half of the features, and found the bug where a
puzzle said a child read 667 pages on a Monday. The whole "say your own puzzle" feature
exists because he made one up over ice cream — two boxes, four in each, he ate two — and
couldn't wait to send it to his friends. So the product has had at least one real, honest,
unimpressed user from day one.

Technically it's plain JavaScript with no build step, using Gemini for the tutoring
conversation, Supabase for accounts and progress, deployed on Render, source on GitHub. One
design principle worth naming is that the rule engine is the floor and the LLM is the
ceiling: misconceptions are derived from the structure of a generated problem rather than
written per story, so most diagnoses need no model call and features still work when the LLM
is unavailable.

## What's next

1. A better voice, so Pip sounds like someone a child wants to talk to.
2. Personalization: remembering a child's style, and recommending puzzles accordingly.
3. Fractions, geometry and harder topics.

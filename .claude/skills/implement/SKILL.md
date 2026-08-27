---
name: implement
description: "Executes an approved plan from plans/ end to end — dispatches the implementer, exercises the feature through its real entry point, verifies it against the plan, reviews it for bugs and for boundaries, and runs a bounded fix loop over what the reviews returned. Use when the user runs /implement, when they hand over a plan path and ask to build it, or when they ask to carry out or execute a plan that already exists. It never authors a spec or a plan — spec-creator and implementation-planner are dispatched by hand before it. It does not dispatch test-writer, and it never commits or pushes."
metadata:
  version: "1.0.0"
  tags: pipeline, orchestration, plan-execution, spec-driven, subagents, fix-rounds
---

# implement — an approved plan, carried out end to end

```
/implement plans/NN-topic.md [P1]
```

The plan path, plus a work-package id when the plan's `**Execution:**` is `multi-agent` and only
that package is wanted. Nothing else is an argument.

You are the orchestrator. You dispatch, you carry the thread between stages, and you stop where
this file says stop. Every agent starts with a **clean context window** and knows only what the
previous stage left on disk — that is why the plan is a file, and why a fix round gets one too.

## Navigation

| Read | For |
|---|---|
| **This file** | When it runs, the six stages, the boundary with the sibling skills, what is deliberately absent |
| [fix-rounds.md](fix-rounds.md) | What to do with what the reviews returned: the three triage filters, the brief format, and why the cap is two |

## 1. When it runs, and when it must not

Run when: the user types `/implement`; they hand over a path under `plans/` and ask for it to be
built; they ask to execute or carry out a plan that already exists.

**The spec and the plan are not this skill's business.** `spec-creator` and
`implementation-planner` are dispatched by hand, so that a human sees the requirements and then
the plan before any code exists. By the time you run, both decisions are made.

Stop before stage 1, having dispatched nothing, when:

- no plan path was given, or it does not resolve. Ask for one; never plan the work yourself;
- the plan still carries an **unanswered entry under** `## Open questions`, or
  `## Requirements as understood` rows whose `Status` is `assumed` and which nobody confirmed. That
  is a planning problem, and building on it is how a whole feature is thrown away. The heading
  itself is always present — `implementation-planner`'s template mandates it — so read the body:
  `_None._` is the passing value, and refusing on the heading alone would refuse every plan;
- `.branch` is `main`. Branch first, or `pr-self-review` refuses at the end and the run has
  nowhere to land.

Do **not** run this to make a one-file change, a rename, or a fix. The routing table in
`.claude/agents/README.md` says what those get instead, and a stage a change does not need makes
that change worse, not safer.

## 2. Stage 0 — preflight

1. **Read the plan's header, `## Out of scope` and `## Verification`** — not the steps. You need
   the boundary and what success looks like; the steps belong to the implementer, which reads
   them in its own context.
2. **`rg` the nouns of the plan.** This repo carries scaffolding for lessons that have not
   landed — tables that migrate but stay empty, contracts nobody constructs, registry entries
   with zero callers. One grep separates "how would this work" from the far cheaper "what is
   already wired". **Paste the output** into every agent you dispatch — the matched lines, not
   your summary of them — so none of them pays to rediscover it. Measured on Export to CI:
   the brief that pasted its evidence bought its first write after 4 scout calls; the brief
   that described the same class of thing took 39.
3. **Check the ports.** 3000 and 3001 are frequently another worktree's dev servers, and an
   agent that assumes otherwise gets someone else's page or an `EADDRINUSE` on a hard-coded
   port — two agents lost turns to exactly that. `lsof -i :3000 -i :3001`, then put one line in
   every dispatch: *"3001 is another checkout — bring your own API up on 3002."*

## 3. Stage 1 — build

`single-agent`: one `implementer`, the plan path as its input.

`multi-agent`: one `implementer` per work package, in the dispatch order the plan's work-packages
section closes with. Packages that neither block the other go in **one message**, so they actually
run concurrently. Give each agent its package id and nothing else — its own `### PN` block carries
the contract it may assume, and the planner repeated it there precisely so no agent has to read
another's steps.

**At most two `judgement` packages in flight.** Three heavy implementers at once is what hit the
session limit on Export to CI: the kill cost 89M in restarts against 52M of work done, and
recovering from it plus repairing what it produced came to **45 % of the whole run's tokens
against 26 % for building the feature**. Two concurrent is slower in wall-clock and strictly
cheaper than three plus three restarts. Dispatch a package the plan marks `mechanical` at a lower
tier — a constant plus a guard does not need the top one.

**A spec being amended is not a spec to build against.** If `spec-creator` is still writing, wait
for it. Four minutes of overlap on this branch let an implementer read criteria that were rewritten
underneath it, and the criterion it missed had to be added by the next agent.

### If an agent is killed mid-package

Its work is on disk and its context is gone. Do **not** hand-write a survey of the tree and label
it "a guide, not the truth" — the successor then re-verifies every line of it, and you have paid
twice. The restart brief is:

- the killed agent's `.reviews/<branch>/progress-<PN>.md`, quoted;
- pasted `git status --short`, `ls` of the new directories, and the `grep -n` that shows the state
  you are claiming — output, not prose;
- **two timestamps: when that state was captured, and what you know has happened since.** A paste
  is true when taken; two of five items in this branch's resume brief had already been fixed by
  someone else;
- whether the list of remaining work is exhaustive or only what is known.

## 4. Stage 2 — run it

**Exercise the feature through its real entry point.** A `curl` at `:3001`, the page in a browser,
the CLI command. Gates prove the code compiles and the fakes returned their fixtures; they prove
nothing about a real provider, a real database or a real browser, and that is exactly where the
defects that survive review live.

A defect caught here costs one command. The same defect caught after review costs a re-plan,
another implementer, and makes the review itself moot — it graded a feature that never ran. If
nothing is running and you cannot start it, say so plainly rather than letting green gates imply
the feature was seen to work.

## 5. Stage 3 — verify against the plan

Dispatch `plan-verifier` with the plan path.

In `multi-agent`, dispatch it **per package as that package lands**, not once at the end: a
package's `## Contract` block is what every later package was told it may assume, so verifying it
late turns one package's divergence into three packages of rework. When the packages are genuinely
independent and consume nothing from each other, one run at the end is enough — say which you
chose and why.

`NOT_MET` and `PARTIAL` rows **skip the triage in [fix-rounds.md](fix-rounds.md) entirely**: the
plan asked for them, so they are unfinished work rather than findings to weigh.

## 6. Stage 4 — review

Two reviews, both read-only, dispatched together in one message:

| Dispatch | For | Note |
|---|---|---|
| **`/code-review`** | the logic — bugs, correctness, efficiency | Use `high` on a feature |
| **`architecture-reviewer`** | the boundaries, given the diff or the modules touched | Runs on `sonnet` |

**Nothing else here hunts bugs**, and that is more true than it used to be: `architecture-reviewer`
routes correctness and performance away by its own § *Subject*, `pr-self-review` says of itself
that it does not, and `test-writer` is not in this pipeline at all. Leave `/code-review` out and a
logic error passes every stage with a clean report at each one.

Read `architecture-reviewer`'s `critical` and `major` as *"look at this"* rather than as a grade.
That axis was the least reproducible thing it produced even on `opus` — the same finding scored
`major` on one run and `minor` on the next — which is why nothing is allowed to threshold on it.

## 7. Stage 5 — the fix rounds

**[fix-rounds.md](fix-rounds.md)** carries this whole stage: where the brief goes and why that
directory is gitignored, the three triage filters in the order they apply, what the brief holds,
and why there are at most two rounds. Read it before acting on a single finding.

The one thing worth knowing without opening it: **an empty fix round is the ordinary outcome** on
a careful diff, not a review that failed.

## 8. Stage 6 — close

`doc-writer`, only when something shipped that a reader will need — it documents mechanisms, not
every change.

Then run the `engineering-insights` skill for the session as a whole. Each agent recorded its own;
what is left is what only you saw, crossing the stages.

Finally `pr-self-review`: `--gates` is seconds and is enough for a push, a PR needs `--full`.

## 9. Boundary with the sibling skills

Split by **what happens after the output**, not by what is inspected.

| Run | Answers | Blocks? |
|---|---|---|
| **`implement`** (this) | Does the repo now match a plan that was approved? | no — it orchestrates; it issues no verdict |
| `pr-self-review` | Does the branch obey this repo's conventions and gates? | **yes** — `git push` and `gh pr create` |
| `/code-review` | Is the logic right? Does this code have bugs? | no |
| `engineering-insights` | What did this session learn that the next one should not rediscover? | no |

This skill **dispatches** the first three of those; it replaces none of them.

## 10. Never

- **Never write or edit the plan**, and never write a spec. Both are records by the time you run.
  `plans/README.md` and `specs/README.md` each forbid rewriting one to match what was built; a
  divergence is a line in your report.
- **Never run more than two fix rounds**, and never start a third because the second returned
  something new.
- **Never fix a `pre-existing` finding inside a round.**
- **Never dispatch `test-writer`** — see §11. If it is ever put back, it runs **alone**: its
  *prove the test can fail* rule leaves a deliberate defect in the tree between mutating a file
  and reverting it, and any sibling that reads those files or shells out to a gate measures the
  mutation rather than the branch.
- **Never commit or push.** Ending a run with a commit nobody asked for makes a stage's output
  irreversible before it has been read.

## 11. What is deliberately not here

**`test-writer`.** The tests a plan asks for are the implementer's — it ships them beside the code,
and `## Tests` is a section of the plan it executes. What is lost is only *gap coverage*: code that
shipped without a test and that nobody has since asked to cover. That gap is real and it grows
quietly, so dispatch `test-writer` by hand when a module has drifted — and never beside anything
else.

**`spec-creator` and `implementation-planner`.** Dispatched by hand, before this skill runs.

**The model tiers are a cost decision, not a ranking.** `architecture-reviewer` and `doc-writer`
run on `sonnet` because their output is advisory — a human reads every row and decides.
`implementer` and `plan-verifier` stay on `opus` because their failures are silent: code that
compiles and is wrong, and a `MET` row for something that never happened.

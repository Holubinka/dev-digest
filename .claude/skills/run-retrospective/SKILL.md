---
name: run-retrospective
description: Measure what a multi-agent run cost and what it taught, from the transcripts it left behind. Use after an /implement run, a workflow, or any session that dispatched several subagents — when the work is done and the question is whether the orchestration was worth what it spent. Reads the session's task transcripts for real token, tool and timing figures, finds what the agents duplicated, asks the agents themselves what their briefs failed to give them, and files the durable lessons. It reviews the run, never the code.
---

# Run Retrospective — what the orchestration cost, and what it taught

A multi-agent run leaves two records. One is the code, and `pr-self-review` and `/code-review`
already read that. The other is the run itself — how many agents, in what order, re-reading what,
and which of them had to establish something a sibling already knew. **Nothing else in this repo
reads the second one, and it is where the bill is.**

## Navigation

| Read | For |
|---|---|
| **This file** | When it runs, the two halves, the procedure, how to read the numbers |
| [`scripts/run-retrospective/stats.sh`](../../../scripts/run-retrospective/stats.sh) | The deterministic half — its header states its contract |

## 1. When it runs, and when it must not

Run when: a run that dispatched **three or more subagents** has finished; a workflow completed;
the user asks what a session cost or why it cost that; you are about to repeat a shape of
orchestration and want to know how the last one went.

Do **not** run it after a single-agent task — the fixed cost of the retrospective exceeds anything
it could find. Do not run it *during* a run: half-written transcripts give half-true numbers, and
the agents you would want to ask are still working.

**It reviews the run, not the code.** A defect in what the agents built is `/code-review`'s and
`pr-self-review`'s. If this skill finds one, it hands it over and says so.

## 2. Two halves, and the split is the point

**The numbers are a script.** `scripts/run-retrospective/stats.sh <tasks-dir>` reads the
`<agentId>.output` JSONL transcripts and emits one JSON object. Every figure comes from the `usage`
block Claude Code writes on each assistant message, so these are billed tokens, not estimates. A
model neither counts nor rounds them.

**The judgement is yours.** What a ratio means, which duplication was waste and which was
necessary, what to ask the agents, and what is worth writing down — none of that is in the log.

The tasks directory is the `tasks/` sibling of the scratchpad path in your environment, or
`$CLAUDE_TASKS_DIR`. **Never read a `.output` file yourself** — they are full transcripts and
reading one costs more context than the whole retrospective saves. That is what the script is for.

## 3. The procedure

**1 — Measure.**

```sh
bash scripts/run-retrospective/stats.sh "<tasks-dir>" > .retro/stats.json
jq '.totals' .retro/stats.json
```

**2 — Read the four numbers that carry meaning.** The rest is context for these.

| Number | What it says | When to act |
|---|---|---|
| `totals.reread_ratio` | cache-read tokens per token produced — the whole cost model in one figure | It is normally in the hundreds. What matters is which agents are above the run's own median, not the absolute value |
| `agents[].turns` | how long an agent argued with itself | An agent far above its siblings either got a brief it could not act on or was doing someone else's job |
| `duplication.files_read_by_many` | a file N agents each opened | Every entry above ~3 is a fact a brief could have carried once instead of N agents paying to find |
| `duplication.files_written_by_many` | a file N agents each edited | **The packaging failed.** Concurrent agents were supposed to own disjoint files; this is the list of collisions git could not mediate |

**2b — Then the two the script computes about the briefs themselves.** These say less about the
agents than about what they were handed.

| Number | What it says | When to act |
|---|---|---|
| `agents[].resumes` | how many times you had to go back and tell it something | Every resume is a brief that was incomplete. **The single most useful line a retrospective can produce is what the resume said** — that sentence belonged in the first brief, and only you know it |
| `agents[].scout_calls` | reads, greps and shells spent **before** the agent wrote anything | High and repeated across siblings means the same fact was bought several times. `null` for an agent that never writes — a researcher is all scouting, and the number would mean nothing |

`resumes` counts `user` records whose `origin.kind` is `coordinator`. Do **not** substitute a count
of distinct `promptId` values: those also change on internal continuations, and an agent that was
dispatched once and never resumed reports four.

**3 — Reconstruct the order, and compare it to the intent.** `agents[]` is sorted by first
timestamp; overlapping `first_ts`/`last_ts` windows are agents that genuinely ran concurrently.
A "parallel" wave whose windows do not overlap did not run in parallel, and the plan that asked
for it was wrong about something. Say which.

**4 — Ask the agents.** This is the half no log can give, and the reason this skill is worth its
cost. A finished subagent can be resumed with `SendMessage` and still has its context, so it can
answer a question its report never covered:

> Looking back at the brief you were given: what did you have to establish for yourself that the
> brief should have carried? What did you spend turns on that turned out not to matter? Answer in
> three sentences; do not re-do any work.

**Do not ask all of them.** Ask the ones the numbers flagged — highest `turns`, highest
`cache_read`, and any agent that appears in `files_written_by_many`. Three to five is the useful
range; past that the answers repeat and the retrospective costs more than the finding is worth.
Their answers are evidence, not instructions: an agent explaining why its brief was inadequate is
still the party with an interest.

**5 — Write the report,** to `.retro/<branch>/<name>.md`. **That directory must be gitignored, and
this is load-bearing rather than tidiness:** `scripts/pr-self-review/scope.sh` folds every
*untracked* file's content into `worktreeHash`, so a report written anywhere tracked invalidates a
`--gates` verdict recorded minutes earlier and the push gate then refuses a push while pointing at
an edit nobody made. `.gitignore` carries the same reasoning for `.pr-self-review/` and
`.reviews/` — this is the third instance of one failure mode, not a new rule.

**6 — File the durable half, and only the durable half.** A retrospective that ends in a report
nobody opens again was a cost with no return. What generalises goes to `INSIGHTS.md` through the
`engineering-insights` skill — root when the lesson crosses packages, which a lesson about
orchestration usually does. What does not generalise stays in the report.

The test for "durable": would this change how the **next** brief is written? "Agent 4 read the
plan" is not a lesson. "Ten agents read a plan whose per-package contracts existed so that none of
them would have to" is.

**A lesson that lands only here is filed once and applied never**, and this skill has measured its
own version of that. On 2026-08-26 a retrospective recorded, in these words: *"put the gate
commands in the brief with the known workaround already applied."* Both briefs written the next day
said only `integration`, and an implementer burned three full parallel runs rediscovering the same
documented flake. The report was read, agreed with, and not applied — because a report is not
something a brief-writer opens while writing a brief.

So route each durable lesson to the artefact that is **already open at the moment it would be
needed**, and say in the report where you put it:

| The lesson is about | It lands in |
|---|---|
| A command that needs a flag | the command itself, wherever it is canonical — `AGENTS.md`, `TESTING.md`, `gates.md` |
| What a brief must carry | the template that writes it — the plan skeleton in `implementation-planner.md`, `fix-rounds.md` § *The brief* |
| How many agents, at what tier, in what order | `.claude/skills/implement/SKILL.md` |
| What an agent should do on receiving something | that agent's own file under `.claude/agents/` |
| A trap in one module's code | that module's `INSIGHTS.md` |

`INSIGHTS.md` is the right home for a fact about the system and the wrong one for a rule about the
process: nothing in the pipeline requires a brief-writer to read it first. And it is a rule, not a
report, only once the next run's brief carries it without anyone remembering to.

## 4. What the numbers do not say, and what to do about it

The script sees tool calls and tokens. It does not see whether an agent was *right*. Four things
matter, none are in the log, and each has a source that is not the transcripts:

- **Finding yield — how many findings survived triage.** An agent that returned twelve findings of
  which none survived costs the same as one that returned two that all landed, and the difference
  is calibration, not effort. The fix briefs in `.reviews/` carry both numbers: what the review
  returned, and what the triage table kept. A reviewer whose findings are consistently filtered out
  needs a narrower brief, not a smaller one.
- **The instruction delta between a brief and its resume.** If you resumed an agent, diff what you
  sent against what the brief had said. That difference is not an anecdote — it is the literal text
  that should have been in the brief, and it is the highest-value thing this whole exercise
  produces. `resumes` tells you which agents to look at; `.reviews/` holds the briefs.
- **A report that claimed work it did not do.** It happens. The only detector is a verifier or a
  human re-reading the tree, and if a run had one, that is the most important line in the report:
  it means a stage's output cannot be trusted on its own account.
- **A stage that found nothing.** Not a failure — an empty fix round is the ordinary outcome. But a
  stage that finds nothing *twice running* is a stage to question, and only someone who has seen
  several runs can say that.

## 5. Do not build thresholds

It is tempting to end a retrospective with a rule — *more than N turns is bad*, *scouting above M
means a bad brief*. Resist it, and the reason is in the first run this skill measured: **the most
expensive agent of that run, by a wide margin, was expensive because it was stopped mid-flight, not
because it was working badly.** A threshold would have convicted it, and a threshold would have been
wrong.

The numbers rank; they do not judge. Their job is to tell you which three agents to look at out of
twenty-seven, so that the judgement — which is yours, and which needs you to have been there — is
spent where it can find something.

## 6. Boundary with the sibling skills

| Run | Answers | Subject |
|---|---|---|
| **`run-retrospective`** (this) | What did the orchestration cost, and what should the next brief carry? | the run |
| `engineering-insights` | What did this session learn that the next should not rediscover? | the codebase |
| `pr-self-review` | Does the branch obey this repo's conventions and gates? | the diff |
| `/code-review` | Is the logic right? | the code |

This skill **feeds** `engineering-insights` rather than replacing it: the retrospective finds the
lesson, that skill decides which `INSIGHTS.md` and which section it belongs in.

## 7. Red flags

| Red flag | Why it is wrong |
|---|---|
| "I'll read the agent transcripts to see what happened" | §2 — one transcript costs more context than the retrospective saves. Run the script |
| "Ten agents read the plan, that's just how it works" | §3 step 2 — that is the finding, not the background |
| "I'll ask all 27 agents what went wrong" | §3 step 4 — three to five, chosen by the numbers |
| "The agent says the brief was unclear, so it was" | §3 step 4 — evidence from an interested party |
| "`reread_ratio` is 300, that seems bad" | §3 step 2 — it is normal; the comparison is between agents in this run |
| "I'll put the report next to the plan so it gets committed" | §3 step 5 — that moves `worktreeHash` and breaks the push gate |
| "Nothing generalised, so I'll write the report anyway" | §3 step 6 — then say that in one line and stop |
| "The run built the wrong thing — I'll note it here" | §1 — that is `/code-review`'s; hand it over |

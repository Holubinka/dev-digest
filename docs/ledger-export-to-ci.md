# Ledger — Export to CI

What the feature cost to build, measured rather than recalled. Every figure here comes from
`scripts/run-retrospective/stats.sh` over the session's own task transcripts, or from a command
whose output is quoted beside it.

**Why this file is tracked.** The detailed retrospectives live under `.retro/`, which is
gitignored for a load-bearing reason: `scripts/pr-self-review/scope.sh` folds every untracked
file's content into `worktreeHash`, so a report sitting in the tree invalidates a `--gates`
verdict recorded minutes earlier. The consequence nobody planned for is that **the measurements
were invisible to anyone reading the repository** — a reviewer saw the feature and none of its
cost. This file is the durable half, kept short enough to stay true.

## The run

| | Phase 1 (2026-08-26) | Final (2026-08-27) |
|---|---|---|
| agents dispatched | 20 | **25** |
| turns | 2 697 | **3 398** |
| output tokens | 305 287 | **370 976** |
| cache read | 361.9 M | **446.0 M** |
| re-read ratio | 1 185 | **1 202** |

The ratio is the number that matters: **446 M read against 371 k produced.** The bill is not what
the agents wrote, it is what they re-read to write it.

### Where the 362 M of phase 1 went

| | tokens | share |
|---|---|---|
| Build — first attempts (6 agents) | 95 M | 26 % |
| Restarts after a session-limit kill (3) | 89 M | **24 %** |
| Fix rounds (2) | 77 M | 21 % |
| Spec + plan (5 agents, 3 of them re-dispatches) | 52 M | 14 % |
| Reviews (4) | 45 M | 12 % |

**Building the feature was 26 % of the bill. Recovering from an interruption and repairing what
was built came to 45 % — nearly twice as much.** Everything in
`.claude/skills/implement/SKILL.md` about capping concurrency at two heavy packages, and
everything in `.claude/agents/implementer.md` about the progress note, follows from that one row.

## What the feature is, in the same units

| | |
|---|---|
| production code | ~5 750 lines across `server/src/modules/ci/`, `agent-runner/`, and three client screens |
| tests | 12 new server files, 3 client, 7 in `agent-runner` |
| suite after the work | server 1 518 unit + 205 integration · client 1 045 · agent-runner 77 |
| acceptance criteria | 149, `specs/SPEC-05-export-to-ci.md` |

## Two measurements worth more than the totals

**Pasted evidence against described evidence — about ten times.** Two amendments of the same
specification, by the same role, hours apart. The brief that **pasted** the failing artifact and
the `"fork": true` response spent **4** scout calls before its first write and 1 M cache read; the
brief that **described** the same class of problem spent **39** and 14 M. That is the whole
argument behind the `## What already exists` rules now in
`.claude/agents/implementation-planner.md`.

**A documented workaround, omitted from a brief, cost six runs.** Writing `integration` instead of
the serial form of the integration command cost three full ~3-minute runs on one round and three
more on the next, two different agents, one day apart, both arriving at the same
`server/INSIGHTS.md` entry. This branch answered it by carrying the flag in every document that
names the command; `main` answered the same lesson better, by putting it inside a package script
(`pnpm test:it`), so no brief can omit what it never has to type. That is the version kept.
Measured separately: 79 files run serially in 18.6 s against 4.3 s in parallel — a real cost,
deliberately paid.

## What was NOT measured, and is therefore not claimed

**A parallel-versus-sequential comparison on calendar time was never run as a controlled
experiment**, so this file does not state one. What exists is an accident, not a control: three
heavy implementers ran concurrently, hit a session limit mid-package, and the recovery cost 89 M
against the 52 M of work the killed agents had produced. That says three concurrent was worse than
two on this feature; it does not measure two against one, and it holds the model, the packaging
and the day constant only by luck.

Doing it properly needs the same work package built twice, which nobody has paid for. Until then
the honest statement is the one above: the interruption, not the parallelism, is what was
measured.

## Where the detail lives

`.retro/emdash/export-to-ci-ju1ik/{export-to-ci,optimizations,second-phase}.md` — gitignored, and
present only in the worktree that produced them. The durable lessons were routed out of those
reports into the files that are open when they are needed: the root `INSIGHTS.md`, the plan
skeleton in `.claude/agents/implementation-planner.md`, `.claude/skills/implement/fix-rounds.md`,
and `.claude/skills/run-retrospective/SKILL.md`, which now carries a table saying where each kind
of lesson lands. That routing exists because of a measured failure: a lesson recorded only in a
retrospective on 2026-08-26 was not applied to either brief written the next day.

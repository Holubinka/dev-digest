# PR Self-Review Skill

The skill card: what this skill is for, what it deliberately leaves to others, where it came
from, and how it was tested.

## Contents

1. [Focus](#1-focus)
2. [File map](#2-file-map)
3. [What it covers, and what it does not](#3-what-it-covers-and-what-it-does-not)
4. [Cases it is built for](#4-cases-it-is-built-for)
5. [Related skills and commands, and who owns what](#5-related-skills-and-commands-and-who-owns-what)
6. [Sources](#6-sources)
7. [Conflicts this skill resolves](#7-conflicts-this-skill-resolves)
8. [Version and changelog](#8-version-and-changelog)
9. [How this skill was tested](#9-how-this-skill-was-tested)

## 1. Focus

Reviewing **everything a branch changed** against the knowledge this repo already owns, and
recording a verdict that a `PreToolUse` hook then refuses to push past.

It exists because the knowledge and the measurements were both already here, and nothing
scheduled them. Thirteen skills sit in `.claude/skills/` and fire on the model's own judgement —
while code is being written, if at all, never as a sweep over a finished branch. Seven CI
workflows run `pnpm arch`, `lint`, `typecheck` and the suites *after* the push, on a branch that
is already public, when the same commands take seconds locally. And the conventions that no gate
covers at all — "shareable state belongs in the URL", "a `*Row` must not leave its module", "a
module is registered by hand in `modules/index.ts`" — were prose measured by nobody.

Scope is the whole repo: every package, every file the branch touched, committed or not.

## 2. File map

| File | Lines | Answers |
|---|---|---|
| `SKILL.md` | 317 | When does it run? What is the procedure? Which mode? What must never be reported? |
| `routing.md` | 165 | Which subagent opens which skill, what to look for in the ones with no checklist, what is left out on purpose |
| `gates.md` | 181 | What is each Track A gate, what does its failure look like, what do I try first? |
| `severity.md` | 124 | Which of the four levels is this, and what does it stop? |

`SKILL.md` stays thin because it loads in full whenever the skill activates. The topic files load
only when the run needs them — a `--gates` run never opens `routing.md`.

**There is no `procedure.md` and no `report-format.md`.** The procedure is the one thing that
must be in `SKILL.md` (a run that never opens a topic file still has to be correct), and the
report format belongs to `scripts/pr-self-review/report.sh`, which renders it. Restating either
elsewhere would create a second copy that drifts.

## 3. What it covers, and what it does not

| Covered here | Not covered — go here instead |
|---|---|
| Does the branch obey this repo's conventions? | Is the logic correct? → `/code-review` |
| Do the deterministic gates pass? | Is there a vulnerability in the pending changes? → `/security-review` |
| Is a secret, a vendored copy or a pinned skill touched? | How do I write the code the finding asks for? → the skill named in the finding |
| Which severity, and does it block? | Why is this one test failing? → `superpowers:systematic-debugging` |
| Producing `.pr-self-review/latest.json` | *Enforcing* it — `scripts/pr-self-review/gate.sh` does that, and it never calls a model |
| Recording a verdict | Fixing anything. A run that edits invalidates the verdict it just wrote. |

## 4. Cases it is built for

- "`/pr-self-review`" — the whole thing, before opening a PR.
- "A push was refused and it told me to run this."
- "Is this branch ready?"
- "I fixed the two criticals" — `--only critical`, the tight loop.
- "This gate has been red since before my branch" — `--freeze`, once.

It should **not** load for: writing code, planning a feature, debugging a failing test, or
reviewing a single file that was just typed. Track A alone costs the full test suites, and the
report is about a branch, not a paragraph.

## 5. Related skills and commands, and who owns what

| Skill / command | Answers | Overlap with this skill |
|---|---|---|
| `/code-review` | Is the logic right? | none — this checks conventions, and its report says so in its own last line |
| `/security-review` | Is there a vulnerability? | the `security` domain agent overlaps deliberately; that agent is scoped to the diff and blocks, `/security-review` is broader and does not |
| `superpowers:requesting-code-review` | Generic pre-merge review | **superseded here.** Same intent, no knowledge of `pnpm arch`, the twice-vendored `shared/`, or `skills-lock.json`. Do not run both. |
| `superpowers:dispatching-parallel-agents` | How do I fan out? | used, not duplicated — it is the step-3 mechanism |
| `superpowers:verification-before-completion` | What counts as evidence? | supplies the report's evidence rule |
| `engineering-insights` | What did this session learn? | runs **after** a review, when a finding is worth recording. Never during. |
| `onion-architecture`, `frontend-architecture` | Which ring / which folder? | this skill runs their checklists; it restates none of their rules |

The full routing table, including everything deliberately left out, is in
[routing.md](routing.md).

## 6. Sources

This skill has no external literature behind it. What it encodes is this repo: its scripts, its
spec, and its recorded failures. Each row below is a thing that was read while writing, and the
specific claim taken from it.

| Source | What we take from it |
|---|---|
| `specs/03-pr-self-review-skill.md` | the whole design: two tracks, the domain table, the severity model, the verdict file as the seam, and every rejected alternative |
| `scripts/pr-self-review/scope.sh` | the four buckets and their exact JSON — `routed` / `checklist` / `skipped` / `flagged`, and that `flagged` entries carry `line: 1` |
| `scripts/pr-self-review/gates.sh` | the ten gates, the `skip` ≠ `ok` distinction, and that gate findings put the package name in `file` |
| `scripts/pr-self-review/baseline.sh` | that only `line: 0` is exempt from diff-anchoring, and that the freeze fingerprint is `{file, line, message}` |
| `scripts/pr-self-review/report.sh` | the five trustworthiness rules, and that the verdict never travels by exit code |
| `scripts/pr-self-review/gate.sh` | what the hook actually refuses, and that freshness is the load-bearing half |
| `scripts/pr-self-review/registry.sh` | the five registry checks and their severities |
| `.claude/skills/README.md` | the authoring standard: thin `SKILL.md`, one topic file per question, `name` matching the directory, no top-level `version` |
| [Agent Skills specification](https://agentskills.io/specification) | frontmatter takes `name` and `description`; free-form keys go under `metadata` |
| [Anthropic skill-authoring guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | the 500-line cap and one-level-deep file references |
| `CLAUDE.md` | the Do-not-touch list that Tier 1 and Tier 2 mirror, and the pnpm/npm split |
| `INSIGHTS.md` (root) | that reviews in this repo legitimately return nothing — the evidence behind the empty-report rule |
| `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md` | what each domain subagent is required to read before it reviews |

## 7. Conflicts this skill resolves

**A repo skill overrules an upstream one.** `drizzle-orm-patterns` shows queries beside handlers;
`onion-architecture` §3.2 forbids it. Both load for the same file in the same subagent. Ours
wins, and the upstream rule is **not reported at all** — not as a minor, not "for completeness".
`SKILL.md` §5 is the only place this is written down, on purpose.

**Upstream severity labels are not this scale.** `react-best-practices`, `zod` and `security`
each ship their own CRITICAL / HIGH / MEDIUM ranking of how important a rule is in general. This
scale ranks what a finding *stops in this repo today*. Everything maps through
[severity.md](severity.md) before it reaches a report.

**A Track A critical and a Track B critical are not the same thing.** The first is a command's
exit code and blocks a push. The second is a model's opinion, must survive an adversarial
verifier, and blocks only the PR. Treating them alike would either let false criticals stop work
or let real gate failures be argued with.

**`--only critical` narrows the review, not the verdict.** Findings for files it did not re-check
are carried forward from the previous run. Without that rule, repeatedly narrowing a re-check is
a way to turn a blocked branch green without fixing a line.

## 8. Version and changelog

### 1.0.0 — 2026-08-02

First release. Written against the six scripts in `scripts/pr-self-review/`, all committed and
green, and against `specs/03-pr-self-review-skill.md`.

Decisions made while writing, beyond what the spec fixed:

- **`--freeze` and `--only critical` are implemented rather than removed from the slash
  command.** `.claude/commands/pr-self-review.md` promised four arguments; two of them had no
  procedure anywhere. `--freeze` had a mechanism (`baseline.sh --freeze`) wired to nothing, and
  `--only critical` mapped to no script at all. Both now have a written procedure in `SKILL.md`
  §4 and neither needed a new script. Removing them instead would have left the only user-facing
  entry point — the one the hook's refusal message names — promising less than the mechanism
  already does, and `--freeze` in particular is the documented remedy for the "sixteen criticals
  on day one" failure this design exists to avoid.
- **`--only critical` records `mode: "gates"`.** `latest.json` has two mode values and `gate.sh`
  refuses a PR on anything but `full`. A partial Track B sweep must never open a PR, and Track A
  did run whole, which is precisely what `gates` already means.
- **Every Track A finding is normalised to `line: 0` before `baseline.sh`.** Found by running the
  scripts against this branch, not by reading them. `scope.flagged[]` carries `line: 1` for a
  path that is never in `.routed[]`, and `registry.sh` carries `line: 1` into `skills-lock.json`,
  which a branch almost never edits — so diff-anchoring demoted both to `note` and a tree with a
  committed `.env` and two broken lock entries reported `pass`. Setting `line: 0` on every
  `source` beginning with `gate` reproduces the verdict this branch is recorded as having
  produced by hand: **2 critical, 4 major**. `line: 0` is `baseline.sh`'s own word for "belongs
  to no single line". One `jq` clause in `SKILL.md` §3.5; no script change.
- **The run's scratch files go in `.pr-self-review/run`, and the path is written out literally
  rather than held in a shell variable.** Two reasons, both measured. Shell state does not
  survive between Bash calls in this harness, so a `TMP=` set in step 1 is gone by step 2. And
  `scope.sh` folds every *untracked* file's content into `worktreeHash`: a probe file under
  `.pr-self-review/` (gitignored) left the hash byte-identical, while the same file in a fresh
  `tmp-probe/` changed it — which would have made `gate.sh` refuse the very push it had just
  passed.
- **No `enforcement.md` and no `report-format.md`.** The scripts are the executable copy of both.

## 9. How this skill was tested

*Not yet measured.* Task 9 of the implementation plan owns the acceptance run and fills this
section in.

Per `.claude/skills/README.md`, a skill is not done until the scenarios it exists for have been
run against an agent that does **not** have it. The baseline (RED) and verification (GREEN) runs
belong here, with the token and tool-call counts, and any rule the baseline shows an agent
already follows unaided should be cut rather than kept.

The acceptance criteria to measure against are in `specs/03-pr-self-review-skill.md`
§Acceptance. The sharpest of them is the RED prong: re-running against commit `1d5348d`
(*refuse a finding link whose path would resolve out of the repo*) with the fix reverted should
raise a path-traversal critical from the `security` agent — a real defect this repo actually
shipped a fix for.

Until that section is filled in, every claim in this file about what the skill catches is a
prediction.

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
| `README.md` | 403 | This card: scope, boundaries, sources, decisions, how it was tested |
| `SKILL.md` | 351 | When does it run? What is the procedure? Which mode? What must never be reported? |
| `modes.md` | 158 | How do `--freeze` and `--only critical` differ from a normal run? |
| `routing.md` | 166 | Which subagent opens which skill, what to look for in the ones with no checklist, what is left out on purpose |
| `gates.md` | 181 | What is each Track A gate, what does its failure look like, what do I try first? |
| `severity.md` | 145 | Which of the four levels is this, and what does it stop? |

`SKILL.md` stays thin because it loads in full whenever the skill activates. The topic files load
only when the run needs them — a `--gates` run never opens `routing.md`, and a `--full` run
never opens `modes.md`.

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
| `superpowers:requesting-code-review` | Generic pre-merge review | superseded here — [SKILL.md](SKILL.md) §6 states the boundary |
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
| `scripts/pr-self-review/baseline.sh` | that only an `agent `-sourced finding is diff-anchored, and that the freeze fingerprint is `{file, line, message}` |
| `scripts/pr-self-review/report.sh` | the six trustworthiness rules, that the verdict never travels by exit code, that a `full` run which dispatched no agent over routed files is `incomplete`, and that any payload it cannot read — `.scope` not an object, or `.findings` / `.gates` / `.agents` / `.scope.skipped` not each an array of objects — is `incomplete` too |
| `scripts/pr-self-review/gate.sh` | what the hook actually refuses, and that freshness is the load-bearing half |
| `scripts/pr-self-review/registry.sh` | the five registry checks and their severities |
| `.claude/skills/README.md` | the authoring standard: thin `SKILL.md`, one topic file per question, `name` matching the directory, no top-level `version` |
| [Agent Skills specification](https://agentskills.io/specification) | frontmatter takes `name` and `description`; free-form keys go under `metadata` |
| [Anthropic skill-authoring guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | the 500-line cap and one-level-deep file references |
| `CLAUDE.md` | the Do-not-touch list that Tier 1 and Tier 2 mirror, and the pnpm/npm split |
| `INSIGHTS.md` (root) | that reviews in this repo legitimately return nothing — the evidence behind the empty-report rule |
| `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md` | what each domain subagent is required to read before it reviews |

## 7. Conflicts this skill resolves

Each of these is decided in exactly one file. This section says which, and nothing more — a
second copy of a rule is the drift this skill exists to argue against, and it would be a poor
joke to put one here.

| Conflict | Decided in |
|---|---|
| A repo skill and a pinned upstream one disagree about the same file | [SKILL.md](SKILL.md) §5 |
| An upstream skill's own CRITICAL / HIGH / MEDIUM label vs. what a finding stops here | [severity.md](severity.md) |
| A Track A critical and a Track B critical are both "critical" | [severity.md](severity.md) |
| This skill vs. `superpowers:requesting-code-review` | [SKILL.md](SKILL.md) §6 |
| `--only critical` narrows the review — does it narrow the verdict? | [modes.md](modes.md) |

The one thing worth adding here, because it is about the *set* rather than any single rule: all
five are resolved by asking what a decision **stops**, never by which source is more
authoritative in the abstract. That is why a Track A critical and a Track B critical are
different objects, and why an upstream skill's CRITICAL is not ours.

## 8. Version and changelog

### 1.0.0 — 2026-08-02

First release. Written against the six scripts in `scripts/pr-self-review/`, all committed and
green, and against `specs/03-pr-self-review-skill.md`.

Decisions made while writing, beyond what the spec fixed:

- **`--freeze` and `--only critical` are implemented rather than removed from the slash
  command.** `.claude/commands/pr-self-review.md` promised four arguments; two of them had no
  procedure anywhere. `--freeze` had a mechanism (`baseline.sh --freeze`) wired to nothing, and
  `--only critical` mapped to no script at all. Both now have a written procedure in
  [modes.md](modes.md) and neither needed a new script. Removing them instead would have left the only user-facing
  entry point — the one the hook's refusal message names — promising less than the mechanism
  already does, and `--freeze` in particular is the documented remedy for the "sixteen criticals
  on day one" failure this design exists to avoid.
- **`--only critical` records `mode: "gates"`.** `latest.json` has two mode values and `gate.sh`
  refuses a PR on anything but `full`. A partial Track B sweep must never open a PR, and Track A
  did run whole, which is precisely what `gates` already means.
- **`baseline.sh` now anchors only what a model produced.** Found by running the scripts against
  this branch, not by reading them: `scope.flagged[]` carries `line: 1` for a path that is never
  in `.routed[]`, and `registry.sh` carries `line: 1` into `skills-lock.json`, which a branch
  almost never edits. Diff-anchoring demoted both to `note`, so a tree with a committed `.env`
  and two broken lock entries reported `pass`. The rule is now "demote only when `source` begins
  `agent `" — deterministic sources already scope themselves, and the baseline exists for the
  sixteen pre-existing `container.db` calls, which come from a subagent. Fixed in the script with
  four new tests rather than worked around in this skill.
- **A subagent's `source` must begin `agent <domain> · `.** That prefix is what
  `baseline.sh` keys on, so it is part of the output contract in `SKILL.md` §3.3, not a
  formatting preference. The skill and section follow it, so attribution survives.
- **The run's scratch files go in `.pr-self-review/run`, and the path is written out literally
  rather than held in a shell variable.** Two reasons, both measured. Shell state does not
  survive between Bash calls in this harness, so a `TMP=` set in step 1 is gone by step 2. And
  `scope.sh` folds every *untracked* file's content into `worktreeHash`: a probe file under
  `.pr-self-review/` (gitignored) left the hash byte-identical, while the same file in a fresh
  `tmp-probe/` changed it — which would have made `gate.sh` refuse the very push it had just
  passed.
- **Step 0 seeds `findings.json` and `agents.json` as `[]`.** Steps 5 and 6 read both through
  `jq --slurpfile`, which exits 2 on a missing path, but only step 3 writes them. Without the
  seed every mode that dispatches no subagent — `--gates`, a `--only critical` with nothing to
  re-check, and any run a failing Track A gate cut short — died at step 5 and wrote no
  `latest.json` at all. `--gates` is the mode `gate.sh` names in its own refusal message, so it
  was the most likely path of anyone the hook had just blocked.
- **Step 6's snippet reads `--arg mode gates`, and `full` is the edit you make by hand.** A
  snippet hardcoded to `full` and pasted after a gates-only run forges the one field that lets a
  PR through. Defaulting the other way costs a wasted turn. Cheap error over expensive error, the
  same asymmetry `gate.sh` reasons from in its own comments.
- **The `--only critical` carry-forward writes `merged.json` and renames.** Redirecting into
  `findings.json` while `--slurpfile n` reads it lets the shell truncate the file first, so `$n`
  is `[]`, `$n[0]` is `null`, and jq's `[carried] + null` silently drops everything the re-check
  just found — turning a blocked branch green through the very mechanism written to stop that.
- **`report.sh` rule 4 also fires when a `full` run dispatched nothing.** `mode: "full"` with an
  empty `agents[]` over a **non-empty** `.scope.routed` is `incomplete`, and the report prints
  `NO SUBAGENT RAN`. `gate.sh` checks `mode != full` and never reads `.coverage.agents`, so
  without this such a verdict opens a PR on a review that ran Track A only — the seeding decision
  three bullets up is what made it reachable, since the same run used to die at step 5 instead.
  The rule is narrow deliberately: an empty `agents[]` over an **empty** `routed[]` is a real
  pass, because a diff of nothing but lockfiles routes no file and that run did cover everything
  there was. `mode: "gates"` never trips it — that mode already says half a review.
- **The `--only critical` guard uses `-s` on the two JSON inputs and `-f` on `recheck`.** An empty
  `recheck` is not an error: a branch blocked solely by Track A has no Track B critical to narrow,
  and then an empty `$re` matches nothing in `index()`, so every previous finding is carried and
  none dropped — the right answer. `-s` there hard-stopped that run, which is this repo's own
  state most days. The corrupt-`latest.json` case that leaves the same 0 bytes is caught where it
  actually happens, on the exit status of the extraction `jq`. A guard that refuses a correct run
  teaches people to delete the guard.

  The inverse is the sixth and last known instance of the silent-pass class: a **non-empty**
  `recheck` with an empty `agents.json`. The `select(… | not)` correctly declines to carry a
  re-checked file's old findings — the mechanism working — but with no subagent dispatched,
  nothing replaces them, and a branch blocked on a Track B critical prints `PASS`. `report.sh`
  cannot see it: `--only critical` records `mode: "gates"` by design, which is indistinguishable
  there from a legitimate `--gates` run. So the snippet asserts that a non-empty `recheck`
  implies a non-empty `agents.json`, and names the findings it would otherwise drop.
- **`baseline.sh` tolerates a missing or non-string `source`.** Half the findings are written by
  a model. A bare `startswith` raises `requires string inputs`, and under `set -e` that discarded
  the entire payload, deterministic criticals included. One malformed model finding must not take
  the committed `.env` with it.
- **`report.sh` refuses to call an unreadable payload a pass (its rule 6).** Six separate defects
  in this feature's short history ended identically: a `jq` step failed or a slurped file came
  back empty, `null` or a bare string reached a `+`, an iteration or a `.status` read, jq
  absorbed it or died, and a `pass` was left standing. Guarding each site as it was found lost
  every time, so the last station on the line now requires an object whose `.scope` is an object
  and whose `.findings`, `.gates`, `.agents` and `.scope.skipped` are each an **array of
  objects**. Every key it reads, because each alone forges a pass: a null `.gates` reports green
  with no Track A at all; a null `.agents` is swallowed by `.agents[]?` so a lost
  crashed-subagent record reads clean — the key that defeats rule 4; a null or `{}` `.scope`
  prints a green report with an EMPTY skipped list, which rule 3 calls lying.

  The **elements** are checked, not only the container, and that half is what a container-only
  rule 6 could not do. `{"agents":["frontend crashed"]}` is an array, so it passed; the `.status`
  read then raised `Cannot index string with "status"`, the jq computing the verdict died under
  `set -e`, and **no `latest.json` was written at all** — leaving an earlier `pass` over the same
  tree on disk byte-identical for `gate.sh` to honour. `{"findings":["prose"]}` is the same hole
  one bracket away, and both files are written freehand by a model. An empty *array* is still
  `pass`; an empty report is a valid result and that rule stands.

  Repairing rather than crashing is load-bearing: a crash writes no `latest.json`, and a passing
  verdict from an earlier run over the same tree is still *fresh* to `gate.sh`, so it would be
  honoured. Empty stdin has to be caught **before** the repair rather than by it — `jq
  '.findings = []'` on empty input exits 0 printing nothing, which silently produced an empty
  payload and a `latest.json` of one byte, no verdict recorded at all.

  Measured against the committed pre-fix script: a 0-byte `gates.json` driven through the real
  steps 5 and 6 went from `pass` with `"gates": null` to `incomplete`; `.agents = null` from
  `pass` to `incomplete`; empty stdin from a 1-byte invalid file to a recorded `incomplete`; and
  a clean payload still passes.
- **Rule 6 is a net, not a proof, and every `jq --slurpfile` in `SKILL.md` is outside it.** A
  *truncated yet well-formed* findings array is indistinguishable from a clean run by the time it
  reaches `report.sh`. So each snippet that slurps a file first refuses to run on one that is
  missing, empty or not JSON, names what would have been lost, and exits non-zero. Two routes
  needed exactly that and nothing less: step 5's `+ $a[0]` over a 0-byte `findings.json` exits 0
  with every subagent finding gone, and the carry-forward's `+ $n[0]` over the same file also
  exits 0 — so a `||` failure branch never fires — keeping the carried findings and losing the
  re-check's own. Checking the exit status of a command that succeeds is not a guard.
- **No `enforcement.md` and no `report-format.md`.** The scripts are the executable copy of both.

## 9. How this skill was tested

Measured 2026-08-02, on branch `feat/findings-severity-filter` (base `3f30409`, HEAD `a05a1c1`)
— a 61-file diff across `client/`, `server/` and `reviewer-core/`. Every number below is a real
run, and the ones that did not go the way the spec predicted are recorded as they came out.

### The scripts

`bash scripts/pr-self-review/test/run.sh` — **237 assertions, 0 failures** across six files
(`baseline` 31, `gate` 28, `gates` 11, `registry` 7, `report` 137, `scope` 23). Now also a CI
job, `.github/workflows/pr-self-review.yml`, with `fetch-depth: 0` because `scope.sh` needs a
real merge-base and the suite builds throwaway repos with real branches.

### Track A — the deterministic half

**12–14 s** for the whole of Track A on that three-package diff, against a 90-second budget:
arch 0.6 s, server typecheck 2.3 s, server tests 8.6 s, client lint 1.8 s, client typecheck
1.1 s, client tests 3.7 s, reviewer-core typecheck 0.9 s + tests 0.6 s, vendor diff and registry
under a second. Two runs: 13.1 s and 12.1 s.

Track A is the part that works exactly as designed, and it is the part with a reproducible
answer. Three things it caught on a tree nobody thought was dirty: the two `skills-lock.json`
entries with no directory, the missing `.cursor/skills` symlink, and — unpredicted —
`react-testing-library/SKILL.md` at **603 lines**, over the authoring cap this repo documents.

One correction to the spec's own text: **`gates.sh` does not fail fast.** It runs all nine
package gates and then the registry gate regardless of failures. "Fails fast" is true only at
the Track A → Track B boundary, which is a rule in `SKILL.md` §3.2 that a model obeys, not
something the script enforces.

### Track B — the model half, run for the first time

Four subagents over the 61 routed files, dispatched in one message per
`superpowers:dispatching-parallel-agents`:

| Agent | Files | Findings | Tokens | Tool calls |
|---|---|---|---|---|
| `backend` | 3 | 1 major, 1 minor | 90,134 | 20 |
| `frontend` | 42 | 3 minor | 123,582 | 20 |
| `frontend-tests` | 16 | 6 minor, 1 note | 130,912 | 29 |
| `security` | 61 | **0** — returned `[]` | 164,548 | 44 |
| | | **12 findings** | **509,176** | **113** |

Wall clock ~5 minutes, concurrent. Three results are worth having on record:

- **The `agent <domain> · ` source prefix held 4/4.** Every returned finding carried it, so
  `baseline.sh` diff-anchored all of them. The contract in `SKILL.md` §3.3 works when it is
  quoted into the brief verbatim.
- **The four severity values held 4/4.** Not one `HIGH`, `MEDIUM` or `CRITICAL` leaked through
  from `react-best-practices`, `zod` or `security`, which all ship their own vocabulary. Quoting
  the four legal values into the brief is doing its job.
- **Diff-anchoring held 12/12.** Every finding landed on a line the branch actually touched;
  `baseline.sh` demoted none. Passing each agent its `lines` array is why.

Zero of the twelve were `critical`, so **step 4 — the adversarial verifier — has still never
run.** It remains unmeasured.

Were the findings worth having? The `backend` one was: a new 16-line Drizzle query added
straight into `pulls/routes.ts`, the exact file `onion-architecture` §5 already names as its
cautionary example. The other eleven were real but small — an `export *` barrel, two
derive-don't-store effects, six test-style items. None of them would have stopped a merge, and
none of them are things `/code-review` could not have found.

### The RED prong — a defect this repo actually shipped a fix for

Commit `1d5348d` (*refuse a finding link whose path would resolve out of the repo*) was put back
to its pre-fix state in the working tree — all four files, including the `client/INSIGHTS.md`
entry that records the lesson, so the agent had no recorded knowledge of it — and the `security`
agent was dispatched over `lib/github-urls.ts` and its three call sites.

**It found the defect and mis-graded it.**

> `client/src/lib/github-urls.ts:31` — "`encPath` splits on `/` and runs `encodeURIComponent`
> per segment, but `.` is an unreserved character, so `..` segments survive verbatim… renders as
> an ordinary-looking citation whose href the browser normalizes to
> `https://github.com/apps/evil-app/installations/new`."
>
> `"severity": "minor"`

The `fix` it proposed is, near enough, the fix that actually shipped. But `severity.md` §critical
names "an OWASP finding: injection, authorization bypass, path traversal, SSRF" and cites this
very commit — so the right answer was `critical`. Graded `minor`, it blocks nothing and never
reaches the adversarial verifier.

The cause is structural, not a bad roll: **the subagent never sees `severity.md`.** `SKILL.md`
§3.3 quotes the four legal *values* into the brief and stops there, so the agent applied the
`security` skill's own impact-based reasoning — origin is pinned to `github.com`, so bounded —
and landed on minor. The four *names* travel into the brief; the *rules for choosing between
them* do not. That is the single most actionable defect this measurement found.

### The GREEN comparison — the same scenario without the skill

The same four files, same RED state, given to an agent with **no skill, no routing, no
INSIGHTS-first rule, no severity vocabulary and no output contract** — just "tell me whether
anything here is a problem worth fixing before this branch is merged".

| | With the skill | Without it |
|---|---|---|
| Tokens | 62,325 | 75,822 |
| Tool calls | 11 | 38 |
| Duration | 119 s | 299 s |
| Found the path traversal | yes, `github-urls.ts:31` | yes, **first item**, with `new URL()` output proving it |
| Other findings | none | 3 more + 2 nits, incl. a raw `repoFullName` interpolation the skilled run missed |
| Output | machine-readable JSON | prose |
| Severity | `minor` — would not block | "worth fixing before merge" |

**The unskilled agent found the defect the skill exists to catch, found more besides, and
described its severity more accurately.** It also verified its claim by executing the builder,
which the skilled run did not. It cost 22% more tokens and 3.5× the tool calls, and it read git
history despite being told not to — it cited commit `1d5348d` by name — so part of its advantage
is contamination we could not fully exclude.

### The honest verdict

Spec 02 found its skill rescued nothing it had assumed it would. **The same is true here, for
the model half.** On the one scenario with a known right answer, the skill did not improve
detection; it made the answer cheaper and structured, and it got the severity wrong in the
direction that matters — down, not up.

What earns its context cost:

- **Track A.** Nothing else in this repo runs nine gates over a diff in twelve seconds, and it
  found three real problems on a tree everyone believed was clean. It is deterministic,
  reproducible, and would be worth keeping with Track B deleted.
- **The output contract.** The `agent · ` prefix, the four severity values and the `lines` array
  each held 4/4 or 12/12. Structure is what the skill reliably buys: 12 findings that
  `baseline.sh`, `report.sh` and `gate.sh` can all consume without a human in between.
- **The verdict file and the hook.** Freshness, mode and bypass all behave: a `gates` pass allows
  a push and refuses a PR; one edit or one commit makes it stale and both are refused;
  `PR_SELF_REVIEW_SKIP=1` proceeds and the bypass appears in the next report; a crashed subagent
  yields `incomplete` and blocks, naming the unreviewed files.

What does not, on this evidence:

- **The claim that partitioned domain subagents find more than one plain reviewer.** Measured
  once, they found less. Half a million tokens for twelve findings, none of them blocking.
- **`routing.md` §3's pointer lists**, unmeasured. Whether an agent given a skill plus five
  "what to look for" questions outperforms one given the skill alone was never tested, and the
  RED prong is weak evidence that it does not.

The recommendation is not to delete Track B but to stop describing it as the half that catches
things. It is the half that *formats* things. If one change is made next, it is the one the RED
prong named: get the severity rules into the subagent brief, because a critical graded `minor`
is indistinguishable from a critical never found.

### What was not measured

- The adversarial verifier (§3.4) — no run has yet produced a Track B `critical`.
- `--freeze` and `--only critical` end to end. Their scripts are unit-tested; their procedures
  in [modes.md](modes.md) have not been executed.
- A second run over the same diff, so the non-deterministic spread of Track B findings is
  unknown.
- Whether Track A's `incomplete`-on-crash path fires against a genuinely crashed subagent rather
  than a hand-written `agents.json` entry.

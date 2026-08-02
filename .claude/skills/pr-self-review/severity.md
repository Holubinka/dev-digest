# Severity — the four levels, and what each one stops

Every finding carries exactly one of `critical`, `major`, `minor`, `note`. The level is not a
feeling about how bad something is; it answers one question: **what does this stop?**

| Level | Stops | Who may assign it |
|---|---|---|
| `critical` | `gh pr create` always; `git push` when it came from Track A | Track A directly; Track B only after the verifier |
| `major` | nothing — fix before the PR | either track |
| `minor` | nothing | either track |
| `note` | nothing | either track, **and `baseline.sh` mechanically** |

## The two sources are not equal

**A Track A failure is critical by definition.** `pnpm arch`, `lint`, `typecheck`, the three test
suites, the vendor mirror and the registry either exit 0 or they do not. Nothing interprets the
result and nothing may downgrade it. It blocks `git push` as well as the PR.

"Nothing may downgrade it" is enforced in three places, because two of them were once enough and
were not:

- `baseline.sh` anchors a finding to the diff **only** when its `source` begins `agent `. A
  deterministic finding was never about a diff line — `gate arch` carries its own
  known-violations file, `gate registry` is repo-wide, and a `gate scope` flag is about a path
  that is deliberately never routed — so none of them are anchored.
- `baseline.sh` also **freezes and drops only model findings**. `--freeze` used to record
  whatever it was handed, so freezing this repo's two standing `gate registry` criticals removed
  them from every later run. A red gate is fixed, not frozen.
- `report.sh` computes the verdict from `.gates[].status` as well as `.findings`. A gate that
  reports `fail` blocks whatever became of the finding beside it — which is what stops a report
  from printing `FAIL repo registry` under the header `PASS`, as one did.

**A Track B critical must survive an adversarial verifier.** A model finding that stops the
user's work has to earn it, so the burden of proof sits on the finding: a second subagent is
asked to refute it, and *uncertain counts as refuted*. What survives keeps `critical` and carries
a `verifier` line. What does not becomes `major` — visible in the report, blocking nothing. See
[SKILL.md](SKILL.md) §3.4.

The consequence is worth stating plainly: a Track B critical stops only `gh pr create`, never a
push. Two reasons, and the second is the stronger: a `gates`-mode run never saw it, and Track B's
grading is not trustworthy enough to stop work — the acceptance run had the `security` agent find
a real path traversal and grade it `minor`. `report.sh` records which half a critical came from
in `pushBlocked`, and `gate.sh` reads it.

## critical

Track A: **any failed gate.** See [gates.md](gates.md).

Track B, each subject to the verifier. **This file does not restate the rules — it says what
level they land at and where each one is written.** A third copy of a rule is a third thing to
drift, and this repo pays that bill twice over in `vendor/shared/` already.

| A finding of this kind | is critical because | the rule itself lives in |
|---|---|---|
| A dependency-rule violation | the arch gate cannot see all of them | `onion-architecture` §7 — its own list |
| A secret reachable from code | it is the one mistake that cannot be undone by a later commit | `CLAUDE.md` §"Non-default conventions"; `scope.sh`'s `flag_for` flags the committed files before a subagent sees them |
| An OWASP finding — injection, authorization bypass, path traversal, SSRF | it is exploitable as written | the `security` skill. Commit `1d5348d` is this repo's own path-traversal case |
| One-sided drift between the two `vendor/shared` copies | type-checking cannot see it | `CLAUDE.md` §"Non-default conventions"; the `repo vendor` gate measures it |
| A Fastify module added without hand-registration | nothing autoloads them here, so the route silently does not exist | `CLAUDE.md` §"Non-default conventions"; `onion-architecture` |
| A change to a skill pinned in `skills-lock.json` | it is a pinned upstream copy | `CLAUDE.md` §"Do not touch"; flagged by `scope.sh` |
| A `CLAUDE.md` that stopped being a symlink to its `AGENTS.md` | Claude Code discovers only `CLAUDE.md` | `CLAUDE.md` §"Do not touch" |

One entry has no other home, so it is written here: **a test deleted or `skip`ped in the same
change that would otherwise have failed it.** The test gate cannot tell that from an honest
removal — a reviewer can.

Every critical carries one concrete `fix`. "Consider reviewing this" is not a fix; `move the
query into pulls/repository.ts` is.

## major

Fix before the PR. Does not block. Same rule as above: the level is decided here, the rule is
not repeated here.

| A finding of this kind | the rule itself lives in |
|---|---|
| A checklist violation that no gate enforces | the `Review checklist` of `frontend-architecture` or `onion-architecture` |
| New behaviour with no test | `superpowers:test-driven-development` |
| A hook-shaped name that uses no hook, or shareable state kept out of the URL | `react-best-practices`, `frontend-architecture` |
| A new route absent from the API map | `server/README.md` |
| A `SKILL.md` over 500 lines | `.claude/skills/README.md`, measured by the registry gate |

One more, again with no other home: **a `vendor/` path in the diff at all, or a changed
`e2e/specs/*.flow.json`.** Both are flagged by `scope.sh` as "the change itself is the finding",
so the contents are never reviewed. The vendor one escalates to critical only when the mirror
gate confirms the two copies disagree.

## minor

Real, small, and cheap to leave: naming, a redundant type annotation, a comment that no longer
matches the line under it, an import that could be narrowed. Report it once and move on.

## note

Two different things arrive here, and confusing them wastes a reader's time.

**Judged notes** — an observation with no action attached. `docs/architecture.md` changed, so
check whether its diagram still holds. A `skills-lock.json` directory with no lock entry.

**Mechanical notes** — `baseline.sh` demotes any **model** finding whose line the branch did not
touch, sets `anchored: false`, and leaves it in the report. It was not judged minor by anyone; it
is a pre-existing condition of a file this branch happens to have edited elsewhere. A finding on
line 300 of a file you changed at line 40 is baseline, not yours. Track A never reaches this
rule — see the top of this file.

Do not manufacture notes to make a thin report look fuller — [SKILL.md](SKILL.md) §5.

## Upstream skills bring their own labels — do not pass them through

`react-best-practices` marks sections CRITICAL / HIGH / MEDIUM. `zod` orders its rules
CRITICAL / HIGH / MEDIUM-HIGH / LOW-MEDIUM. `security` ships its own severity classification.
**None of those are this scale.** They rank a rule's importance in general; this scale ranks what
a finding stops in this repo today.

Map through the table at the top of this file. A `react-best-practices` "CRITICAL" that no gate
enforces and that stops nothing is a `major` here, and calling it critical would block a push
over a key prop.

## What the hook does with the verdict

`report.sh` reduces the findings to one verdict, and `gate.sh` reads only that.

| Verdict | Set when | `git push` | `gh pr create` |
|---|---|---|---|
| `pass` | no critical, no failed gate, every routed domain covered by an agent that reported `ok` | allowed | allowed **only if** `mode` is `full` |
| `blocked`, `pushBlocked: true` | a critical from Track A — a failed gate, a `gate scope` flag, a registry inconsistency | refused | refused |
| `blocked`, `pushBlocked: false` | every surviving critical came from a subagent | **allowed** | refused |
| `incomplete` | any agent status is not `ok`; **or a `full` run dispatched no agent over routed files**; **or a `full` run left a routed domain with no agent**; **or the payload was not something `report.sh` could read** | refused | refused |

`pushBlocked` is a field, not a fourth verdict, so that `gate.sh` keeps refusing a PR on any
non-`pass` and only the push consults it. It is read as `= false`, never `!= true`: a verdict
written before the field existed, or by hand, fails closed and refuses the push.

`incomplete` outranks `blocked` deliberately: if a crashed subagent counted as a pass, breaking
a subagent would be the cheapest way through the gate.

The second trigger is that argument taken one step further: an agent that never ran is no more
reviewed than one that crashed. `mode: "full"` with an empty `agents[]` over a **non-empty**
`.scope.routed` is Track A wearing the mode a PR requires, and `gate.sh` checks the mode and
never the coverage. An empty `agents[]` over an empty `routed[]` is untouched — a diff of nothing
but lockfiles routes no file, and that run really did cover everything there was.

The third trigger is the same argument at the resolution a real run fails at. `scope.json`
carries the domain set, so on a `full` run every domain in `.scope.routed[].domains` must appear
in `.agents[].name`; the difference is recorded in `.uncovered` and printed as
`PARTIAL COVERAGE`. A five-agent fan-out where one agent was forgotten is far likelier than one
where none ran, and it used to be indistinguishable from complete coverage.

The third is the same argument turned on the pipeline itself. `report.sh` computes the verdict
from `.findings`, `.gates`, `.agents` and `.scope`, and everything upstream is a chain of `jq`
steps over slurped files written partly by a model — if one fails or a file comes back empty,
`null` or a bare string reaches a `+`, an iteration or a `.status` read, and what arrives looks
exactly like a clean run or kills the script outright. So the payload must be an object whose
`.scope` is an object and whose `.findings`, `.gates`, `.agents` and `.scope.skipped` are each an
**array of objects**. Each part alone can forge a pass: a null `.gates` reports green with no
Track A at all; a null `.agents` is swallowed by `.agents[]?` so a lost crashed-subagent record
reads clean; a null or `{}` `.scope` prints green with an empty SKIPPED list. And the element
check is what stops `{"agents":["frontend crashed"]}` — an array, so a container-only rule waved
it through, and the `.status` read then crashed the script, which wrote no verdict at all and
left an earlier `pass` over the same tree standing for the hook to honour. An empty *array* is
still `pass`: zero findings really are a valid result, and rule 6 must not break the rule beside
it.

Freshness sits on top of all three. A verdict is only usable while `headSha` and `worktreeHash`
still match the working tree, so one edit after a pass makes it stale and the hook refuses again.

Three environment variables can weaken all of this, and each is recorded in `latest.json`'s
`bypassed[]` and printed in the report — `PR_SELF_REVIEW_SKIP=1` on the run after it is used,
the other two on the run itself. A gate with no override gets deleted the first time it is wrong
during an urgent push; an override nobody can see is worse than no gate at all. They are listed
in [README.md](README.md) §10.

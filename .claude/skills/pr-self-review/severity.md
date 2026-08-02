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
result and nothing may downgrade it. It blocks `git push` as well as the PR, because
`gate.sh` refuses a push on any non-`pass` verdict.

That "nothing may downgrade it" is enforced in `baseline.sh`, which anchors a finding to the diff
**only** when its `source` begins `agent `. A deterministic finding was never about a diff line —
`gate arch` carries its own known-violations file, `gate registry` is repo-wide, and a
`gate scope` flag is about a path that is deliberately never routed — so none of them are
anchored, and none can be quietly demoted.

**A Track B critical must survive an adversarial verifier.** A model finding that stops the
user's work has to earn it, so the burden of proof sits on the finding: a second subagent is
asked to refute it, and *uncertain counts as refuted*. What survives keeps `critical` and carries
a `verifier` line. What does not becomes `major` — visible in the report, blocking nothing. See
[SKILL.md](SKILL.md) §3.4.

The consequence is worth stating plainly: a Track B critical stops only `gh pr create`, never a
push, because a `gates`-mode run never saw it.

## critical

Track A: **any failed gate.** See [gates.md](gates.md).

Track B, each subject to the verifier:

- **A dependency-rule violation** — Drizzle outside a `repository.ts`, `container.db` in a
  route, anything in `adapters/` importing `modules/`. `onion-architecture` §7 is the list.
- **A secret reachable from code** — a value in `AppConfig` or `process.env` that belongs to
  `SecretsProvider`, or a key committed in any file. `scope.sh` flags a committed `.env`, `.key`
  or `.pem` before a subagent ever sees it.
- **An OWASP finding**: injection, authorization bypass, path traversal, SSRF. Commit `1d5348d`
  is this repo's own path-traversal case — a finding link whose path resolved out of the repo.
- **One-sided drift between the two `vendor/shared` copies.** Both copies move together or
  neither does.
- **A Fastify module added without registration in `server/src/modules/index.ts`.** Modules are
  registered by hand here; nothing autoloads them, so an unregistered module is a route that
  silently does not exist.
- **A test deleted or `skip`ped in the same change that would otherwise have failed it.** The
  test gate cannot tell this from an honest removal — a reviewer can.
- **A change to a skill pinned in `skills-lock.json`.** Flagged by `scope.sh`.
- **A `CLAUDE.md` that stopped being a symlink to its folder's `AGENTS.md`.**

Every critical carries one concrete `fix`. "Consider reviewing this" is not a fix; `move the
query into pulls/repository.ts` is.

## major

Fix before the PR. Does not block.

- A checklist violation from `frontend-architecture` or `onion-architecture` that no gate
  enforces — a `*Row` type leaving its module, a service building its own repository, a `'use
  client'` on a layout instead of a leaf.
- **New behaviour with no test.** From `superpowers:test-driven-development`.
- Anything named `use*` that calls no hook.
- Shareable state held in `useState` where it belongs in the URL.
- A new route absent from the API map in `server/README.md`.
- A `vendor/` path in the diff at all, or a changed `e2e/specs/*.flow.json` — both flagged by
  `scope.sh` as "the change itself is the finding", so the contents are never reviewed. The
  vendor one escalates to critical only when the mirror gate confirms the two copies disagree.
- A `SKILL.md` over 500 lines, from the registry gate.

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
| `pass` | no critical, every agent ok | allowed | allowed **only if** `mode` is `full` |
| `blocked` | one or more criticals survive | refused | refused |
| `incomplete` | any agent status is not `ok`; **or a `full` run dispatched no agent over routed files**; **or the payload was not something `report.sh` could read** | refused | refused |

`incomplete` outranks `blocked` deliberately: if a crashed subagent counted as a pass, breaking
a subagent would be the cheapest way through the gate.

The second trigger is that argument taken one step further: an agent that never ran is no more
reviewed than one that crashed. `mode: "full"` with an empty `agents[]` over a **non-empty**
`.scope.routed` is Track A wearing the mode a PR requires, and `gate.sh` checks the mode and
never the coverage. An empty `agents[]` over an empty `routed[]` is untouched — a diff of nothing
but lockfiles routes no file, and that run really did cover everything there was.

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
`PR_SELF_REVIEW_SKIP=1` bypasses everything and is recorded in the next report — a gate with no
override gets deleted the first time it is wrong during an urgent push.

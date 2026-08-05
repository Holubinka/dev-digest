# Agents

Subagents this repo dispatches through the `Agent` tool. Each is one Markdown file with
frontmatter (`name`, `description`, `tools`, optional `skills`, `model`, `color`) and a body of
rules. **This file is the map, not the rules** — the bodies are the source of truth, and every
row below was read off the file it names.

Nothing registers an agent. `scripts/pr-self-review/registry.sh` reads `.claude/skills/` and
`skills-lock.json` only, so a file in this folder appears in no catalogue, and no gate — not
`repo · registry`, not any other — ever opens it. A broken agent is discovered by dispatching
it.

## The set

| Agent | Owns | Model | Writes to disk | Dispatch |
|---|---|---|---|---|
| [`planner`](planner.md) | Turning a request into a plan another agent can execute cold | opus | one plan under `specs/`, one status row | proactively, before any code |
| [`implementer`](implementer.md) | Making the repo match an approved plan, and proving it with gates | opus | code in the modules the plan names | explicitly, with a plan path |
| [`researcher`](researcher.md) | Answering a question about this repo or the outside world, with evidence | sonnet | nothing | when a question blocks either of the above |
| [`test-writer`](test-writer.md) | Writing tests for code that already shipped, and proving each one can fail | opus | test files in `client/src/**`, `server/test/`, `reviewer-core/test/` **and `e2e/specs/*.flow.json`** | explicitly, with what to cover |
| [`architecture-reviewer`](architecture-reviewer.md) | Boundaries the dependency-cruiser rules cannot express | opus | nothing | explicitly, with a target |
| [`plan-verifier`](plan-verifier.md) | Whether the finished code satisfies every item of the plan | opus | nothing | explicitly, with a plan path |
| [`doc-writer`](doc-writer.md) | Documenting what shipped, in the right `docs/` folder | sonnet | one document under `docs/` or `<module>/docs/`, one README row | explicitly, after the work lands |

The intended order is `researcher` → `planner` → *human approves the plan* → `implementer` →
`test-writer` → *human dispatches* `architecture-reviewer` and `plan-verifier` → `doc-writer` →
*human runs `/pr-self-review`*. Each stage starts with a clean context window and knows only
what the previous stage left on disk; that is why the plan is a file and not a paragraph.

The last four sit in no script — they are dispatched by a human, or by the main agent when the
work calls for it. `architecture-reviewer` in particular is **not** a Track B agent:
`scripts/pr-self-review/scope.sh:127` sets `TRACK_B="security conventions"`, and `report.sh`
compares a run's `agents[]` against that roster as set equality, so a third name would make
every run print `PARTIAL COVERAGE` or `UNEXPECTED AGENT`.

Every agent writes its committed artifacts in English and returns its chat report in Ukrainian.

## How skills reach an agent

`skills:` in frontmatter **does** preload the full skill body, but only along the subagent
path — which is the only path a file in this folder ever runs on. Measured 2026-08-05 on Claude
Code 2.1.222, probing for the last checklist item of `onion-architecture/SKILL.md` and the exact
title of its §6, two facts with no path from the skill's name or description:

| How the agent ran | Result |
|---|---|
| `--agent probe`, as the session's **main** agent | `NOT PRELOADED` |
| dispatched as a **subagent**, `tools: ["WebSearch"]` only | both facts quoted verbatim |

The second probe held no filesystem tool, so it could not have read the file. That is why both
the 2026-08-04 result and this one are true: they measured different paths. Full record and
probe design: `INSIGHTS.md` § *`skills:` in agent frontmatter declares a role; it loads nothing*
and the **Correction, 2026-08-05** beneath it.

So the loading strategy is **hybrid** — preload only what an agent needs on *every* dispatch,
reach the rest through a *touching X → invoke Y* table in the body:

| Agent | `skills:` (preloaded) | Reached with `Skill` |
|---|---|---|
| `test-writer` | none — the field is absent | `react-testing-library` · `fastify-best-practices` · `drizzle-orm-patterns` · `onion-architecture` |
| `architecture-reviewer` | none | `onion-architecture` for `server/` · `frontend-architecture` for `client/` |
| `plan-verifier` | none, **and no `Skill` tool** | _none — it cannot invoke one_ |
| `doc-writer` | `mermaid-diagram` | `onion-architecture` · `frontend-architecture` |

`planner.md` and `implementer.md` predate this measurement: both declare eight or nine skills
and both bodies tell the agent to call `Skill` on each anyway. That still works — it costs a
redundant load, not a wrong answer — and rewriting them was out of scope for the change that
measured this.

---

## planner

**Responsibility.** Reads the repo's own documentation before proposing a step, then writes one
Development Plan: modules touched, constraints with the file that mandates each, numbered steps,
tests, gates, risks already recorded in `INSIGHTS.md`, rejected alternatives, acceptance
criteria. It does not write code and does not validate the plan by executing it.

**Permissions.** `tools: Read, Grep, Glob, Bash, Skill, Write, Edit`. `Agent`, `WebSearch` and
`WebFetch` are absent, so a subagent and a URL are both out of reach. `Bash` is granted for
reading only (`git log`, `git show`, `git blame`, `rg`, `ls`) — the ban on writes, package
installs and any `pnpm`/`npm` script is a rule in the body, not a wall.

**Skills declared.** `onion-architecture`, `frontend-architecture`, `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design`, `next-best-practices`, `zod`, `security` —
plus `react-best-practices` and `mermaid-diagram` when the shape of the work calls for them.

| | |
|---|---|
| **In** | A request in natural language; optionally a `researcher` report |
| **Out** | `specs/NN-topic.md`, or `<module>/specs/NN-topic.md` when the work stays in one package |
| | one appended row in that folder's `README.md` table, status `Planned <date>` |
| | a Ukrainian report — what was planned, the path, scope, skills, risks, open questions |
| **Never** | code, `AGENTS.md`, `INSIGHTS.md`, `docs/`, `vendor/**`, `e2e/specs/*.flow.json`, another agent's plan, the status `Implemented` |
| **Blocked** | returns the clarification block as its whole output and stops, with no plan written |

### Where its rules come from

| Rule | Source |
|---|---|
| A plan *is* a spec: location, `NN-`/`LNN-` naming, "finished when someone else could implement it without asking you questions", do not rewrite it later | [`specs/README.md`](../../specs/README.md) |
| Pointers to skills, never their bodies, in the plan | [`specs/L01-context-layering.md:29`](../../specs/L01-context-layering.md) — "No `@import`. Imports are eager … Pointers only." |
| The reading order `AGENTS.md` → `<module>/AGENTS.md` → `INSIGHTS.md` → `specs/` → `docs/` → code | [`AGENTS.md`](../../AGENTS.md) § *Read when* |
| Vendored `shared` is one contract in two copies, server copy first; `reviewer-core` is raw TS source; generated skill files; pinned `skills-lock.json`; deliberately empty tables; `e2e/specs/` is live tests | [`AGENTS.md`](../../AGENTS.md) §§ *Non-default conventions*, *Do not touch* |
| The `## Gates` section, copied verbatim | [`.claude/skills/pr-self-review/gates.md`](../skills/pr-self-review/gates.md) |
| Ask by ending the turn — the clarification block is the whole output | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |
| `specs/` over a new `docs/plans/`; English file, Ukrainian report | `INSIGHTS.md` § *A Development Plan in this repo is a spec, and `specs/` already defines it* |
| Name the skills, do not carry them | `INSIGHTS.md` § *The planner points at skills; it does not carry them* |
| Its body's "`skills:` preloads nothing — call `Skill` for each" | `INSIGHTS.md` § *`skills:` … it loads nothing*, as measured 2026-08-04. See § *How skills reach an agent* above: the claim holds for the main-agent path, not the dispatch path |
| Which limits are enforced and which are kept | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |

---

## implementer

**Responsibility.** Executes one already-approved plan: writes the code, invokes the skills the
plan's table names, runs the touched modules' gates and pastes their real output, records what
the session learned, and stops at the plan's boundary. It does not design, does not review, does
not commit.

**Permissions.** `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`. `Agent`, `WebSearch` and
`WebFetch` are absent — a question the plan cannot answer is reported, not researched. `Bash` is
full: the bans on `git commit`/`push`, `gh pr create`, `pnpm arch:baseline` and
`PR_SELF_REVIEW_SKIP=1` are rules it keeps. The one real wall is the push hook.

**Skills declared.** `engineering-insights`, `onion-architecture`, `frontend-architecture`,
`fastify-best-practices`, `drizzle-orm-patterns`, `react-best-practices`, `next-best-practices`,
`zod`, `security` — plus `react-testing-library`, `postgresql-table-design` and
`typescript-expert` when a step is genuinely about them. `pr-self-review` is never its own to
invoke: it spawns the subagents that judge this stage's output.

| | |
|---|---|
| **In** | a path to a plan under `specs/` or `<module>/specs/` — nothing else, no conversation |
| **Out** | code and tests in the modules the plan names |
| | an appended entry in the relevant module's `INSIGHTS.md`, via `engineering-insights` |
| | `Planned <date>` → `Implemented <date>` in the plan folder's `README.md`, once gates pass |
| | a Ukrainian report: steps ✅/⚠️/⛔, changed files, skills actually loaded, a gates table with real output, deviations, what it left to the human |
| **Never** | a commit, a push, a PR, `/pr-self-review`, work the plan's `## Out of scope` excludes, the plan text itself |
| **Blocked** | returns «Не можу виконати план» with the contradiction named, having written no code |

### Where its rules come from

| Rule | Source |
|---|---|
| The push wall, the `PR_SELF_REVIEW_SKIP=1` escape hatch and its recorded bypass | [`.claude/settings.json`](../settings.json) → `scripts/pr-self-review/gate.sh`; [`AGENTS.md`](../../AGENTS.md) § *A push is gated* |
| The per-module gate table and the `--exclude` form of the unit run | [`.claude/skills/pr-self-review/gates.md`](../skills/pr-self-review/gates.md); [`AGENTS.md`](../../AGENTS.md) § *Commands* |
| Never re-baseline; move the code, then narrow the rule | [`.claude/skills/onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) §2 |
| `diff -r` the two `vendor/shared` copies, server first | [`AGENTS.md`](../../AGENTS.md) § *Non-default conventions*; `gates.md` § `repo · vendor` |
| Generated files, pinned skills, `CLAUDE.md` symlinks, `e2e/specs/*.flow.json` | [`AGENTS.md`](../../AGENTS.md) § *Do not touch* |
| Manual module registration, `SecretsProvider` over `process.env`, migrations not on boot | [`server/AGENTS.md`](../../server/AGENTS.md); [`server/README.md`](../../server/README.md) |
| TanStack Query hooks over `fetch` in a component; responsive rules in `app/globals.css` | [`client/AGENTS.md`](../../client/AGENTS.md) |
| `reviewer-core` has two runtime deps and emits no JS | [`reviewer-core/AGENTS.md`](../../reviewer-core/AGENTS.md) |
| The `*.it.test.ts` suffix and the unit/integration split | [`TESTING.md`](../../TESTING.md) |
| `engineering-insights` before reporting complete | [`AGENTS.md`](../../AGENTS.md) § *Read when* |
| Reporting that `.claude/agents/**` trips no gate rather than implying one ran | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* (closing paragraph) |
| Its body's "`skills:` preloads nothing" | `INSIGHTS.md` § *`skills:` … it loads nothing*, 2026-08-04 — see § *How skills reach an agent* for why that holds for its own path and not for a dispatched subagent |

---

## researcher

**Responsibility.** Two kinds of question — how something works here, and what the outside world
says about a technology — answered so a reader can check every claim without trusting the agent.
Findings and evidence stay in separate sections, each finding is labelled
висока/середня/низька, and «Чого знайти не вдалося» is never omitted.

**Permissions.** `tools: Read, Grep, Glob, Bash, WebSearch, WebFetch`. No `Write`, no `Edit`, no
`Agent` — those are enforced by omission. `Bash` is granted for reading and the write commands
are banned in the body.

**Skills declared.** _None._ It has no `Skill` tool, and it is the precedent the three new
read-only agents follow.

| | |
|---|---|
| **In** | a question, with the repository/outside-world split either stated or inferable |
| **Out** | a Ukrainian report only. Nothing on disk, nothing proposed as a code change |
| **Blocked** | returns the clarification block as its whole output, having researched nothing |

Its report headings are Ukrainian on purpose — they are strings the agent emits, not prose about
the agent. See `INSIGHTS.md` § *`.claude/agents/researcher.md` is an English file with Ukrainian
headings on purpose*.

---

## test-writer

**Responsibility.** Writes tests for code that already shipped without them, across five lanes:
colocated client tests, the server's hermetic unit lane, its `*.it.test.ts` integration lane,
`reviewer-core`, and `e2e/specs/*.flow.json`. Every new test is proved able to fail before it is
left green. Expected values come from the Zod contract, the API map or the plan — never from
reading the implementation — so a mismatch between code and contract is a finding it reports
rather than a test it writes.

**Permissions.** `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`. `Agent`, `WebSearch` and
`WebFetch` are absent, so subagents and the web are enforced out of reach. `Edit` and `Write`
are unrestricted, which makes the boundary around `src/` a **rule**; the body says so in those
words. Rule 1 is its one declared hole, and it closes with `git diff --exit-code`.

**Skills declared.** _None — the field is absent entirely._ Four skills are reached with
`Skill`, one per kind of test: `react-testing-library`, `fastify-best-practices`,
`drizzle-orm-patterns`, and `onion-architecture` for the ring→lane decision. An agent whose
lanes each want a different skill preloads none of them.

| | |
|---|---|
| **In** | what to cover — a file, a module, a component, a class of regression |
| **Out** | test files, in the lane the ring dictates |
| | a Ukrainian report: what was covered, where it went, the mutation proof, findings in production code, a gates table with real output, and what was deliberately left uncovered |
| **Never** | an edit to `src/` that survives its turn, a deleted or `skip`ped test, a weakened assertion, a coverage target, a new test dependency, a vitest/tsconfig alias change, a commit |
| **Blocked** | returns the clarification block as its whole output, having written no test |

### Where its rules come from

| Rule | Source |
|---|---|
| The five lanes, their file locations and their exact commands | [`TESTING.md`](../../TESTING.md); [`AGENTS.md`](../../AGENTS.md) § *Commands*; [`gates.md`](../skills/pr-self-review/gates.md) |
| `*.it.test.ts` is what keeps a DB-backed test out of the unit lane | [`server/AGENTS.md`](../../server/AGENTS.md) § *Tests*; [`testing-the-rings.md`](../skills/onion-architecture/testing-the-rings.md) §1 |
| Which ring gets which test, and what not to test at all | `testing-the-rings.md` §1–3, §6 |
| Unique fixtures over transaction rollback; the `hasDocker` self-skip guard | `testing-the-rings.md` §5; the existing `server/test/*.it.test.ts` files |
| Assert on the return, not the mock; `buildApp({ overrides })` instead of `vi.mock` | `testing-the-rings.md` §4; [`onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) §3.4 — a port is not finished until `adapters/mocks.ts` implements it |
| `fireEvent` and per-test `fetch` mocking, against the skill's `userEvent`/`msw` advice | [`react-testing-library/SKILL.md`](../skills/react-testing-library/SKILL.md) `:41` and `:269`, overruled by [`client/AGENTS.md:35`](../../client/AGENTS.md) and `client/package.json` |
| Mutate → run red → revert → `git diff --exit-code` | [`specs/04-agents-for-tests-review-and-docs.md`](../../specs/04-agents-for-tests-review-and-docs.md) § *Decisions* — "A test never seen red proves only that it runs" |
| The `e2e/specs/*.flow.json` exception, and that the gate still flags it `major` | [`AGENTS.md`](../../AGENTS.md) § *Do not touch*; [`scope.sh:117-118`](../../scripts/pr-self-review/scope.sh) |
| Never `pnpm arch:baseline` | `onion-architecture/SKILL.md` §2 |
| Generated files, pinned skills, `CLAUDE.md` symlinks, vendored copies | [`AGENTS.md`](../../AGENTS.md) § *Do not touch* |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |
| Why the `src/` boundary is worded as a rule and not a wall | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |

---

## architecture-reviewer

**Responsibility.** Reviews boundaries and nothing else: which ring code sits in, which way its
dependencies point, whether the shape of data crossing a boundary respects it, and where a
client file crosses the Server/Client line. It runs `pnpm arch` once to learn what the gate
already decided, then works only where the twelve rules cannot reach. Every finding carries a
second axis — `pre-existing` or `introduced` — so a reader can tell this branch's fault from
debt it walked past. It issues no verdict and blocks nothing.

**Permissions.** `tools: Read, Grep, Glob, Bash, Skill`. No `Write`, no `Edit` — enforced by
omission. `Agent`, `WebSearch` and `WebFetch` are absent too. But `Bash` is present, and
`sed -i`, `>` and `tee` write as well as `Edit` does, so the forbidden-command list in the body
is a **backstop** and the body uses that word.

**Skills declared.** _None._ Two are reached with `Skill`: `onion-architecture` when the target
includes `server/` or `reviewer-core/`, `frontend-architecture` when it includes `client/`.
`security` is deliberately not among them — an OWASP finding belongs to the Track B `security`
agent, and reporting one here means it reaches nobody who acts on it.

| | |
|---|---|
| **In** | a diff, a module, a package or a path — any target, not just what `scope.sh` routed |
| **Out** | a Ukrainian report only. Nothing on disk |
| | a findings table with severity, the `introduced`/`pre-existing` axis and a `path:line` per row; a checked-and-clean section; uncertain observations kept separate and uncounted |
| **Never** | a fix, a patch, a verdict or score, a re-report of the twelve `pnpm arch` rules or of anything already in the frozen baseline, `pnpm arch:baseline`, a padded findings table, an OWASP/style/performance/correctness finding, a proposal to join Track B |
| **Blocked** | returns the clarification block as its whole output, having reviewed nothing |

### Where its rules come from

| Rule | Source |
|---|---|
| The twelve rule names it must never re-report, each printing its own `comment` at the point of failure | [`server/.dependency-cruiser.cjs`](../../server/.dependency-cruiser.cjs) `:39, 52, 64, 73, 83, 92, 102, 116, 130, 146, 167, 177`; `gates.md` § `server · arch` |
| The frozen baseline only shrinks; escalate move → narrow with a reason → baseline deliberately | `onion-architecture/SKILL.md` §2; [`server/.dependency-cruiser-known-violations.json`](../../server/.dependency-cruiser-known-violations.json) |
| Ring placement, ports, the composition root, `*Row` never leaving its module, `reviewer-core`'s two runtime deps | `onion-architecture/SKILL.md` §1, §3, §5, §7 |
| Client placement, colocation and promotion, where state lives, the `'use client'` leaf rule | [`frontend-architecture/SKILL.md`](../skills/frontend-architecture/SKILL.md) § *The six principles*, § *Review checklist* |
| The three client checks it adds — `import 'server-only'`, serializable props, re-verified auth inside a Server Action | defined as the complement of that checklist in [`specs/04-agents-for-tests-review-and-docs.md`](../../specs/04-agents-for-tests-review-and-docs.md) Step 3 |
| The four-value severity enum | [`severity.md`](../skills/pr-self-review/severity.md) |
| It is not in `TRACK_B`, and why a third name breaks every run | [`scope.sh:127`](../../scripts/pr-self-review/scope.sh); `report.sh` coverage check |
| Read-only is a backstop, because `Bash` hands back what omission denied | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |

---

## plan-verifier

**Responsibility.** Answers one question item by item: did the thing the plan asked for actually
happen? It enumerates every step, criterion, test, gate and out-of-scope boundary **verbatim
before opening any code**, and that list is then fixed. Compound criteria are decomposed into one
row each during enumeration. Every row carries a `path:line` or output from a command it ran
itself; every `MET` survives an adversarial re-check; and the row count is compared against the
enumerated count before the report is returned.

**Permissions.** `tools: Read, Grep, Glob, Bash`. `Write`, `Edit`, `Skill`, `Agent`, `WebSearch`
and `WebFetch` are all absent — enforced. `Bash` is granted for reading plus the plan's own gate
and test commands, character for character; the forbidden-command list is a backstop, for the
same reason as above.

**Skills declared.** _None — it has no `Skill` tool_, and an agent with no `Skill` tool must not
declare `skills:`. That is also the right call for the role: every skill here teaches how code
*should* be written, and a verifier that loads one starts grading the code against the skill
instead of against the plan.

| | |
|---|---|
| **In** | a path to a plan under `specs/` or `<module>/specs/`, and optionally what to check it against |
| **Out** | a Ukrainian report only. Nothing on disk |
| | a stamp (HEAD sha, branch, clean/dirty tree), a count line, then one row per item: the item as written, a verdict, the evidence |
| **Never** | an edit, the `specs/README.md` status row, an edit to the plan, style/naming/refactor/performance/test-organisation opinions, advice the plan did not ask for, a manufactured `PARTIAL` |
| **Blocked** | returns the clarification block as its whole output, having verified nothing |

### Where its rules come from

| Rule | Source |
|---|---|
| What a plan is, and that a shipped spec is not rewritten to match the implementation | [`specs/README.md`](../../specs/README.md) |
| Both heading shapes it must handle | [`specs/03-pr-self-review-skill.md`](../../specs/03-pr-self-review-skill.md) `:90, 119, 366, 411, 440` (older) against `specs/04-…md` § *Steps* / *Gates* / *Acceptance criteria* (newer) |
| The compound criterion it cites, carrying five conditions in one bullet | `specs/03-pr-self-review-skill.md:444-448` |
| Stamping a report with what it verified against | [`.pr-self-review/latest.json`](../../scripts/pr-self-review/report.sh) keys `headSha` / `worktreeHash` / `generatedAt`; [`gate.sh:102-107`](../../scripts/pr-self-review/gate.sh) refusing a stale verdict |
| The status row belongs to whoever shipped the change, not to the grader | [`implementer.md`](implementer.md) § *Before you report complete*; [`planner.md`](planner.md) — "You never write `Implemented`" |
| `MET` / `PARTIAL` / `NOT_MET` / `NOT_VERIFIED` is a local convention, not a standard | stated as such in the body — no primary source publishes that enum |
| Read-only is a backstop, because `Bash` hands back what omission denied | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |
| An agent with no `Skill` tool must not declare `skills:` | [`researcher.md`](researcher.md) frontmatter, the precedent |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |

---

## doc-writer

**Responsibility.** Documents what has already shipped. It picks the mode with the Diátaxis
compass — action or cognition, acquisition or application — before writing a line, routes the
subject by how many packages it spans, grounds every technical claim in a file it opened or a
command it ran, draws a Mermaid diagram where the mechanism needs one, and registers the result
with one row in that folder's `README.md`. Where the code and the plan disagree, the code wins
and the disagreement goes in the report.

**Permissions.** `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`. `Agent`, `WebSearch` and
`WebFetch` are absent — enforced — so it cannot check what a library does today, and anything it
cannot ground in this repository is a gap it reports. `Edit` and `Write` are unrestricted, so the
two-files limit and the never-list in its body are rules.

**Skills declared.** `mermaid-diagram` — one, preloaded, because a document may always need a
diagram and its `examples.md` now carries templates drawn from this repo's own schema, ports and
routes. `onion-architecture` and `frontend-architecture` are reached with `Skill` when the
document explains server rings or client placement. `engineering-insights` is deliberately not
its own: that skill writes `INSIGHTS.md`, which doc-writer may not touch.

| | |
|---|---|
| **In** | a subject that has shipped — a plan, a diff, a module — and ideally the reader it is for |
| **Out** | one document under `docs/` or `<module>/docs/` |
| | one appended row in that folder's `README.md`, replacing the `Empty for now — …` line with a table header when the folder had none |
| | a Ukrainian report: what, where, why there, both compass answers, a grounding table, diagrams, divergence from the plan, what it did not document |
| **Never** | `AGENTS.md` or a `CLAUDE.md` symlink, `INSIGHTS.md`, `specs/**`, generated files (`plugins/*/skills/**`, `server/src/db/seed-skills.ts`, `docs/skills/*`, `docs/agent-prompts/*`), `vendor/**`, code or tests, a second document, two Diátaxis modes in one file |
| **Blocked** | returns the clarification block as its whole output, having written nothing |

### Where its rules come from

| Rule | Source |
|---|---|
| The two compass questions and the four modes they resolve to | diataxis.fr — the compass and its warning against mixing modes |
| Routing by how many packages the subject spans, and the per-folder contract | [`docs/README.md`](../../docs/README.md); [`server/docs/README.md`](../../server/docs/README.md), [`client/docs/README.md`](../../client/docs/README.md), [`reviewer-core/docs/README.md`](../../reviewer-core/docs/README.md), [`e2e/docs/README.md`](../../e2e/docs/README.md) |
| The `| File | What it covers |` table, and the `Empty for now — …` line the first document replaces | `docs/README.md` (the table) and the four module READMEs (the line) |
| Fenced ```mermaid blocks as the diagram convention, and the register to match | [`docs/architecture.md`](../../docs/architecture.md); [`server/README.md`](../../server/README.md) |
| Its preloaded skill, and that nothing else is preloaded | `INSIGHTS.md` § *`skills:` …* **Correction, 2026-08-05**; § *How skills reach an agent* above |
| Ring and placement vocabulary, so a document does not invent its own | `onion-architecture/SKILL.md`; `frontend-architecture/SKILL.md` |
| The never-write list: generated skill and prompt files, vendored copies, `CLAUDE.md` symlinks | [`AGENTS.md`](../../AGENTS.md) § *Do not touch*; [`docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md) |
| `INSIGHTS.md` belongs to another skill and is append-only | [`engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md) § *Append only* |
| No unreleased behaviour in the present tense; empty tables are deliberate | [`AGENTS.md`](../../AGENTS.md) § *Non-default conventions* |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |

---

## Editing an agent here

- **`tools:` is a whitelist** — anything absent is unavailable. Granting `Bash` undoes that for
  files, because `sed -i`, `>` and `tee` write as well as `Edit` does. The only boundary this
  repo actually enforces is the `PreToolUse` hook on `git push` and `gh pr create`; write the
  rest as rules, never as walls. An agent that finds one "wall" decorative cannot tell which of
  the others are real.
- **An agent with no `Skill` tool must not declare `skills:`.** The field would claim a
  capability the tool list denies, and a reader checking one against the other would find them
  disagreeing. `plan-verifier` is the example; `researcher.md` set the precedent by leaving the
  field out.
- **`skills:` preloads on the subagent path** (2026-08-05, Claude Code 2.1.222) and not on the
  main-agent path (2026-08-04, 2.1.221). See § *How skills reach an agent*. Declare only what
  the agent needs on **every** dispatch — a preloaded skill is paid for on every run whether it
  is opened or not — and give the body a *touching X → invoke Y* table for the rest. An agent
  that does not know it has to call `Skill` will not call it.
- **A subagent cannot hold a conversation.** Its final text is a return value; there is no second
  turn. Every "ask when unclear" rule has to be spelled as *emit the block and stop*, closing
  with the assumption it would take by default, so the reply can be one word.
- **The five skills under `plugins/api-contract-reviewer/` are not installed** — the `devdigest`
  marketplace is absent from `~/.claude/plugins/known_marketplaces.json`, so no agent can invoke
  them under any name.
- **English file, Ukrainian only where the text is a string the agent emits.**
- **No gate reads this folder.** `registry.sh` checks `.claude/skills/` and `skills-lock.json`
  only. Verify a change by dispatching the agent, and say plainly in any report that no check
  ran.

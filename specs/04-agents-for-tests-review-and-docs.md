# 04 — Four agents: test-writer, architecture-reviewer, plan-verifier, doc-writer

**Status:** Planned 2026-08-05
**Branch:** `feat/agent-layer`, cut from `main` so that every package gate reports `skip` and a
`/pr-self-review` run is about this change alone.
**Modules touched:** `.claude/agents/`, `.claude/skills/mermaid-diagram/`, `AGENTS.md` (via the
`CLAUDE.md` symlink), `INSIGHTS.md`. The four dispatch steps additionally create files under
`server/test/` and `server/docs/`.

## Problem

`.claude/agents/` holds three agents — `planner`, `implementer`, `researcher`. They cover design
and execution and nothing after code lands. No agent writes tests for code that shipped without
them, no agent reviews the boundaries a change crossed, no agent checks a finished change against
the plan that asked for it, and no agent turns shipped work into a document.

Four drafts of these agents existed in the working tree on 2026-08-05 and were deleted unread
before this document was written. The decision was to design from requirements rather than edit
someone else's draft. Nothing here is recovered from them.

Almost none of the deliverable is TypeScript: it is four subagent bodies, one skill topic file,
`AGENTS.md`, `INSIGHTS.md` and the agents folder's `README.md`. That shape is the main thing to
internalise, because the usual safety net — `pnpm arch`, `pnpm lint`, typecheck, vitest — does not
route to a single one of these files. **The change is proved by dispatching the agents, not by
running a suite.**

## What we are building

| Agent | Answers | Writes to disk | Model |
|---|---|---|---|
| `test-writer` | What regression can this code suffer that no test would catch? | test files in all four suites | opus |
| `architecture-reviewer` | Which boundary did this change cross, and does it still hold? | nothing | opus |
| `plan-verifier` | Did every item the plan asked for actually happen? | nothing | opus |
| `doc-writer` | What shipped, and where does the document describing it belong? | one document under `docs/` or `<module>/docs/`, one README row | sonnet |

## The shared contract

Every one of the four:

- Is a **dry tool**, not teaching material. Rules, prohibitions, and a report template. A rule
  carries a reason only where the rule looks wrong without one.
- Returns its **report in Ukrainian**. Every file it commits is **English**. The exception is a
  heading the agent emits verbatim into a Ukrainian report — those stay Cyrillic.
- Addresses every claim to a `path:line` or to pasted command output. A claim with neither is not
  a finding; it goes under what could not be established.
- Carries an explicit list of what it never reports and what it never does.
- Treats an **empty report as a valid result**. Nothing is invented to fill a template.
- May be dispatched by the main agent when the work calls for it, not only by a human.
- Spells a clarification as *emit the block as your entire output and stop*, closing with the
  reading it would take by default — a subagent cannot hold a conversation.

## The mechanism: how an agent gets a skill

`skills:` in frontmatter **does** preload the full skill body — but only along the subagent path.
Measured 2026-08-05 on Claude Code 2.1.222, probing for the last checklist item of
`onion-architecture/SKILL.md` and the exact title of its §6 — two facts with no path from the
skill's name or description:

| How the agent ran | Result |
|---|---|
| `--agent probe` (as the session's main agent) | `NOT PRELOADED` |
| dispatched as a subagent, `tools: ["WebSearch"]` only | both facts quoted verbatim |

The second probe held no filesystem tool, so it could not have read the file. `INSIGHTS.md`
records the opposite conclusion, measured 2026-08-04 on 2.1.221; that entry is wrong for the
subagent case, which is the only case `.claude/agents/*` ever runs in.

Given that preloading works, the loading strategy is **hybrid**: preload only what a given agent
needs on every single dispatch, and reach the rest through the `Skill` tool under a table of the
form *touching X → invoke Y*. An agent whose four suites each want a different skill preloads none
of them.

| Agent | `skills:` in frontmatter (preloaded) | Invoked through `Skill`, and when |
|---|---|---|
| `test-writer` | **none — the field is absent entirely** | `react-testing-library` before a client test · `fastify-best-practices` before a route test · `drizzle-orm-patterns` before a repository test · `onion-architecture` when deciding which ring a test belongs to |
| `architecture-reviewer` | **none** | `onion-architecture` for `server/` · `frontend-architecture` for `client/` |
| `plan-verifier` | **none, and no `Skill` tool** — `tools: Read, Grep, Glob, Bash` | _None._ It cannot invoke a skill and must not declare one |
| `doc-writer` | `mermaid-diagram` — a document may always need a diagram | `onion-architecture` when the document explains `server/` rings · `frontend-architecture` when it explains `client/` placement |

The four bodies must state their own row of this table explicitly. An agent that does not know it
has to call `Skill` will not call it.

## What already exists

| Path | What is there today |
|---|---|
| `.claude/agents/planner.md`, `implementer.md`, `researcher.md` | The three shipped agents. Frontmatter shape to copy: `name`, `description`, `tools`, optional `skills`, `model`, `color`. `researcher.md` is the precedent for an agent with no `skills:` field. |
| `.claude/agents/README.md` | **A leftover.** 344 lines, already containing full sections for all four new agents — written against the drafts that were deleted unread. It describes files that do not exist. Treat it as an artefact to replace, never as a source. Two of its claims are wrong: `:333-335` repeats "`skills:` loads nothing", and `:290` gives `doc-writer` three declared skills where this document asks for one. |
| `.claude/agents/**` in git | **Nothing.** `git ls-files .claude/` returns 135 files, none under `agents/`; the folder is not ignored. The whole agent layer is untracked, while the tracked `INSIGHTS.md:379` already cites `.claude/agents/researcher.md`. See `## Risks` §1. |
| `.claude/skills/mermaid-diagram/` | `examples.md`, 333 lines, "templates tailored to the Quick Blog stack (React + Express + MongoDB + JWT)"; `ObjectId` in the ER diagram (`:94-126`) and the class diagram (`:203-234`). `SKILL.md` names Express (`:90`), Mongoose (`:111`) and MongoDB (`:140`), and `:10` links to a `references.md` that does not exist. Absent from `skills-lock.json`, so ours to edit. |
| `AGENTS.md:83` | `- `e2e/specs/*.flow.json` — live browser-test scenarios, not documentation.` — the line AC 15 amends. `CLAUDE.md` is a symlink to it. |
| `INSIGHTS.md:592-605` | `### `skills:` in agent frontmatter declares a role; it loads nothing` — the entry AC 16 corrects. |
| `docs/architecture.md:11-48, 56-75` and `server/README.md:33, 64` | The repo's only real ```mermaid blocks. They are the register the rewritten `examples.md` should match. |
| `server/.dependency-cruiser.cjs` | The twelve rule names AC 10 needs, at `:39, 52, 64, 73, 83, 92, 102, 116, 130, 146, 167, 177`. |
| `.claude/skills/pr-self-review/gates.md` | The Track A commands, verbatim, reproduced in `## Gates`. |
| `.claude/skills/engineering-insights/SKILL.md` § *Append only* | "never rewrite or delete one… append a dated correction beneath it and leave the original standing". Governs Step 7. |

## Constraints

| Constraint | Source |
|---|---|
| Every committed file is English. The exception is a heading or label the agent **emits verbatim** into a Ukrainian report. | `INSIGHTS.md:379-386`; `researcher.md:110-133` as the shipped precedent |
| `CLAUDE.md` is a symlink to `AGENTS.md` in every folder that has both. Edit `AGENTS.md`; never replace the symlink. | `AGENTS.md:88-90` |
| `INSIGHTS.md` is append-only. A wrong entry gets a dated correction beneath it; the original stands. Precedents: `INSIGHTS.md:582`, `:147`. | `.claude/skills/engineering-insights/SKILL.md` § *Append only* |
| `tools:` is a whitelist and is enforced; everything else in a body is a rule the agent keeps, not a wall. The only enforced boundary is the `PreToolUse` hook on `git push` / `gh pr create`. A body must not phrase a rule as a wall. | `INSIGHTS.md:573-590`; `.claude/settings.json` |
| An agent with no `Skill` tool must not declare `skills:`. Applies to `plan-verifier`. | `researcher.md` frontmatter |
| A subagent cannot hold a conversation. "Ask when unclear" must be spelled as *emit the clarification block as your entire output and stop*, closing with the reading it would take by default. | `INSIGHTS.md:364-372` |
| Nothing registers an agent, and no gate reads `.claude/agents/**`. `registry.sh:19-20` reads `.claude/skills/` and `skills-lock.json` only. A body is verified by dispatching it. | `INSIGHTS.md:373-375`; `scripts/pr-self-review/registry.sh` |
| A body that restates a rule it does not own must be traceable, because nothing catches the drift. Every rule in a new body needs a row in that agent's *Where its rules come from* table. | `INSIGHTS.md:418-433` |
| `mermaid-diagram` is absent from `skills-lock.json`, so it is ours. Had it been pinned, `scope.sh:119-123` would raise a **critical** on any edit. Do not add a lock entry to silence the registry `note`. | `AGENTS.md:84-85`; `gates.md` § `repo · registry` |
| Do not touch: `server/src/vendor/**`, `client/src/vendor/**`, `server/clones/**`, `plugins/*/skills/**`, `server/src/db/seed-skills.ts`, any pinned skill. | `AGENTS.md:78-90` |
| `e2e/specs/*.flow.json` stays flagged `major` by `scope.sh:117-118` even after AC 15 lands. AC 15 changes the prose contract in `AGENTS.md`; it does not change the gate, and changing the gate is out of scope. | `scripts/pr-self-review/scope.sh:117-118` |
| The five skills under `plugins/api-contract-reviewer/` are **not installed** — the `devdigest` marketplace is absent from `~/.claude/plugins/known_marketplaces.json`. No new agent body may route a step to one. | `.claude/agents/README.md:339-341` |

## Skills the implementer must invoke

Pointers, not bodies. Each is loaded with the `Skill` tool **before** writing the step it governs.

| Step | Skill | Why |
|---|---|---|
| 1 | `mermaid-diagram` | The files being rewritten are its own. The rewrite must keep the Decision Guide and the section order `SKILL.md` links to. |
| 2 | `react-testing-library` | AC 8 requires `test-writer.md` to name this skill's advice and overrule it. Quote it correctly: `SKILL.md:269` reads `// User interaction — ALWAYS userEvent, NEVER fireEvent`, and `:41` installs `msw`. Do not paraphrase from memory. |
| 2, 3 | `onion-architecture` | `test-writer`'s ring→suite routing comes from `testing-the-rings.md`; `architecture-reviewer`'s server checklist from `SKILL.md` §1, §3, §5, §7 and its escalation order from §2. |
| 3 | `frontend-architecture` | `architecture-reviewer`'s client half. Its rule 3 is defined as *what this skill's own Review checklist omits* — read the checklist to know what is already in it. |
| 10 | `onion-architecture` § `testing-the-rings.md` | To judge whether the test `test-writer` produced landed in the right ring and the right suite. |
| 7, 14 | `engineering-insights` | Owns `INSIGHTS.md`: which file, which section, the entry format, and the append-only rule that decides how AC 16 is satisfied. Also run at wrap-up. |
| 15 | `pr-self-review` | Only if the work is pushed. `--gates` is enough for a push. |

Deliberately absent: `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
`next-best-practices`, `zod`, `security`. No route, query, table, App Router file, contract or auth
path is touched. `test-writer`'s body *names* three of them in its on-demand table — naming a skill
does not require loading it.

## Steps

Steps 1–9 are the deliverable; 10–13 are the four dispatches AC 18 requires; 14–15 close the work.
Order is load-bearing in one place: **Step 1 precedes Steps 5 and 13** — `mermaid-diagram` is
rewritten against this stack *before* `doc-writer` preloads it and before `doc-writer` is
dispatched.

### 1. Rewrite `.claude/skills/mermaid-diagram/` against this stack

**Files:** `examples.md` (333 lines, replaced wholesale) and the three stack-specific lines in
`SKILL.md` (`:90` Express, `:111` Mongoose, `:140` MongoDB), plus the dangling `references.md`
link at `SKILL.md:10`.

Keep the files' job — ready-to-use templates, one per diagram type, in the order the Decision
Guide introduces them. Replace every subject with one from this repo, so that a preloaded template
is a head start rather than a misdirection:

- **flowchart** — a real branching process: PR import through repo-intel, or the `scope.sh`
  classification (`routed` / `checklist` / `skipped` / `flagged`).
- **sequence** — a Fastify request through `routes → service → repository`.
  `docs/architecture.md:56-75` is the shipped example of this shape; write a *different* one.
- **ER** — real Drizzle/Postgres tables from `server/src/db/schema/*.ts`, with Postgres types
  (`text`, `timestamptz`, `jsonb`, `uuid`, `vector`). No `ObjectId`, no `string _id`.
- **state** — a status machine that exists: `server/src/modules/pulls/status.ts`.
- **class** — ports and their adapters (`server/src/vendor/shared/adapters.ts`), not ORM models.
- **gantt / pie / mindmap** — keep only if the subject is real. The "OWASP Vulnerability
  Distribution" pie at `examples.md:319-333` belongs to another skill's demo app; drop or replace it.

Either point `SKILL.md:10` at a file that exists or drop the link. Do not create `references.md`
to satisfy it.

**Check:** `rg -i -n 'objectid|mongo|mongoose|express|multer|bcrypt' .claude/skills/mermaid-diagram/`
returns nothing. Every fenced block opens with ```` ```mermaid ````. `SKILL.md` stays under the
500-line cap `registry.sh` enforces. Closes **AC 14**.

### 2. Write `.claude/agents/test-writer.md`

Frontmatter: `name: test-writer`, a `description` that says when to dispatch it,
`tools: Read, Grep, Glob, Edit, Write, Bash, Skill`, `model: opus`, a `color`, and **no `skills:`
field at all** (AC 1).

The body carries, at minimum:

1. **Suites.** All four: `client` (RTL + jsdom), `server-unit`, `server-integration`
   (`*.it.test.ts`, testcontainers Postgres), `reviewer-core`, **and `e2e` browser flows** — with
   the `e2e/specs/*.flow.json` exception in the same words Step 6 puts in `AGENTS.md`.
2. **The on-demand skill table**, phrased as *touching X → invoke Y*, plus the instruction to call
   `Skill` — nothing is preloaded.
3. **Rule 1 — prove the test can fail.** Mutate the covered code, run the suite, confirm red,
   revert. The report shows `git diff --exit-code` on the mutated path as proof the tree is clean.
   State it as the one declared, bounded exception to the `src/` ban, and say why: a green test
   nobody has seen fail measures nothing. (**AC 7**)
4. **Rule 2 — the code is not the oracle.** The expected value comes from the Zod schema, the
   contract or the plan. Where the code and the contract disagree, that is a finding, not a test.
5. **Rule 3 — isolate integration data with unique fixtures, not transaction rollback**, because
   rollback breaks for code that manages its own transactions, and unique fixtures are already what
   `server/test/conventions.it.test.ts` does.
6. **Rule 4 — assert on what came back, not on how a mock was called.** `app.inject()`'s response,
   not the payload handed to a mock — except at a real port in `adapters/mocks.ts`, where the
   interface *is* the architecture.
7. **Rule 5 — the repo beats the skill.** Name `fireEvent` and `fetch` mocking explicitly:
   `react-testing-library/SKILL.md:269` says *ALWAYS userEvent, NEVER fireEvent* and `:41` installs
   `msw`; this repo uses `fireEvent` in 25 client test files, ships neither package, and
   `client/AGENTS.md:42` mandates mocking `fetch` per test. The agent follows the repo, and is told
   so by name so it does not discover the contradiction mid-run. (**AC 8**)
8. **Never.** Edits `src/` to make a test pass — a test that fails because the product is wrong is
   a finding it reports. Deletes or skips an existing test. Chases a coverage number. (**AC 6**)
9. **A report template**, Ukrainian headings, the empty-report-is-valid rule, and a closing
   *what I did not cover* section that is never omitted. (**AC 5**)
10. The shared contract, including the clarification-ends-the-turn rule.

**Check:** `rg -n '^skills:' .claude/agents/test-writer.md` returns nothing;
`rg -n 'git diff --exit-code|fireEvent|fetch' .claude/agents/test-writer.md` hits all three.
Closes **AC 1, 5, 6, 7, 8**.

### 3. Write `.claude/agents/architecture-reviewer.md`

Frontmatter: `tools: Read, Grep, Glob, Bash, Skill` — **no `Write`, no `Edit`** (AC 2);
`model: opus`; no `skills:` field.

Body:

1. **Subject.** Boundaries only. Not correctness, not style, not security — an OWASP finding
   belongs to the Track B `security` agent.
2. **On-demand skills:** `onion-architecture` for `server/`, `frontend-architecture` for `client/`.
3. **Rule 1 — severity gains a second axis: `pre-existing` or `introduced`.** Without it a reader
   cannot tell whether a finding is this branch's fault or debt it walked past.
4. **Rule 2 — a finding names the rule it violates.** Not a preference. Uncertain observations go
   in their own section and are not counted as findings.
5. **Rule 3 — the client checklist covers what `frontend-architecture`'s own checklist omits:**
   `import 'server-only'`, serializable props across the Server/Client boundary, and re-verifying
   authentication and resource ownership inside every Server Action. None are used in `client/`
   today, which is exactly why they are the first things to break.
6. **Never re-report any of the twelve rules `pnpm arch` already decides** — by name (**AC 10**):
   `no-db-from-routes`, `no-sql-outside-repository`, `no-fastify-outside-http`,
   `no-adapter-to-module`, `no-adapter-to-bootstrap`, `no-service-to-adapter-impl`,
   `no-fs-in-service`, `core-stays-pure`, `contracts-stay-pure`, `no-cross-module`, `no-circular`,
   `not-to-dev-dep`. Add: never `pnpm arch:baseline` — the baseline only shrinks.
7. **Never propose adding itself to Track B.** `scope.sh:127` pins `TRACK_B="security conventions"`
   and `report.sh` compares a run's roster as set equality, so a third name makes every run print
   `PARTIAL COVERAGE` or `UNEXPECTED AGENT`. (**AC 6**)
8. **A report template** with a findings table carrying severity, the `pre-existing`/`introduced`
   axis, and a `path:line` on every row; a section for what was checked and found clean; and the
   empty-report-is-valid rule. (**AC 5, 9**)

The read-only claim is worded as a **backstop**, not a wall: `Bash` is present, and `sed -i`, `>`
and `tee` write as well as `Edit` does.

**Check:** `rg -n '^tools:' .claude/agents/architecture-reviewer.md` shows neither `Write` nor
`Edit`; all twelve rule names appear. Closes **AC 2, 5, 6, 9, 10**.

### 4. Write `.claude/agents/plan-verifier.md`

Frontmatter: `tools: Read, Grep, Glob, Bash` — no `Write`, no `Edit` (AC 3), and **no `skills:`
field**, because it has no `Skill` tool; `model: opus`.

Body:

1. **Protocol.** Enumerate every item verbatim **before reading any code**; that list is then
   fixed. Then: one item, one search, one verdict, one piece of evidence.
2. **Rule 1 — decompose compound criteria before judging.** `specs/03-pr-self-review-skill.md:444-448`
   is one acceptance bullet carrying five conditions; each gets its own row and its own verdict.
   Partial satisfaction of a compound criterion is the leading documented way to game a
   rubric-based verifier. (**AC 11**)
3. **Rule 2 — stamp the report with what it verified against:** the commit SHA and whether the
   working tree was dirty. The repo already solved this for `pr-self-review` with
   `headSha` / `worktreeHash` / `generatedAt`; a chat report pasted into a PR a day later carries
   no such marker.
4. **Rule 3 — a self-declared "done" is not evidence.** Not a commit message, not an `Implemented`
   row in a README table, not an `INSIGHTS.md` entry. Only code and command output.
5. **Rule 4 — count before returning.** N items enumerated must produce N rows. State it as a
   mechanical step, because the failure it catches — the tail of a long list quietly dropped — does
   not look like a failure. (**AC 12**)
6. **Rule 5 — adversarially re-check every `MET`.** Try to refute it; if uncertain, it is not `MET`.
7. **Rule 6 — read the headings that exist.** Committed plans use `## Problem` / `## Approach` /
   `## Acceptance`; this document uses `## Steps` / `## Gates` / `## Acceptance criteria`. Handle
   both, and report a missing criteria section as a finding *about the plan*. `specs/README.md`
   forbids rewriting a shipped spec to match what was built, so the old plans stay as they are.
8. **Never.** Reports style, refactoring, performance or test organisation. Updates the status row
   in `specs/README.md` — an agent that both grades and records the grade is marking its own
   homework. (**AC 6**)
9. **A report template**: one row per item — the item as written, a verdict, the evidence — plus
   the verdict enum, stated as a local convention rather than a standard.

The read-only claim is a backstop for the same reason as in Step 3.

**Check:** `rg -n '^tools:|^skills:' .claude/agents/plan-verifier.md` shows a `tools:` line without
`Write`/`Edit`/`Skill`, and no `skills:` line at all. Closes **AC 3, 5, 6, 11, 12**.

### 5. Write `.claude/agents/doc-writer.md` — after Step 1

Frontmatter: `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`, `model: sonnet`, and
`skills: mermaid-diagram` (**AC 4**).

Body:

1. **Rule 1 — choose the mode with the Diátaxis compass, not a table.** Two questions — action or
   cognition, acquisition or application — resolve to exactly one of tutorial, how-to, reference,
   explanation. Mixing modes in one document is the single most common documentation failure.
   State the compass as the procedure. (**AC 13**)
2. **Routing.** Spans more than one package → `docs/`. Confined to one → `<module>/docs/`.
3. **Rule 2 — the code is the fact; the plan is the intent.** A step the plan described but that
   never shipped is not a paragraph. Where they disagree the code wins and the disagreement goes in
   the report.
4. **Rule 3 — do not write a guide to someone else's technology; link to it.**
5. **Rule 4 — register the document.** `docs/README.md` already has a `| File | What it covers |`
   table and takes one appended row. All four module `docs/README.md` files instead end with
   `Empty for now — …`; the first document in such a folder **replaces that line** with the table
   header and its own row.
6. **What it loads:** `mermaid-diagram` is preloaded; `onion-architecture` and
   `frontend-architecture` are invoked with `Skill` when the document explains server rings or
   client placement. Say that nothing else is preloaded, so the agent knows what it must fetch.
7. **Never.** Writes `AGENTS.md` or a `CLAUDE.md` symlink, `INSIGHTS.md`, anything under `specs/`,
   generated skill or prompt files (`plugins/*/skills/**`, `server/src/db/seed-skills.ts`,
   `docs/skills/*`), vendored copies, or code. (**AC 6**)
8. **A report template** with where the document went and why there, the mode chosen, a grounding
   table, and what it did not document. (**AC 5**)

**Check:** `rg -n '^skills:' .claude/agents/doc-writer.md` → `skills: mermaid-diagram`.
Closes **AC 4, 5, 6, 13**.

### 6. Record the `e2e/specs/*.flow.json` exception in `AGENTS.md`

**File:** `AGENTS.md` — the `## Do not touch` entry at `:83`. Edit `AGENTS.md`, never `CLAUDE.md`.

Amend the line so it still forbids the general case and names the one exception: `test-writer` may
write `e2e/specs/*.flow.json` when it is writing an e2e flow, because that suite is one of the four
it covers. Keep it to one or two lines — this file is a routing document.

State plainly that the gate is unchanged: `scope.sh:117-118` still flags any
`e2e/specs/*.flow.json` in a diff as `major` with *"confirm the change was deliberate"*, which is
now exactly the right prompt rather than a contradiction.

**Check:** `rg -n 'e2e/specs' AGENTS.md` shows the exception and names `test-writer`.
Closes **AC 15**.

### 7. Correct the `skills:` entry in `INSIGHTS.md`

**File:** `INSIGHTS.md`, beneath the existing paragraph ending at `:605`.

**Append a dated correction; do not rewrite the entry and do not change its heading.**
`engineering-insights` § *Append only* is explicit, and the file carries two precedents for the
form (`:582` `**Addition, 2026-08-04.**`, `:147` `**Correction, 2026-07-28.**`).

The correction states, in the entry's own register:

- Measured 2026-08-05 on Claude Code **2.1.222**, probing for the last checklist item of
  `onion-architecture/SKILL.md` and the exact title of its §6 — two facts with no path from the
  skill's name or description (the probe design is `INSIGHTS.md:279-296`).
- `--agent probe`, running as the session's **main** agent → `NOT PRELOADED`.
- Dispatched as a **subagent** with `tools: ["WebSearch"]` only → both facts quoted verbatim. That
  probe held no filesystem tool, so it could not have read the file.
- Therefore the 2026-08-04 conclusion is wrong for the subagent case, which is the only case
  `.claude/agents/*` ever runs in. Preloading is real there, and the hybrid strategy above depends
  on it.

**Check:** the original entry is byte-identical to `HEAD` and is followed by the 2026-08-05
correction. Closes **AC 16**.

### 8. Rewrite `.claude/agents/README.md` as the map of all seven agents

Derive **every row from the four bodies as they now exist on disk**, not from the leftover text.
Open each new file and read its frontmatter and its never-list while writing the row.

Must change, at minimum:

- `:20` — `test-writer`'s "writes to disk" column omits `e2e/`. It covers four suites and the flow
  files.
- `:165-169`, `:209-212`, `:290-292` — the *Skills declared* paragraphs describe the deleted
  drafts. Replace with the preload/on-demand table above.
- `:333-335` — "**`skills:` loads nothing** on Claude Code 2.1.221 (measured 2026-08-04)". Replace
  with the 2026-08-05 subagent measurement and the main-agent/subagent distinction that explains
  both results. Point at the corrected `INSIGHTS.md` entry.
- Each new agent keeps a *Where its rules come from* table. A rule with no source row is a rule
  nobody will know to re-check when its source moves.

Keep what is still true: the *Nothing registers an agent* paragraph at `:8-11`, the pipeline order
at `:25-28`, the Track B warning at `:30-34`, and the *Editing an agent here* section — minus its
stale `skills:` bullet.

**Check:** all seven agents appear in the table, each links to a file that exists, and for each of
the four new ones the README's `tools:` / `skills:` description matches the real frontmatter.
Closes **AC 17**.

### 9. Confirm the four agents are dispatchable from this session

**Answered 2026-08-05: no restart is needed.** The four agent types became available to the running
session as soon as the files were written — the session announced them itself, without being asked
and without Steps 10–13 having started. The same session had earlier *lost* the four types when the
draft files were deleted, so the discovery runs in both directions and is not a one-way cache.

Measured on Claude Code 2.1.222, in a session that began before `.claude/agents/` contained any of
the four. The fallback that was planned for this step — write the files, start a fresh session, run
the dispatches there — is not needed and is left here only so the next reader knows it was
considered.

Step 14 records this; it is the entry `INSIGHTS.md` did not have.

### 10. Dispatch `test-writer` at the agents DTO mappers

**Target:** `server/src/modules/agents/helpers.ts` — `toAgentDto`, `toAgentVersionDto`,
`isConfigChange`.

**Retargeted 2026-08-05.** The original target was `server/src/modules/conventions/helpers.ts`,
which does not exist on `feat/agent-layer`: the conventions slice lives unmerged on
`feat/conventions-extractor`, and this branch was cut from `main` so that the gate report is about
this change alone. The replacement is structurally identical — uncovered DTO mappers, Core ring,
Zod oracle — so the reasoning below is the original reasoning with the paths corrected.

**Why this target is showing:** none of the three appears anywhere under `server/test/`, so the gap
is real, narrow and current. All are Core-ring pure functions, so the suite is `server-unit` —
hermetic, no Docker. The oracle is the Zod contract, not the function: `Agent` at
`server/src/vendor/shared/contracts/knowledge.ts:185` and `AgentVersion` at `:227`. That exercises
rule 2 with teeth — `toAgentDto:17` widens a database column with `row.provider as Provider`, and a
cast is exactly where the code and the contract are free to disagree; if they do, the agent must
report a finding rather than write a test that blesses today's output. Rule 1's mutate-run-revert
on a pure mapper is one line and one suite run.

**Check:** the report quotes `git diff --exit-code` output for the mutated path; the new test fails
when the mapper is mutated and passes when it is not;
`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` is green.

### 11. Dispatch `architecture-reviewer` at the agents slice

**Target:** `server/src/modules/agents/{routes,service,repository,helpers,constants}.ts` with
`client/src/app/agents/**` and `client/src/lib/hooks/agents.ts`.

**Retargeted 2026-08-05,** for the reason given in Step 10 — the conventions slice is not on this
branch.

**Why this target is showing:** it crosses every ring inside one module *and* both packages, so a
single dispatch exercises both `onion-architecture` and `frontend-architecture`. It is **green
under the twelve rules** — `pnpm arch` passes — so the agent cannot harvest easy violations and
must work where the rules cannot reach, which is the entire point of the "never re-report what
`pnpm arch` decides" prohibition. Unlike the original target it is not obviously clean at the
altitude the rules cannot see: `service.ts:55` is `constructor(private container: Container)`,
where `onion-architecture` §3.3 asks for the repository as a parameter. Whether that is a finding
is the reviewer's judgement, not this document's — it is named here only to show the target has
something to bite on. An empty findings table is still a valid outcome and must not be padded.

**Check:** no finding restates one of the twelve rule names; every finding carries a `path:line`
and the rule it violates; the report separates `pre-existing` from `introduced`, and uncertain
observations sit in their own section. Nothing was written to disk.

### 12. Dispatch `plan-verifier` at `specs/03-pr-self-review-skill.md`

**Why this target is showing:** its headings are `## Problem` (`:90`), `## Approach` (`:119`),
`## Decisions and their alternatives` (`:366`), `## Known weakness` (`:411`), `## Acceptance`
(`:440`) — the *old* format, so rule 6 is exercised for real rather than hypothetically. Its
acceptance bullet at `:444-448` carries five conditions in one sentence, which is the exact
compound criterion rule 1 cites. And everything it claims is verifiable from files on disk, so the
evidence is cheap and a reader can re-check it.

**Check:** the number of rows equals the number of enumerated items, and the five conditions of
`:444-448` appear as five separate rows; every row carries a `path:line` or pasted command output;
the report is stamped with the HEAD SHA and whether the tree was dirty; `specs/README.md` is
untouched.

### 13. Dispatch `doc-writer` at the skill prompt-injection check — after Step 1

**Target:** how a skill body is checked for prompt injection on import and what the API does with a
hostile one — `server/src/platform/skill-injection.ts` (`detectInjection`), its callers at
`server/src/modules/skills/service.ts:114` and `:154-158` and
`server/src/modules/skills/helpers.ts:70`, proven by `server/test/skill-injection.test.ts`
(commits `02773b5`, `181d489`).

**Why this target is showing:** the mechanism is confined to `server/`, so the routing rule sends it
to `server/docs/` — whose `README.md` currently ends with `Empty for now — the first
server-specific design note goes here.` That is the branch of rule 4 that nothing has ever
exercised. It needs a diagram (import → detect → store disabled → refuse enable), which is what
makes the freshly rewritten `mermaid-diagram` examples matter. And it is code-grounded: the rules
live in code and a test pins them, so rule 2 has something to bite on.

**The document stays** if it earns its place; it is read before that is decided. If it does not, it
is reverted *after* the report is quoted, and the revert is stated in the summary — not deleted
quietly.

**Check:** exactly one new file under `server/docs/`; `server/docs/README.md` no longer contains
`Empty for now` and has a `| File | What it covers |` header plus one row; the document is in a
single Diátaxis mode and the report names which; every ```mermaid block renders;
`AGENTS.md`, `INSIGHTS.md` and `specs/**` are untouched.

### 14. Capture what the session learned

**File:** the root `INSIGHTS.md`. Append under the section each belongs to, never a new section:

- The Step 9 result: whether a just-written agent was dispatchable from the running session.
  Whichever way it went, it is a fact nobody has recorded and everybody will need.
- Anything the four dispatches taught about the bodies themselves — a rule that turned out
  unactionable, a report template section that came back empty every time.

### 15. Land it as one commit

The whole agent layer is untracked today. Stage `.claude/agents/**` — all seven files, including
`planner.md`, `implementer.md` and `researcher.md` — with `.claude/skills/mermaid-diagram/`,
`AGENTS.md`, `INSIGHTS.md`, this document, `specs/README.md`, and whatever Steps 10 and 13
produced.

**Check, before committing:** every path the staged documents name resolves in the **index**, not
the working tree —

```sh
git ls-files --error-unmatch .claude/agents/planner.md .claude/agents/implementer.md \
  .claude/agents/researcher.md .claude/agents/test-writer.md \
  .claude/agents/architecture-reviewer.md .claude/agents/plan-verifier.md \
  .claude/agents/doc-writer.md .claude/agents/README.md
```

A push additionally needs a fresh `/pr-self-review` verdict.

## Tests

**No automated test covers any file this change creates or edits.** That is a fact the implementer
needs stated, not implied:

- `.claude/agents/**` — read by no test and no gate. `registry.sh:19-20` reads `.claude/skills/`
  and `skills-lock.json` only.
- `.claude/skills/mermaid-diagram/` — `registry.sh` inspects `SKILL.md` alone (existence,
  frontmatter `name`, the 500-line cap, lock membership). A topic file is never opened.
  `scripts/pr-self-review/test/registry.test.sh` builds its own fixtures inside `mktemp -d` repos
  and never reads this repository's skills.
- `server/test/skill-injection.test.ts` is **not** a test of `.claude/skills/**`. It exercises
  `detectInjection` against skill bodies imported through the API — the `docs/skills/*.md` → seed →
  DB path. Editing a `.claude/skills/` file cannot make it fail.
- `AGENTS.md`, `INSIGHTS.md`, `specs/**`, `docs/**` — no test, no workflow.

The only tests in play are the ones **Step 10 creates**: a new unit file under `server/test/`, run
by `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`.

Integration (`*.it.test.ts`) and e2e are **out of scope for this change**. Do not run them. Step
10's target is a pair of pure functions in the Core ring, which belongs in the unit lane.

## Gates

The Track A commands, copied verbatim from `.claude/skills/pr-self-review/gates.md`:

```sh
cd server && pnpm arch                                          # server · arch
cd server && pnpm typecheck                                     # server · typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # server · test
cd client && pnpm lint                                          # client · lint
cd client && pnpm typecheck                                     # client · typecheck
cd client && pnpm test                                          # client · test
cd reviewer-core && npm run typecheck                           # reviewer-core · typecheck
cd reviewer-core && npm test                                    # reviewer-core · test
diff -r server/src/vendor/shared client/src/vendor/shared       # repo · vendor
bash scripts/pr-self-review/registry.sh                         # repo · registry
```

**Which of those actually route to this change — the honest answer:**

1. **CI: none.** Every workflow in `.github/workflows/` is `paths:`-filtered to `client/**`,
   `server/**`, `reviewer-core/**`, `e2e/**`, `*/vendor/shared/**` or `scripts/pr-self-review/**`.
   Nothing triggers on `.claude/**`, `AGENTS.md`, `INSIGHTS.md`, `docs/**` or `specs/**`.
   Steps 1–9 and 14 push zero GitHub Actions jobs.
2. **Track A, attributable to these files: two gates, both trivially green.** `scope.sh` adds a
   package to `packages[]` only for a path under `client/`, `server/` or `reviewer-core/`
   (`:209-213`), so on these files alone all eight package gates record `skip`. `repo · vendor` and
   `repo · registry` run unconditionally: the vendored copies are untouched, and `registry.sh` will
   produce the same `note` rows it produces today (`mermaid-diagram` has no lock entry — that is
   correct and must stay). **`skip` is not `ok`.** Do not report this as "all gates green".
3. **Steps 10 and 13 change that.** A file under `server/test/` or `server/docs/` puts `server`
   into `packages[]`, and `server · arch`, `server · typecheck` and `server · test` become live.
4. **The branch keeps it honest.** `feat/agent-layer` is cut from `main`, so nothing but this
   change is in the diff and every unrelated package gate reports `skip`.
5. **Track B sees none of it.** `domains_for` (`scope.sh:159-171`) routes only `client/src/*.ts(x)`,
   `server/src/*`, `reviewer-core/src/*` and `*/contracts/*`. Every file in Steps 1–9 lands in
   `checklist[]` — read, but no skill applies, and no subagent reviews it. The four bodies get **no
   automated review whatsoever**; Steps 10–13 are the review.

A push still requires a fresh passing verdict for the current HEAD and working tree
(`.claude/settings.json` → `scripts/pr-self-review/gate.sh`). `--gates` is enough for a push; a PR
needs a full run.

## Risks (from INSIGHTS.md)

1. **"Committing a documentation layer by path while the files it references stay untracked"**
   (`:108-125`) — *"A doc and the thing it documents belong in the same commit."* Not hypothetical:
   `git ls-files .claude/` returns 135 files and **none under `agents/`**, while the tracked
   `INSIGHTS.md:379` already cites `.claude/agents/researcher.md`. **Remedy:** Step 15 stages the
   whole agent layer in one commit and verifies against the index.
2. **"`skills:` in agent frontmatter declares a role; it loads nothing"** (`:592-605`) — the record
   this document overturns for the subagent path. Left alone it would talk the next agent author
   out of the mechanism this whole design rests on. The same claim is repeated in
   `.claude/agents/README.md:333-335`, which nobody would think to check. **Remedy:** Steps 7 and 8.
3. **"An agent body restates rules it does not own, and nothing notices when they drift"**
   (`:418-433`). Four new bodies mean four new copies of rules owned elsewhere: the twelve
   dependency-cruiser names, the suite commands, the Track B roster, the `docs/README.md` table
   shape. **Remedy:** Step 8's *Where its rules come from* row per restated rule.
4. **"A subagent asking a clarifying question has to end its turn to ask it"** (`:364-372`).
   **Remedy:** Steps 2–5 spell it as *emit the block as your entire output and stop*. Copy the
   shape from `researcher.md:32-60`.
5. **"Probing an agent with a fact it could guess returns a confident false positive"**
   (`:279-296`) — the reason the 2026-08-05 measurement probes for §6's title and the last
   checklist item rather than a `# ` heading. Anyone re-verifying the preload claim must use a
   mid-or-end-of-file fact and give the agent an explicit `NOT PRELOADED` escape, or they will
   "disprove" this document by measuring the wrong thing. **Remedy:** Step 7 records the probe
   design alongside the result.
6. **"An agent's `tools:` list denies by omission, and `Bash` hands back what it denied"**
   (`:573-590`) — `architecture-reviewer` and `plan-verifier` have no `Write`/`Edit`, but both have
   `Bash`, and `sed -i`, `>` and `tee` write as well as `Edit` does. The read-only claim in their
   bodies is a **backstop** and must be worded as one.
7. **"A skill is worth only what it adds over `AGENTS.md` + `INSIGHTS.md`, and that is small"**
   (`:341-363`) — the empirical backing for the "dry tool, not teaching material" decision, and the
   yardstick for cutting a paragraph.

Nothing in `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md` or
`e2e/INSIGHTS.md` bears on this work.

## Decisions and their alternatives

| Decision | Alternative rejected | Why |
|---|---|---|
| Rewrite the four from scratch, deleting the drafts unread | Audit and extend the drafts | Design from requirements, not from an inherited shape |
| Bodies are dry tools with no teaching prose | Course-material bodies with rationale throughout | These are dispatched often, including by the main agent; explanation is paid for on every run |
| Hybrid skill loading | Preload everything via `skills:` | A dispatch that touches one server unit pays for the RTL skill it will never open |
| Hybrid skill loading | On-demand only | Preloading is measured to work, and `doc-writer` needs `mermaid-diagram` every time |
| `test-writer` covers e2e too | Leave `e2e/` out | Requires the explicit exception in `AGENTS.md` that Step 6 adds |
| `test-writer` mutates code to prove a test fails, then reverts | Absolute ban on writing to `src/` | A test never seen red proves only that it runs |
| `test-writer` follows the repo where `react-testing-library` disagrees | Follow the skill; add `user-event` and `msw` | Migrating 25 files is its own piece of work |
| `plan-verifier` adapts to both plan formats | Retrofit committed specs to the template | `specs/README.md`: do not rewrite history to match the implementation |
| `mermaid-diagram` rewritten for this stack before preloading | Preload as-is; ignore the examples | Preloading MongoDB templates into every document is paying tokens to be misled |
| `architecture-reviewer` stays out of Track B | Add it as a third Track B agent | `report.sh` compares the roster as set equality; a third name breaks every verdict |
| This document is one artifact under `specs/` | A separate plan under `docs/superpowers/plans/` | `INSIGHTS.md:390-403`: a Development Plan in this repo **is** a spec, and a separate plans directory "would have split one artifact across two conventions". A first draft did split them; it was merged back here |
| Append a dated correction to the `INSIGHTS.md` entry | Rewrite the entry, heading included | `engineering-insights` § *Append only*. Pruning is a separate, deliberate human pass — flagged in `## Open questions` §3 |
| Step 8 derives every README row from the shipped files | Edit the leftover README's four sections in place | They describe drafts deleted unread |
| `doc-writer`'s first dispatch targets `<module>/docs/` | A repo-wide subject landing in `docs/` | `docs/README.md` has taken rows before; the `Empty for now — …` branch never has |
| `plan-verifier`'s first dispatch targets `specs/03` | This document, or a plan from this session | A verifier pointed at its own session's work grades its own homework |
| `test-writer`'s first dispatch is a hermetic Core-ring pair | A client or integration target | Integration needs Docker; a client target collides with the `fireEvent` contradiction, which is worth testing but not on the run that proves the agent works at all |
| Say plainly that no gate reads `.claude/agents/**` | Add a gate or a test that does | Inventing a new gate is a separate piece of work |

## Out of scope

- Adding `user-event`, `msw`, or `eslint-plugin-testing-library` to `client/`.
- Migrating the 25 `fireEvent` test files.
- Adding StrykerJS or any mutation-testing tool.
- Changing `scripts/pr-self-review/*` or the Track B roster.
- Rewriting `planner`, `implementer` or `researcher`.
- Rewriting any committed spec under `specs/` to match this document's shape.
- Restructuring `mermaid-diagram/` into new topic files. Rewrite the contents; keep the filenames.
- `specs/README.md` beyond the existing `Planned 2026-08-05` row. The `Implemented` flip belongs to
  whoever ships this, and `plan-verifier` in particular must never touch it.

## Acceptance criteria

Eighteen, each mapped to the step that closes it and the check that proves it. Every criterion is
single-condition on purpose — see `plan-verifier` rule 1.

| # | Criterion | Step | Mechanical check |
|---|---|---|---|
| 1 | `.claude/agents/test-writer.md` exists and its frontmatter declares no `skills:` field | 2 | `test -f` and `rg -n '^skills:' .claude/agents/test-writer.md` returns nothing |
| 2 | `architecture-reviewer.md` exists; `tools:` contains neither `Write` nor `Edit` | 3 | `rg -n '^tools:' .claude/agents/architecture-reviewer.md` |
| 3 | `plan-verifier.md` exists; `tools:` contains neither `Write` nor `Edit` | 4 | `rg -n '^tools:' .claude/agents/plan-verifier.md` |
| 4 | `doc-writer.md` exists and declares `skills: mermaid-diagram` | 5 | `rg -n '^skills:' .claude/agents/doc-writer.md` |
| 5 | Each of the four bodies contains a report template | 2, 3, 4, 5 | one report-template section per file, four for four |
| 6 | Each of the four bodies contains an explicit never-list | 2, 3, 4, 5 | one such section per file |
| 7 | `test-writer.md` states mutate-run-revert and requires `git diff --exit-code` evidence | 2 | `rg -n 'git diff --exit-code' .claude/agents/test-writer.md` |
| 8 | `test-writer.md` names `fireEvent` and `fetch` mocking as this repo's convention over the skill's advice | 2 | `rg -n 'fireEvent' .claude/agents/test-writer.md` and the `fetch`-mocking sentence beside it |
| 9 | `architecture-reviewer.md` distinguishes `pre-existing` from `introduced` | 3 | `rg -n 'pre-existing\|introduced' .claude/agents/architecture-reviewer.md` |
| 10 | It lists the twelve `pnpm arch` rule names it must not re-report | 3 | all twelve appear; cross-check `rg -n 'name:' server/.dependency-cruiser.cjs` |
| 11 | `plan-verifier.md` states the compound-criterion decomposition step | 4 | the rule is present and cites `specs/03-pr-self-review-skill.md` |
| 12 | `plan-verifier.md` states the enumerate-then-count cardinality check | 4 | the "N items → N rows" step is present |
| 13 | `doc-writer.md` states the Diátaxis compass as its mode-selection procedure | 5 | both compass questions appear, resolving to the four modes |
| 14 | `.claude/skills/mermaid-diagram/` contains no MongoDB, Mongoose, Express or `ObjectId` reference, and `SKILL.md:10` has no dangling link | 1 | `rg -i 'objectid\|mongo\|express' .claude/skills/mermaid-diagram/` returns nothing |
| 15 | `CLAUDE.md` records the `e2e/specs/*.flow.json` exception for `test-writer` | 6 | `rg -n 'e2e/specs' AGENTS.md` |
| 16 | The `skills:` entry in `INSIGHTS.md` states that preloading works on the subagent path | 7 | the appended correction is present and the original paragraph is unchanged vs `HEAD` |
| 17 | `.claude/agents/README.md` lists all seven agents | 8 | seven rows, seven existing files, frontmatter matching each row |
| 18 | Each of the four agents has been dispatched once against a real target, and the report is quoted in the completion summary | 10, 11, 12, 13 | four reports quoted; each names the target from its step |

**End-to-end verification.** After Step 15's staging and before any push: `/pr-self-review --gates`
returns `verdict: pass`, its gate table is read out honestly (which rows are `skip` and why), and
the completion summary quotes all four dispatch reports.

## Open questions

1. ~~**Whether a just-written agent is dispatchable from the session that wrote it is
   unverified.**~~ **Closed 2026-08-05:** it is — see Step 9. No restart, and the registration is
   two-way: deleting an agent file withdraws its type from the running session too.
2. **The `doc-writer` dispatch leaves a real document under `server/docs/`.** Decided: it stays if
   it earns its place, and is read before that is judged. If it does not, Step 13 reverts it after
   the report is quoted and says so.
3. **The heading of the corrected `INSIGHTS.md` entry still reads "it loads nothing".** Append-only
   forbids the implementer from changing it; pruning is a separate, deliberate human pass. Flagged
   so that pass knows.

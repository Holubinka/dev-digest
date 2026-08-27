# 16 — Multi-Agent Review

**Status:** Planned 2026-08-26
**Scope:** server · client
**Modules touched:** `server/src/modules/reviews`, `server/src/db`, `server/src/vendor/shared`, `client/src/vendor/shared`, `client/src/vendor/ui`, `client/src/components`, `client/src/lib`, `client/src/app/repos/[repoId]/multi-agent`, `client/src/app/repos/[repoId]/pulls`, `client/messages/en`
**Requirements source:** `specs/SPEC-05-multi-agent-review.md` (135 acceptance criteria, AC-1…AC-135, amended 2026-08-26 — `not_reviewed` and the four empty states)
**Execution:** multi-agent — 4 packages, P1 first and alone

---

## Requirements as understood

Every row cites the criterion, not the file. All 135 `AC` numbers appear below; none is
deferred to `## Out of scope`. The amendment of 2026-08-26 rewrote AC-71, AC-76, AC-111 and
AC-113 and added AC-119…AC-135; R30, R32 and R47 below are written to the **new** wording and
R50…R53 are new.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | Configure run shows the title and the two numbered steps; with no PR chosen it shows the "Pick a pull request first" block instead of the agent list and keeps the CTA visibly disabled | `SPEC-05 § AC-1, AC-2, AC-3` | clear |
| R2 | The PR dropdown lists every PR of the repo including `merged` / `closed` / `stale`, repeats the PR page's non-blocking merged warning, and says so when the repo has no PRs | `SPEC-05 § AC-4, AC-5, AC-6` | clear |
| R3 | One card per workspace agent with name, description and selection state; a disabled agent is marked disabled and stays selectable; first open preselects every enabled agent and no disabled one | `SPEC-05 § AC-7, AC-8, AC-9` | clear |
| R4 | "Select all" selects every **enabled** agent and flips its label to "Clear all"; "Clear all" clears everything and flips back | `SPEC-05 § AC-10, AC-11` | clear |
| R5 | A workspace with no agents shows an empty state linking to the agents screen instead of the card list | `SPEC-05 § AC-12` | clear |
| R6 | CTA label is "Select agents" (disabled) / "Run 1 agent" / "Run multi-agent review (N)" | `SPEC-05 § AC-13, AC-14, AC-15` | clear |
| R7 | With a PR and ≥1 agent chosen, an estimate of time, cost and the fan-out description sits beside the CTA; each agent card shows the time and cost of its last successful run | `SPEC-05 § AC-16, AC-19` | clear — the spec names no endpoint, and the human chose one on 2026-08-26: a separate `GET /runs/last-successful` rather than fields on `GET /agents`, because that list is read from many screens and all of them would then pay for an aggregate over `agent_runs` that one screen needs |
| R8 | Estimated time = **max** `duration_ms`, estimated cost = **sum** `cost_usd`, over the last successful run of each chosen agent | `SPEC-05 § AC-17, AC-18` | clear |
| R9 | An agent with no successful run shows `—` and enters neither sum; an agent whose last successful run has `cost_usd = null` shows `—` for cost, enters no cost sum, and still counts toward the time maximum; a sum missing at least one agent says how many were left out; a sum with no contributors shows `—`, never `0.0s` / `$0.00` | `SPEC-05 § AC-20, AC-21, AC-22, AC-23` | clear |
| R10 | A run of any size creates exactly one multi-run; every agent run belongs to at most one multi-run; the response carries the id the result stays reachable by | `SPEC-05 § AC-24, AC-25, AC-26` | clear |
| R11 | A request naming no agent, or more than the ceiling, is refused in the existing error envelope with nothing created | `SPEC-05 § AC-27, AC-30` | clear |
| R12 | An agent id or multi-run id outside the requester's workspace is "not found", not "forbidden", and starts nothing | `SPEC-05 § AC-28, AC-95` | clear |
| R13 | The same agent id named twice counts once | `SPEC-05 § AC-29` | clear |
| R14 | A chosen agent that is disabled runs like the rest | `SPEC-05 § AC-31` | clear |
| R15 | Chosen agents run concurrently up to a ceiling; the surplus waits in a state that is not "running", in the data, in the response and in the column header | `SPEC-05 § AC-32, AC-33, AC-34` | clear |
| R16 | Neither the PR page's review button nor `POST /reviews/diff` changes — not the number of simultaneous agents, not the order, not the events published | `SPEC-05 § AC-35` | clear |
| R17 | One agent failing lets the rest finish and shows that column failed with its reason; all failing still renders the results page with failed columns; a failed pre-work marks every run of the multi-run failed with the same reason | `SPEC-05 § AC-36, AC-37, AC-38` | clear |
| R18 | A cancelled run shows a cancelled column, distinguishable from a failed one | `SPEC-05 § AC-39` | clear |
| R19 | The results page shows PR number and title, agent count, how it was executed, total time (max) and total cost (sum), with an incompleteness mark when any run's `cost_usd` is null | `SPEC-05 § AC-40, AC-41, AC-42` | clear |
| R20 | The results page switches between Columns and Tabs and offers "Configure run" carrying the same PR | `SPEC-05 § AC-43` | clear |
| R21 | Each agent has one stable colour derived from its immutable id and nothing else, identical across picker / column / tab / take; the agent's name is visible wherever the colour is used; the agent order is the one the existing agents list returns, on all four surfaces | `SPEC-05 § AC-44, AC-45, AC-46` | clear |
| R22 | One column per agent, header with name, run state, time, cost and score, `—` for a missing score | `SPEC-05 § AC-47, AC-48, AC-49` | clear |
| R23 | Column body lists that agent's findings with severity, title and file:line; the footer shows the count and the entry to that run's trace; a zero-finding agent says so in words | `SPEC-05 § AC-50, AC-51, AC-52` | clear |
| R24 | More columns than fit stay reachable by horizontal scrolling, none hidden | `SPEC-05 § AC-53` | clear |
| R25 | Tabs mode: one tab per agent with name and score; the selected agent's header carries summary, score, time, cost and the trace entry; a run with no summary renders the header without that line | `SPEC-05 § AC-54, AC-55, AC-56` | clear |
| R26 | An expanded finding shows file with line range, confidence, rationale and suggested fix; no suggestion means no block at all; a single-line finding renders `file:12`, not `file:12-12` | `SPEC-05 § AC-57, AC-58, AC-59` | clear |
| R27 | The expanded finding offers Accept, Dismiss, Learn, Turn into eval case and Reply to author; Accept/Dismiss go through the existing finding-action endpoint and show the new state; Learn and Turn into eval case — and only those two — render inert and send nothing; an already-acted finding shows its state on first paint | `SPEC-05 § AC-60, AC-61, AC-62, AC-63` | clear |
| R28 | "Where agents disagree" appears in both modes, is computed without a model call, and is never stored | `SPEC-05 § AC-64, AC-65, AC-97` | clear |
| R29 | Two findings share a position iff same file **and** intersecting line ranges **and** (same category **or** normalised-title similarity ≥ threshold); the normalisation rule and the threshold are named parameters with named defaults; a position is a connected component of that relation; the same finding set always yields the same positions in the same order | `SPEC-05 § AC-66, AC-67, AC-68, AC-69` | clear |
| R30 | A position holds exactly one take per multi-run agent; an agent **whose run reached `done`** and did not flag shows a grey marker and `did not flag` with no note; a flagging agent shows its severity and a note taken from that finding's rationale; an agent with several findings in one position speaks through the heaviest by a named deterministic rule | `SPEC-05 § AC-70, AC-71, AC-72, AC-73` | clear |
| R31 | The position title is derived from its member findings by a deterministic rule, never from a model | `SPEC-05 § AC-74` | clear |
| R32 | Toggle off → every cross-agent position including the unanimous ones; toggle on → only the positions that are a conflict by AC-126; the toggle never filters columns or tabs | `SPEC-05 § AC-75, AC-76, AC-77` | clear |
| R33 | Each column's state updates from that run's live event stream; a reload mid-run restores states from the server and keeps updating | `SPEC-05 § AC-78, AC-79` | clear |
| R34 | The trace opens the same drawer component the PR page opens, same tabs and same copy-raw action; the PR page's drawer behaviour does not change; with no persisted trace yet the drawer shows the live log rather than an error | `SPEC-05 § AC-80, AC-81, AC-82` | clear |
| R35 | View mode, selected agent tab, conflicts toggle and the open trace all live in the URL | `SPEC-05 § AC-83, AC-84, AC-85, AC-86` | clear |
| R36 | The PR page lets a **set** of agents be chosen and launched in one run, replacing "one or all" | `SPEC-05 § AC-87` | clear |
| R37 | A run started from the PR page shows a non-blocking link to that multi-run's results beside the run status and leaves the user on the PR page | `SPEC-05 § AC-88, AC-89` | clear |
| R38 | The sidebar gains a GLOBAL section with the single row "Multi-Agent Review", highlighted on every page of the feature | `SPEC-05 § AC-90, AC-91` | clear |
| R39 | Configure run lives at a repo-scoped path, a specific multi-run at a path carrying its id; a bad repo in the path gives the existing "repo not found" screen; a repo with no multi-runs yet gets an empty state leading to Configure run | `SPEC-05 § AC-92, AC-93, AC-94` | clear — AC-92 and AC-94 together imply a repo-scoped landing distinct from Configure run; the three-route split and the "latest multi-run of this repo" read were confirmed by the human on 2026-08-26. See P4 S1 |
| R40 | After a multi-run the data still says which agent produced which finding | `SPEC-05 § AC-96` | clear |
| R41 | One request returns everything both modes and the finding detail draw | `SPEC-05 § AC-98` | clear |
| R42 | A deleted run leaves the multi-run without that column and the positions recomputed without its findings | `SPEC-05 § AC-99` | clear |
| R43 | Both vendored copies of the contracts stay identical after every contract change of this feature | `SPEC-05 § AC-100` | clear |
| R44 | "Reply to author" opens an editable body prefilled from the finding's rationale, addressed to the finding's file and **start** line, published through the existing PR-comments endpoint only after an explicit confirmation, then confirmed with a link to the posted comment | `SPEC-05 § AC-101, AC-102, AC-103, AC-104, AC-105` | clear |
| R45 | Both GitHub failure paths show the returned reason beside the finding without losing the typed text | `SPEC-05 § AC-106, AC-107` | clear |
| R46 | A `merged` / `closed` PR warns before sending that GitHub is expected to refuse and why; findings produced against a state other than the PR's current head warn that the line may have moved | `SPEC-05 § AC-108, AC-109` | clear |
| R47 | The **four** reasons the disagreement section can be empty get four different texts; "the agents looked at different places" is claimed only when at least two runs reached `done` | `SPEC-05 § AC-110, AC-111, AC-112, AC-113` | clear |
| R48 | The results page re-runs the same agent set on the same PR, creating a **new** multi-run, leaving the previous one reachable, and moves the user to the new link | `SPEC-05 § AC-114, AC-115, AC-116` | clear |
| R49 | A re-run skips agents that no longer exist, runs the rest and names the skipped ones; an old multi-run whose agent was deleted still names that agent and marks it deleted | `SPEC-05 § AC-117, AC-118` | conflicting — AC-117 ("run the rest") contradicts AC-28 ("reject the whole request") if both go through one endpoint. Resolved by giving re-run its own route that resolves the stored set server-side; AC-28 keeps governing the client-named set. See P2 S5 |
| R50 | A take carries `not_reviewed` iff that agent's run is not `done` — `failed`, `cancelled`, `running` or `queued` — and a failed or cancelled run keeps it after the multi-run ends rather than decaying to `ignored`; such a take shows a marker differing from the `did not flag` one **in shape**, no note at all, and a caption naming the run state as one of `queued` / `reviewing` / `run failed` / `run cancelled`; `did not flag` never appears on it; that caption and the column header of the same run use the same word | `SPEC-05 § AC-119, AC-120, AC-121, AC-122, AC-123, AC-124, AC-125` | clear |
| R51 | A position is a conflict iff, among takes whose verdict is **not** `not_reviewed`, there are at least two and either one flagged while another is `ignored` or two carry different severities; fewer than two such takes is never a conflict and vanishes when the toggle is on; with the toggle off the position stays visible **with** its `not_reviewed` takes, so a lone finding does not read as one the others disagreed with | `SPEC-05 § AC-126, AC-127, AC-128` | clear |
| R52 | With two or more agents but fewer than two runs at `done`, the section says there is nothing to compare and gives the numbers — how many finished, how many are still running, how many never got there — without claiming agreement or different places; when nothing is still running it offers the re-run; the four empty reasons resolve in the order AC-110 → AC-129 → AC-111 → AC-112 and the first whose condition holds supplies the text | `SPEC-05 § AC-129, AC-130, AC-131, AC-132` | clear |
| R53 | The section renders from the first open, carries a visible not-final mark while any run is non-terminal, recomputes when a run reaches a terminal state without a reload, and on a failed recompute keeps what is on screen plus the not-final mark rather than emptying | `SPEC-05 § AC-133, AC-134, AC-135` | clear |
| R54 | The PR page's link to the multi-run **survives a reload and a return the next day**: it is read from the server, not only remembered from the response that created it | the dispatch prompt — human decision 2026-08-26 | clear — no `AC` asks for it. AC-88 covers only the moment of launch, and a link held in page state alone disappears on reload, so a visit to the same PR tomorrow shows no way back to a comparison that exists |

---

## Out of scope

No acceptance criterion is dropped. What is deliberately not built:

- **`ci/` and `agent-runner/`.** `SPEC-05 § N1`. A multi-run is `source: 'local'`.
- **The Compose Review drawer** (`§ N2`), **Per-Agent Stats / `AgentStats`** (`§ N3`), **mechanics behind Learn and Turn into eval case** (`§ N4`), **embeddings or an LLM judge for similarity** (`§ N5`), **git worktrees** (`§ N6`), **the Memory / Eval / Agent Performance / CI Runs sidebar rows** (`§ N7`), **cancelling a whole multi-run** (`§ N8`).
- **Cancelling a `queued` run.** `cancelRunIfRunning` only touches `status='running'` and `§ N8` says single-run cancellation does not change. A run still waiting for a slot therefore cannot be cancelled; it will start, then be cancellable. Named here so the gap is a decision, not a surprise.
- **The 2 MB response cap and rationale truncation** from `§ Non-functional requirements`. No `AC` asks for it and the ceiling is not reachable at the stated load: 10 agents × 50 findings × a ~2 KB rationale is ≈1 MB. `## Verification` measures the real body instead of building a truncation layer that nothing would exercise.
- **e2e flows.** `e2e/specs/*.flow.json` is out of bounds for this work; `TESTING.md` keeps that suite in its own package and the dispatch did not include it.
- **Indexes on `agent_runs.pr_id` and `agent_runs.agent_id` in general.** Only the one index the new estimate query needs is added (P1 S3). See `## Recommendations`.

**One thing left this list on 2026-08-26 and is now built: `GET /pulls/:id/multi-agent`.** The
first draft of this plan cut it, correctly on its own terms — no `AC` requires it, and the PR page
gets its multi-run id from the response that created it. The human was shown the consequence and
chose otherwise: an id held only in page state dies on reload, so returning to the same PR tomorrow
shows no way back to a comparison that already exists, and AC-88 does not cover that because it
speaks only about the moment of launch. It is R54, and P2 S7 serves it. Recorded here rather than
deleted, so the next reader sees that it was weighed twice and not merely forgotten.

---

## What already exists

- **`multi_agent_runs` table** — `server/src/db/schema/runs.ts:47`. Three columns (`id`, `workspace_id`, `pr_id`, `ran_at`), no link to `agent_runs`, no reader, no writer.
- **The contracts** — `server/src/vendor/shared/contracts/observability.ts:24-84`: `AgentColumnFinding`, `AgentColumn`, `ConflictTake`, `Conflict`, `MultiAgentRun`. Declared, never implemented, and each is short of what the screens need (P1 S1).
- **The fan-out** — `server/src/modules/reviews/run-executor.ts:200-232`. A `for … await` loop. Shared pre-work (diff `run-executor.ts:152`, intent `:169`, repo-intel `:196`) is already computed once for the whole set.
- **`failAll`** — `run-executor.ts:133-151`. Already marks every queued run failed with one reason and persists each buffered trace. This is AC-38, already built.
- **Run rows** — `repository/run.repo.ts:113-137` `createAgentRun` writes `status: 'running'` up front; `:92` `cancelRunIfRunning`; `:104` `reapStaleRunningRuns`; `:12` `activeRunsForPull` filters `status='running'`; `:41` `listRunsForPull`.
- **`ReviewRepository`** — `modules/reviews/repository.ts`, a class delegating to free functions under `modules/reviews/repository/`.
- **Finding actions** — `modules/reviews/findings.ts` accepts exactly `accept` and `dismiss`; `routes.ts:180-186` registers the two.
- **Inline PR comments** — `modules/pulls/routes.ts:335-366`. Binds to `pr.headSha`, throws `github_unavailable` (`:346`) and `github_comment_failed` (`:364`). Client hook `useCreatePrComment` — `client/src/lib/hooks/reviews.ts:108`.
- **`RunTraceDrawer`** — `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/`, mounted only from `pulls/[number]/page.tsx:258` and mocked in `page.test.tsx:55`.
- **`FindingCard`** — `.../pulls/[number]/_components/FindingCard/`, used only by `FindingsPanel.tsx:109`. `helpers.ts` already holds `lineLabel`, which is AC-59.
- **`RunCostBadge` / `formatCost`** — `client/src/components/run-cost-badge/`. Already renders `null` as `—` and a real zero as `$0.0000`; AC-21/AC-23/AC-42/AC-49 reuse it rather than restating the rule.
- **`activeKeyFor`** — `client/src/components/app-shell/helpers.ts:29` already returns `"multi-agent"` for any `/multi-agent` path. `client/messages/en/shell.json:26` already holds `nav.multi-agent`. `client/src/vendor/ui/nav.ts` has no such row — that is the only missing half of AC-90/AC-91.
- **`client/messages/en/runs.json:112`** — a full `page` block for an **older** design of this screen (`"runAll": "Run all agents"`, `"meta": "… fan-out via p-queue …"`). Also `conflicts.empty`, one string for what AC-113 requires be three. See P4 S8; do not wire these keys as they stand.
- **`test/reviews-repo-intel-once.test.ts`** — a hermetic `ReviewRunExecutor` harness with a stub container, stub repository and `MockLLMProvider`. The concurrency test (P2 S9) is built on this shape, not from scratch.
- **`app/layout.tsx:29`** already wraps every page in `<Suspense>`, which is what lets a page call `useSearchParams` without its own boundary.

---

## Constraints

| Constraint | Mandated by |
|---|---|
| A new module slice may **not** import `modules/reviews`. `no-cross-module` counts an `import type` as an edge and a re-export barrel does not help. The whole multi-run slice therefore lives **inside `modules/reviews/`** | `server/.dependency-cruiser.cjs` § `no-cross-module` |
| SQL may only appear in a path matching `src/modules/<m>/repository(\.ts$\|/)`. A file called `multi-run-repository.ts` does **not** match — the new data access must be `repository/multi-run.repo.ts` | `server/.dependency-cruiser.cjs` § `no-sql-outside-repository`, `onion-architecture` §3.2 |
| A route validates, resolves tenancy, delegates. Declare `schema.body`; do not hand-roll `Schema.parse(req.body)` | `onion-architecture` §3.1, `server/README.md`; `fastify-best-practices` § Core Principles ("Schema-first") |
| A service takes its repository as a **parameter** with a default — `constructor(container: Container, repo = new XRepository(container.db))` — or it has no test seam | `onion-architecture` §3.3 |
| Data crossing a ring boundary is a plain structure; a `*Row` never leaves its module | `onion-architecture` §3.5 |
| Postgres does not index FK columns for you | `postgresql-table-design` § Constraints |
| Multi-step writes that must all succeed go in one `db.transaction` | `drizzle-orm-patterns` § Best Practices 3 |
| `drizzle-kit generate` asks on a TTY whether a new column is a rename; a migration that both adds and drops has to be generated in two runs | `server/AGENTS.md` § Schema |
| Register nothing new in `src/modules/index.ts` — `reviews` is already registered, and autoload is deliberately absent | `server/AGENTS.md` § Conventions |
| `server/src/vendor/shared` is the source of truth; `client/src/vendor/shared` is the mirror; typecheck cannot see the drift | root `AGENTS.md` § Non-default conventions; `pr-self-review/gates.md` § repo · vendor |
| `client/src/vendor/ui/` is a **single** copy — there is nothing to mirror it into. The vendored-change rule (deliberate, named) applies; the mirror step does not | root `AGENTS.md` § Do not touch; `client/src/vendor/` has no sibling |
| A `NAV` row carrying `gKey` without a `SHORTCUTS` entry produces a shortcut absent from the `?` help | `client/src/vendor/ui/nav.ts:64-71`, pinned by `nav.test.ts` |
| No `fetch` in a component; every read goes through a hook in `src/lib/hooks/*` | `client/AGENTS.md` § Conventions |
| A component used by 2+ routes moves to `src/components/<kebab-name>/`; a shared pure function to `src/lib/` | `frontend-architecture` § step 4; the four under-promotion violations in `client/INSIGHTS.md` are the cost of skipping this |
| Responsive rules live in `app/globals.css` keyed on a `dd-` class, never in `styles.ts` — an inline style beats a stylesheet rule | `client/AGENTS.md` § Conventions |
| Model-written text renders as **text**: no `dangerouslySetInnerHTML`, and no link built out of a model-written file path. `<Markdown>` is safe because it loads no `rehype-raw` | `SPEC-05 § Untrusted inputs`; `security` § A05; `client/src/vendor/ui/primitives/Markdown.tsx` |
| Title normalisation must not build a regex from a title — fixed patterns and a fixed stop-word list only | `SPEC-05 § Untrusted inputs`; `security` § Framework Security Quirks ("`RegExp(userInput)` enables ReDoS") |
| The mockups are acceptance criteria: `specs/assets/SPEC-05-multi-agent-review-{configure-run,configure-empty,columns,tabs}.png` and `…-screen.jsx`. Walk each element *matches / differs / absent* and report differences instead of resolving them | `client/AGENTS.md` § A design is an acceptance criterion |

---

## Recommendations

For the human. The steps below are written to the requirements as they stand.

Recommendation 1 of the 2026-08-26 draft — that a failed agent's take reading `did not flag`
invents silence — is gone from this table because the amendment turned it into criteria
(AC-119…AC-125, D22). It is now R50 and P2 S6 builds it.

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | `agent_runs` carries no index on `pr_id` or `agent_id`, so `activeRunsForPull` and `listRunsForPull` are sequential scans that this feature polls more often than the PR page did | No | One migration; measure first — the table is small on a local-first install |
| 2 | AC-19's per-card time and cost come from the last successful run **anywhere**, so a card can advertise 8.2 s measured on a 30-line PR while the chosen PR is 3000 lines. Scoping the estimate to comparable diffs is a real product question | No | Out of this feature's reach — needs a size signal the estimate does not have |
| 3 | `SHORTCUTS` has no `g ,` row for `SETTINGS_ITEM`, a gap `nav.test.ts:16-20` records and deliberately does not close | No | One line, whenever someone decides it |

---

## Skills the implementer must invoke

Pointers, not bodies. Invoke before writing the step, not after.

| Step | Skill | Why |
|---|---|---|
| P1 S1, S2 | `zod` | Six contract edits including a derived schema (`RunRequest.pick().required()`) and the nullable/optional distinction AC-71 turns on |
| P1 S3 | `postgresql-table-design` | A new table, its primary key, its two foreign keys and the indexes Postgres will not create for them |
| P1 S3 | `drizzle-orm-patterns` | The `pgTable` + third-argument index form, and the `db:generate` → `db:migrate` workflow |
| P2 S1–S6 | `onion-architecture` | Which ring each new file lands in, why the slice cannot be its own module, and the `repository/` path the SQL rule requires |
| P2 S5, S6 | `fastify-best-practices` | Route schemas, the per-route rate-limit config, and the error envelope |
| P2 S3 | `postgresql-table-design` | The `DISTINCT ON` read behind the estimate and the index that serves it |
| P2 S5, P3 S6 | `security` | The one outbound untrusted flow (Reply to author) and the workspace-scoping of every id in a path or body |
| P3 S1–S3, P4 S1–S7 | `frontend-architecture` | Where each moved and each new file goes, and which state is URL state |
| P4 S1 | `next-best-practices` | App Router segment layout for three sibling routes under one dynamic parent, and why no new Suspense boundary is needed |
| P4 S4–S6 | `react-best-practices` | Derived-during-render state for the conflicts filter and the tab selection; no query data copied into `useState` |

---

## Work packages

### P1 — Contracts, schema and the vendored nav row

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/observability.ts`
- `server/src/vendor/shared/contracts/platform.ts`
- `client/src/vendor/shared/contracts/observability.ts`
- `client/src/vendor/shared/contracts/platform.ts`
- `server/src/db/schema/runs.ts`
- `server/src/db/migrations/0021_*.sql` and `server/src/db/migrations/meta/*`
- `client/src/vendor/ui/nav.ts`
- `client/src/vendor/ui/nav.test.ts`
- `server/test/contracts.test.ts`

**Contract this package publishes** (repeated in P2, P3 and P4 because each starts cold):

```ts
// contracts/platform.ts
export const MAX_AGENTS_PER_MULTI_RUN = 10;
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
  /** SPEC-05: the chosen SET. Non-empty and capped when present. */
  agentIds: z.array(z.string().uuid()).min(1).max(MAX_AGENTS_PER_MULTI_RUN).optional(),
});
/** Body of POST /pulls/:id/multi-agent-run. */
export const MultiAgentRunRequest = RunRequest.pick({ agentIds: true }).required();

// contracts/observability.ts
export const AgentColumnStatus = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export const AgentColumnFinding = FindingRecord;              // was a 7-field subset
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),                            // was required
  agent_name: z.string(),                                     // snapshot, always present
  agent_deleted: z.boolean(),                                 // NEW
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: AgentColumnStatus,                                  // was done|failed|running
  error: z.string().nullable(),                               // NEW — AC-36's reason
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export const ConflictVerdict = z.union([
  Severity,                  // the agent flagged it
  z.literal('ignored'),      // the agent's run reached `done` and it did not flag
  z.literal('not_reviewed'), // the run is not `done`, so this agent has no opinion at all
]);
export const ConflictTake = z.object({
  run_id: z.string(),                                         // NEW — joins the take to its column
  agent_id: z.string().nullable(),
  persona: z.string(),
  verdict: ConflictVerdict,                                   // gained `not_reviewed`
  note: z.string().nullable(),                                // was a required string
});
export const Conflict = z.object({
  file: z.string(),
  start_line: z.number().int(),                               // replaces `line`
  end_line: z.number().int(),                                 // replaces `line`
  title: z.string(),
  takes: z.array(ConflictTake),
});
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  pr_title: z.string().nullable(),                            // NEW — AC-40
  head_sha: z.string().nullable(),                            // NEW — AC-109
  ran_at: z.string(),
  agent_count: z.number().int(),
  concurrency: z.number().int(),                              // NEW — AC-40's "how"
  total_duration_ms: z.number().int().nullable(),
  total_cost_usd: z.number().nullable(),
  total_cost_partial: z.boolean(),                            // NEW — AC-42
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export const MultiAgentRunCreated = z.object({
  id: z.string(),
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  skipped: z.array(z.object({ agent_id: z.string(), agent_name: z.string() })), // AC-117
});
/**
 * Enough to LINK to a multi-run, and deliberately not enough to draw one.
 * Served by both `GET /pulls/:id/multi-agent` and
 * `GET /repos/:id/multi-agent-runs/latest`.
 */
export const MultiAgentRunRef = z.object({
  id: z.string(), pr_id: z.string(), pr_number: z.number().int().nullish(), ran_at: z.string(),
});
export const LastSuccessfulRun = z.object({
  agent_id: z.string(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  ran_at: z.string().nullable(),
});
```

Routes P2 will serve, and nothing else:

| Method | Path | Body / returns |
|---|---|---|
| `POST` | `/pulls/:id/multi-agent-run` | `MultiAgentRunRequest` → `MultiAgentRunCreated` |
| `POST` | `/multi-agent-runs/:id/rerun` | no body → `MultiAgentRunCreated` |
| `GET` | `/multi-agent-runs/:id` | → `MultiAgentRun` |
| `GET` | `/pulls/:id/multi-agent` | → `MultiAgentRunRef \| null` — the newest multi-run of this PR |
| `GET` | `/repos/:id/multi-agent-runs/latest` | → `MultiAgentRunRef \| null` |
| `GET` | `/runs/last-successful` | → `LastSuccessfulRun[]` |

**Steps:**

1. **(R43, R10, R15, R18, R19, R26, R27, R30, R49, R50, R51, R54)** Rewrite `server/src/vendor/shared/contracts/observability.ts` to the shapes above. **`ConflictVerdict` carries the seventh contract change** (`SPEC-05 § D22`), and the difference between its last two values is written beside them in the file, not left to a reader: `ignored` means the agent looked and passed, `not_reviewed` means the agent was never there. Do **not** split `not_reviewed` into four values — the run state already sits in `AgentColumn.status` in the same response body, and two sources of it are two things that can disagree on screen (`§ D22`). `ConflictTake.run_id` is what lets the caption read that one source exactly: `agent_id` is nullable after a deletion (AC-118), so two deleted agents would give two takes the same key, and AC-125 needs the join to be exact rather than usually right. `AgentColumnFinding` becomes an alias of `FindingRecord` (import it from `./review-api.js`) with a comment saying why: the detail draws confidence, rationale, suggested fix and the line range, and the buttons must show accept/dismiss state on first paint — that is exactly `FindingRecord`, and a second shape would drift from it. Replace the file's header comment so it lists the **six** routes in the table above. Two of its existing claims need correcting rather than copying: it says `MultiAgentRun` is "the response of `POST /pulls/:id/multi-agent-run` and `GET /pulls/:id/multi-agent`", and neither half survives — the create answers `MultiAgentRunCreated`, and `GET /pulls/:id/multi-agent` answers `MultiAgentRunRef | null`. The second is a deliberate narrowing, not an oversight: the PR page wants a link, and answering it with a whole `MultiAgentRun` would make every PR page load pull up to 500 findings to render an anchor. **Check:** `cd server && pnpm typecheck` names every stale consumer, and there should be none — nothing imports these schemas today.
2. **(R11, R43)** Add `MAX_AGENTS_PER_MULTI_RUN`, widen `RunRequest` and add `MultiAgentRunRequest` in `contracts/platform.ts` exactly as above. `RunRequest`'s two existing fields are untouched, so `reviews/routes.ts:49`'s `RunRequest.parse(req.body ?? {})` keeps accepting `{}`, `{agentId}` and `{all:true}`. **Check:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — `test/contracts.test.ts` and `test/routes-smoke.test.ts` stay green.
3. **(R10, R15, R40, R42, R49)** Add to `server/src/db/schema/runs.ts`:
   - `multi_agent_runs` gains `concurrency: integer('concurrency').notNull().default(3)` and `headSha: text('head_sha')`, plus indexes `(workspace_id, ran_at desc)` and `(pr_id)`.
   - a new `multiAgentRunItems` table, `multi_agent_run_items`:
     - `runId uuid` **primary key**, `references(() => agentRuns.id, { onDelete: 'cascade' })` — the PK is what makes AC-25 ("at most one multi-run per run") true by construction rather than by a service remembering, and the cascade is AC-42/AC-99.
     - `multiRunId uuid NOT NULL references(() => multiAgentRuns.id, { onDelete: 'cascade' })`
     - `agentId uuid NOT NULL` with **no** `.references()` — deliberately, and `reviews.agentId` (`db/schema/reviews.ts:32`) is the precedent. `agent_runs.agent_id` is `ON DELETE SET NULL`, so a foreign key here would erase exactly the fact AC-118 needs.
     - `agentName text NOT NULL` — the name snapshot. It is stored nowhere else on a run, so without it a permanent link degrades to a column with no name.
     - `position integer NOT NULL` — the resolve order, so AC-46 survives an agent being deleted.
     - index `(multi_run_id, position)`; it is both the FK index Postgres will not create and the read path's exact order.
   - Add index `agent_runs (workspace_id, agent_id, ran_at desc)` — the access path of P2's `DISTINCT ON` estimate query.
   **Check:** `cd server && pnpm db:generate` writes `0021_*.sql`; read it before running `pnpm db:migrate`. The migration only adds, so the rename prompt in `server/AGENTS.md` § Schema does not arise — if `drizzle-kit` asks anything, stop and re-read the diff.
4. **(R38)** Add to `client/src/vendor/ui/nav.ts` a third `NAV` group `{ section: "GLOBAL", items: [ { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent", gKey: "m" } ] }`, **and** a matching `{ keys: "g m", label: "Go to Multi-Agent Review", group: "Navigation" }` in `SHORTCUTS`. This is a deliberate edit to a vendored file: it is unavoidable because `activeKeyFor()` (`app-shell/helpers.ts:29`) already returns `"multi-agent"` and `shell.json:26` already holds `nav.multi-agent`, so the key is fixed and only the `NAV` row is missing; any other key renders an untranslated label and a sidebar row that never lights. `vendor/ui` exists in one copy only — there is nothing to mirror. `g m` because p, o, d, s, a, c and `,` are taken. Write the reason as a comment beside the row, the way the `onboarding-tour` and `context` rows already carry theirs. **Check:** `cd client && pnpm test src/vendor/ui/nav.test.ts` — the existing "every g-shortcut is in both registries" case passes only if both halves landed.
5. **(R43)** Mirror: copy the two changed contract files from `server/src/vendor/shared/contracts/` to `client/src/vendor/shared/contracts/`. **Check:** `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing.

---

### P2 — Server: the multi-run slice, the grouper, bounded concurrency

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `server/src/modules/reviews/multi-run-service.ts` (new)
- `server/src/modules/reviews/conflicts.ts` (new)
- `server/src/modules/reviews/repository/multi-run.repo.ts` (new)
- `server/src/modules/reviews/repository.ts`, `run-executor.ts`, `routes.ts`, `helpers.ts`, `types.ts`, `repository/run.repo.ts`
- `server/README.md`
- `server/test/multi-agent-*.test.ts`, `server/test/multi-agent.it.test.ts`

**Contract it must honour:** the six routes and every schema in P1's block above. `MULTI_RUN_CONCURRENCY = 3` (the same number `platform/jobs.ts:40` already uses) and `MAX_AGENTS_PER_MULTI_RUN = 10` from `SPEC-05 § Non-functional requirements`.

**Placement, decided once for the whole package:** every file is inside `modules/reviews/`. A `modules/multi-agent/` slice would need to import `ReviewRunExecutor` and `ReviewRepository`, and `no-cross-module` forbids that edge including `import type`. Data access goes in `repository/multi-run.repo.ts` — `no-sql-outside-repository` matches the path `repository/`, not a file merely named `*-repository.ts`.

**Steps:**

1. **(R15, R16)** In `run-executor.ts`, extract the body of the `for (const { agent, runId } of jobs)` loop (`:200-232`) verbatim into a private `runJob(job, ctx, runLog, logger)` — the `try/catch` that isolates a per-agent failure moves with it, because AC-36 depends on one job's rejection never reaching the pool. Add a sixth parameter to `executeRuns`: `opts: { concurrency?: number } = {}`. Replace the loop with `await runWithConcurrency(jobs, opts.concurrency ?? 1, (job) => this.runJob(...))`. **The default of 1 is a criterion, not a fallback** (AC-35): with 1 the helper awaits jobs in `jobs` order, one at a time, which is the loop it replaces.
2. **(R15, R16)** Add `runWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void>` to `modules/reviews/helpers.ts` — Core ring, pure over its arguments, calls only the callback it is handed (the `estimateCost` pattern named in `onion-architecture` §3.8). It starts `min(limit, items.length)` workers pulling from a shared cursor, and it never rejects: a rejecting `fn` is the caller's business, so wrap each call. Not `p-queue`: the default-1 guarantee has to be provable by a hermetic unit test that observes ordering, and `p-queue` schedules through its own ticks. **Check:** the new unit test in S9.
3. **(R15, R17, R18)** In `repository/run.repo.ts`:
   - `createAgentRun` takes an optional `status: 'running' | 'queued'` defaulting to `'running'`. No existing caller passes it.
   - add `startAgentRun(db, runId)`: `UPDATE agent_runs SET status='running' WHERE id=$1 AND status='queued'`. Guarded, so it updates zero rows on the existing path.
   - widen `activeRunsForPull`'s filter to `status IN ('running','queued')` and `reapStaleRunningRuns`'s to the same, updating both docstrings. Only a multi-run ever writes `queued`, so neither read changes for any existing caller — and without the reaper widening, a server restart leaves a column stuck `queued` forever, contradicting AC-37.
   - add `lastSuccessfulRunPerAgent(db, workspaceId)`: `selectDistinctOn([agentRuns.agentId], …)` where `workspaceId = $1 AND status = 'done' AND agent_id IS NOT NULL`, ordered `agentId, ranAt desc`. Served by the index P1 S3 added.
   `runJob` calls `startAgentRun` before `runOneAgent`. **Check:** `pnpm exec vitest run --exclude '**/*.it.test.ts'` plus the integration case in S10.
4. **(R10, R19, R22, R40, R42, R49)** New `repository/multi-run.repo.ts` free functions + a `MultiRunRepository` class exported from `repository.ts` (beside `ReviewRepository`, same delegation style):
   - `createMultiRun(db, { workspaceId, prId, headSha, concurrency, items })` — **one `db.transaction`** inserting the `multi_agent_runs` row, then N `agent_runs` rows (`status: 'queued'`), then N `multi_agent_run_items` rows carrying `agentId`, `agentName` and `position`. Either all of it exists or none of it does (AC-27/AC-28/AC-30 all require "nothing created").
   - `getMultiRun(db, workspaceId, multiRunId)` — the multi-run row, workspace-scoped, plus its items joined to `agent_runs`, `agents` (left join — a missing row is AC-118's deleted agent), `reviews` and `findings`, ordered by `item.position`.
   - `latestMultiRunForRepo(db, workspaceId, repoId)` — newest `multi_agent_runs` joined to `pull_requests` on `pr_id`, filtered by `repo_id`, `limit 1`.
   - `latestMultiRunForPull(db, workspaceId, prId)` — newest `multi_agent_runs` for one `pr_id`, `limit 1` (R54). The `(workspace_id, ran_at desc)` index from P1 S3 serves both; neither returns findings.
   - `agentIdsOfMultiRun(db, workspaceId, multiRunId)` — the stored set in `position` order, for the re-run.
   Rows stay inside the module; `helpers.ts` maps them to DTOs (`onion-architecture` §3.5).
5. **(R10…R14, R17, R19, R41, R42, R48, R49)** New `multi-run-service.ts`, `class MultiRunService { constructor(private container: Container, private repo = new MultiRunRepository(container.db), private reviews = new ReviewRepository(container.db)) {} }`:
   - `create(workspaceId, prId, agentIds)` — dedupe preserving first-seen order (AC-29); resolve each id through `container.agentsRepo.getById(workspaceId, id)` and throw `NotFoundError` on the first miss, before any write (AC-28); order the resolved agents by the order `AgentsRepository.list` returns, i.e. `createdAt asc, name asc`, so AC-46 holds on every surface; resolve pull and repo through `this.reviews`; `createMultiRun(...)` in its transaction; then fire-and-forget `new ReviewRunExecutor(container, this.reviews, container.agentsRepo).executeRuns(ws, toReviewPull(pull), toReviewRepo(repo), jobs, logger, { concurrency: MULTI_RUN_CONCURRENCY })` — the same `void …catch(log)` shape `ReviewService.runReview` uses at `service.ts:155`. Returns `MultiAgentRunCreated` with `skipped: []`.
   - `rerun(workspaceId, multiRunId)` — reads the stored set, drops ids that no longer resolve in the workspace, and calls the same creation path with the survivors, returning them under `skipped` (AC-117). **This is why re-run has its own route:** AC-28 refuses a request naming an unknown agent, AC-117 requires the rest to run anyway, and the two are only compatible when the set comes from storage rather than from the client. Refuses with `AppError('multi_run_no_agents', …, 400)` when nothing survives.
   - `get(workspaceId, multiRunId)` — assembles `MultiAgentRun`: one `AgentColumn` per item (`agent_deleted` = the `agents` left join missed), `total_duration_ms` = max of the runs' `duration_ms`, `total_cost_usd` = sum of non-null `cost_usd`, `total_cost_partial` = any run has a null `cost_usd` **or** any run is non-terminal. **Build the columns first, then call `buildConflicts` with the column states**, passing each column's `run_id`, `agent_id`, `agent_name` and `status`: the takes' `not_reviewed` and the header's word must come from one read of one column, which is what AC-125 asks for and what `§ D22` rejected a second source of. Never stores the result (AC-97).
   - `latestForRepo(workspaceId, repoId)`, `latestForPull(workspaceId, prId)`, `lastSuccessfulRuns(workspaceId)` — thin passthroughs, each mapping the row to a `MultiAgentRunRef` in `helpers.ts` rather than returning it (`onion-architecture` §3.5).
   Column status mapping lives in `helpers.ts`: `columnStatus(raw: string | null): AgentColumnStatus` returns `raw` when it is one of the five and `'failed'` otherwise, so a value from an older code path cannot render a header with no state.
6. **(R28…R32, R50, R51)** New `conflicts.ts` — Core ring, pure, no `this`, no I/O, no clock:
   ```ts
   export const DEFAULT_TITLE_SIMILARITY = 0.5;
   export const DEFAULT_TITLE_STOP_WORDS: ReadonlySet<string>;   // fixed list, named in the file
   export function normalizeTitle(title: string): string[];
   export function buildConflicts(
     // multi-run order; `status` is what decides `not_reviewed`, so a caller that
     // forgets it cannot compile rather than producing invented silence
     agents: { runId: string; agentId: string | null; agentName: string; status: AgentColumnStatus }[],
     findings: { runId: string; finding: FindingRecord }[],
     opts?: { threshold?: number; stopWords?: ReadonlySet<string> },
   ): Conflict[];
   ```
   - `normalizeTitle`: lowercase, split on the **literal** `/[^a-z0-9]+/` (never a pattern built from the input — `SPEC-05 § Untrusted inputs`, `security` § ReDoS), drop empties, drop tokens shorter than 2, drop stop-words, dedupe, sort.
   - similarity = Jaccard over the two token sets; two empty sets score 0.
   - `related(a, b)` = same `file` **and** `a.start_line <= b.end_line && b.start_line <= a.end_line` (after normalising so start ≤ end) **and** (`a.category === b.category` **or** similarity ≥ threshold). AC-66 verbatim.
   - **Only findings of runs whose status is `done` enter the grouping at all.** A run that is `queued`, `running`, `failed` or `cancelled` persists no review (`run-executor.ts` `persistFailure` writes no `reviews` row), so this costs nothing in practice — and it is what keeps AC-119 and the position membership from ever disagreeing about the same agent.
   - positions = connected components of `related` (AC-68). A component is kept when it spans **two or more distinct `done` agents**; and when **fewer than two agents reached `done`**, every component is kept. The second clause is AC-128 and the `## Edge cases` row "one agent flagged, the rest of the runs failed → visible with the toggle off": a lone finding has to stay on screen beside its `not_reviewed` neighbours, or it reads as a finding the others rejected. With two or more `done` agents the first clause takes over, which is what leaves the section genuinely empty for AC-111.
   - **Heaviest finding** — the named rule AC-73 and AC-74 both need: severity rank (`CRITICAL` 3 > `WARNING` 2 > `SUGGESTION` 1) desc, then `confidence` desc, then `start_line` asc, then `id` ascending as a string. A total order, so it never returns two answers.
   - position `title` = the heaviest member's title (AC-74); `start_line` = min, `end_line` = max across members.
   - `takes`: one per entry of `agents`, **in that array's order** (AC-46, AC-70), each carrying its `run_id`. Three verdicts and the order of the tests is the rule:
     1. `status !== 'done'` → `{ verdict: 'not_reviewed', note: null }` — **first**, before anything is asked about findings, so AC-119's "iff" holds and a failed run cannot decay to `ignored` once the multi-run ends (AC-120);
     2. else the agent has a member here → `{ verdict: its heaviest member's severity, note: that finding's `rationale` }`;
     3. else → `{ verdict: 'ignored', note: null }` (AC-71 — `null`, not `''`; an empty string is a note that is empty).
   - result order (AC-69): `file` asc, `start_line` asc, `end_line` asc, `title` asc, smallest member id asc.
   The note is **not** truncated here — AC-72 says the note is the rationale, and clamping is the renderer's job (P4 S5). **Nothing about conflict-vs-agreement is computed here**: AC-126 is stated entirely over `takes`, so it stays one function on the client (P4 S6) and the contract gains no `is_conflict` field that could disagree with the takes beside it.
7. **(R7, R10, R11, R12, R41, R48, R54)** Register the six routes in `modules/reviews/routes.ts`, each `await getContext(container, req)` first:
   - `POST /pulls/:id/multi-agent-run` — `schema: { params: IdParams, body: MultiAgentRunRequest }`, `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }`. The schema's `.min(1)` is AC-27 and `.max(10)` is AC-30, both answered as a 422 in the structured envelope before the handler runs, with nothing created. The cap applies to the array **as named**, per AC-30's wording, so eleven ids of which nine are unique is refused; dedup (AC-29) happens after.
   - `POST /multi-agent-runs/:id/rerun` — `schema: { params: IdParams }`, the same 5/min bucket.
   - `GET /multi-agent-runs/:id` — `schema: { params: IdParams }`; `undefined` → `NotFoundError` (AC-95, indistinguishable from another workspace's).
   - `GET /pulls/:id/multi-agent` — `schema: { params: IdParams }`, the newest multi-run of that PR as a `MultiAgentRunRef`, or `null` when the PR has none (R54). `null`, not 404, for the same reason as the row below: "this PR has never been compared" is a state the page renders, not a failure it reports, and a 404 here would put an error toast on every PR that has not been through this feature.
   - `GET /repos/:id/multi-agent-runs/latest` — `schema: { params: IdParams }`, returns `null` rather than 404 when the repo has none (AC-94 is a page state, not an error).
   - `GET /runs/last-successful` — no params.
   Update the route list in the file's header comment and the `Review & runs` node of the API map in `server/README.md`.
8. **(R28…R32, R50, R51)** `test/multi-agent-conflicts.test.ts` — hermetic, fixed finding fixtures, no model. Grouping: same file + overlapping range + same category groups; same file + overlapping + different category but similar titles groups; same file + non-overlapping does **not** group; chained A~B, B~C puts all three in one component; with three `done` agents a single-agent cluster is absent; an agent with two members in one position speaks through the heaviest; the position title equals the heaviest member's title; the same input twice gives a deep-equal result; 10 agents × 50 findings under 250 ms (`SPEC-05 § Non-functional requirements`). Verdicts: a `done` agent with no member here gets `ignored` and `note: null`; each of `queued`, `running`, `failed` and `cancelled` gets `not_reviewed` and `note: null` (AC-119); a `failed` run with no findings does **not** come back as `ignored` (AC-120 — the regression the amendment exists for); one flagging agent with two `failed` peers still yields a position, and it is the only case where a single-agent component survives (AC-128); with two `done` agents that overlap nowhere the result is empty (AC-111).
9. **(R15, R16)** `test/reviews-concurrency-default.test.ts` — built on the harness in `test/reviews-repo-intel-once.test.ts` (stub container, stub repository, `MockLLMProvider`). Two cases, and the first is the one that must fail if anybody changes the default:
   - `executeRuns` called **with no sixth argument** starts agent N+1 only after agent N has settled, and the settle order equals the `jobs` order. Instrument by resolving each agent's engine call on a deferred promise and asserting at most one is in flight.
   - `executeRuns` called with `{ concurrency: 3 }` has three in flight at once for five jobs, and one job rejecting does not stop the other four (AC-36).
10. **(R10…R19, R40, R42, R49, R54)** `test/multi-agent.it.test.ts` — testcontainers Postgres, the `reviews.it.test.ts` shape. Cases: create with two agents → one `multi_agent_runs` row, two `agent_runs` rows written `queued`, two `multi_agent_run_items`; `waitForPrRuns` until terminal, then `GET /multi-agent-runs/:id` returns two columns with findings and the conflicts array; a single chosen agent still creates a multi-run (AC-24); a duplicate id creates one run (AC-29); an agent id from another workspace is refused with nothing created (AC-28); a multi-run id from another workspace is "not found" (AC-95); `DELETE /runs/:runId` leaves the multi-run readable with one column fewer (AC-99); deleting an agent leaves its column named and `agent_deleted: true` (AC-118), and a re-run then reports it under `skipped` and runs the rest (AC-117); `reviews.agent_id` still resolves each finding to its agent (AC-96); and one agent forced to fail while another flags something → the failed agent's takes come back `not_reviewed` with `note: null` after the multi-run has ended, not `ignored` (AC-120 through the real persistence path, where `persistFailure` writes no review at all); `GET /pulls/:id/multi-agent` answers **`null` with a 200** for a PR that has never been compared and the newest one after two multi-runs on the same PR — a 404 here is the failure mode this case exists to catch, because it would put an error on every untouched PR page (R54).

---

### P3 — Client: shared foundations and the PR page

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `client/src/components/run-trace-drawer/**` (new location)
- `client/src/components/finding-card/**` (new location)
- `client/src/lib/agent-color.ts`, `client/src/lib/line-numbers.ts`, `client/src/lib/hooks/multi-agent.ts`
- everything under `client/src/app/repos/[repoId]/pulls/**`
- `client/messages/en/prReview.json`

**Contract it must honour:** P1's block above, plus the six routes in P1's table. `MAX_AGENTS_PER_MULTI_RUN` is importable as a **value** from `@devdigest/shared` on the client — `next.config.mjs` carries the webpack alias that makes the vendored ESM barrel resolvable, and only `pnpm build` or `next dev` ever catches a break in it.

**Steps:**

1. **(R34)** Move `app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/` to `src/components/run-trace-drawer/`, whole and unmodified, its inner `_components/` folder included — every internal import stays a relative path that still resolves, which is what makes "the PR page behaves identically" checkable rather than argued. `frontend-architecture` § step 4 puts a component with consumers in two routes at `src/components/<kebab-name>/`; `src/components/diff-viewer/` is the existing precedent for a shared component with nested parts. Repoint `pulls/[number]/page.tsx:19` and the `vi.mock` at `page.test.tsx:55`. Its own `RunTraceDrawer.test.tsx` moves with it and is **not** edited. What must stay true, in words, because a later step could quietly take it away: the drawer still defaults to the `log` tab while `running` and to `trace` otherwise; it still falls back to the persisted trace log when the live buffer is empty; and it still disables Copy raw output until `trace.raw_output` loads. **Check:** `cd client && pnpm test` — the moved test passes unchanged, `page.test.tsx` passes.
2. **(R26, R27)** Move `.../FindingCard/` to `src/components/finding-card/` and give it one new optional prop: `extraActions?: React.ReactNode`, rendered after the Dismiss button inside the existing `s.actions` row. When it is absent the rendered output is what it is today — the PR page passes nothing. Add one case to the moved `FindingCard.test.tsx`: with no `extraActions` the action row contains exactly two buttons. Repoint `FindingsPanel.tsx:9`. Move `lineLabel` out of the card's `helpers.ts` into `src/lib/line-numbers.ts` (which already holds `MAX_LINE`) and re-export nothing — update both call sites. Two routes now use it, which is the second consumer `frontend-architecture` § principle 2 requires, and the four under-promotions in `client/INSIGHTS.md` are what skipping it looks like.
3. **(R21)** New `src/lib/agent-color.ts`: `agentColor(agentId: string): string`, a fixed palette of CSS variables (or hex fallbacks) indexed by an FNV-1a hash of the id. **Only** the id — not the position in a list, or the agent changes colour between the picker (all agents) and the results (the chosen ones), which is exactly where the colour was supposed to connect the two screens. The palette is finite, so two agents can collide; that is accepted, and it is why AC-45 requires the name beside every use. Unit test: same id → same colour across calls; a different list order does not change any colour; every returned value is in the palette.
4. **(R7, R10, R33, R41, R48, R53, R54)** New `src/lib/hooks/multi-agent.ts`, TanStack Query only — no `fetch` in a component (`client/AGENTS.md`):
   - `useCreateMultiAgentRun()` → `POST /pulls/:prId/multi-agent-run`
   - `useRerunMultiAgentRun()` → `POST /multi-agent-runs/:id/rerun`
   - `useMultiAgentRun(multiRunId)` → `GET /multi-agent-runs/:id`, **with no `refetchInterval` at all.** This is the one place the amendment of 2026-08-26 overturns the earlier draft: `§ Non-functional requirements` now caps the section at "the page open plus at most one recompute per run that reached a terminal state — at most **11** per multi-run at a ceiling of 10 agents — and no timer polling is added, because the terminal signal already arrives on the existing event stream." A 4-second interval over the 1 min 35 s measured in `INSIGHTS.md:450` is roughly 24 refetches, so the `usePrRuns` shape (`hooks/reviews.ts:41`) that the earlier draft copied is exactly what must **not** be copied here.
   - `useMultiRunColumnEvents(runIds: string[])` → `Record<runId, { lastMsg: string | null; closed: boolean }>`: one `EventSource` per run, attribution by `RunEvent.runId`, cleanup on unmount, and an `onRunClosed(runId)` callback fired **once** per run as its stream ends. That callback is what calls `refetch()` on `useMultiAgentRun` — one fetch on open, one per terminal run, nothing else (AC-134 and the ceiling). It is a **new** hook beside `useRunEvents`, not a change to it: `useRunEvents` is what the drawer and `RunStatus` both stream through, and AC-81 forbids moving under them. A queued run still gets a stream — `failAll` and `runOneAgent` both end with `runBus.complete(runId)`, so a run that never starts still closes.
   - `useLatestMultiAgentRun(repoId)` → `GET /repos/:id/multi-agent-runs/latest`
   - `useLatestMultiAgentRunForPull(prId)` → `GET /pulls/:id/multi-agent` (R54). `useCreateMultiAgentRun`'s `onSuccess` invalidates its key, so the server read converges on the run just started instead of staying one behind it.
   - `useLastSuccessfulRuns()` → `GET /runs/last-successful`
5. **(R36)** Replace the body of `_components/RunReviewDropdown/` with a set picker: a checkbox per agent (every agent listed, disabled ones marked and still selectable — the rule `RunReviewDropdown.tsx:50-58` already sets, restated because the file's old body goes away), all enabled agents preselected, a footer button labelled by count exactly as R6, and the merged/closed warning row kept verbatim (`warnMerged`, `t("runReview.mergedWarning")`, the dimmed trigger and its `title`). It calls `useCreateMultiAgentRun` and reports `{ multiRunId, runIds }` up. Keep the folder name or rename it — if renamed, `PrDetailHeader.tsx:5` is the only importer. Selection is local `useState`: it is not shareable and it is not server data (`frontend-architecture` § principle 5).
6. **(R37, R54)** In `pulls/[number]/page.tsx`, resolve the link from **two** sources and pass the winner into `FindingsTab`, which renders a non-blocking link to `/repos/:repoId/multi-agent/:multiRunId` immediately above `RunStatus`. The user stays on the PR page (AC-89): no `router.push`.
   - **The freshly created id wins while it is there.** The picker hands it up on run start; the server's answer was read before that run existed, so preferring the server read would show a link to the *previous* comparison for as long as the invalidated query takes to come back. `justStartedId ?? latest?.id ?? null` is the whole rule.
   - **The server read is what makes the link survive.** `useLatestMultiAgentRunForPull(prId)` supplies it on every open of the page, so a reload — or a visit tomorrow — still shows the way back. That is the point of R54.
   - **The created id is local `useState`, not a query parameter.** The first draft of this plan put `multiRun` in the URL, and with a server read behind it that parameter now carries nothing the page cannot ask for: it is not shareable state (`frontend-architecture` § principle 5 — the shareable address is the multi-run's own URL), and dropping it removes the one place this step would have had to write the URL. So `onRunStart` keeps its single `setParams({ tab: "findings" })` and this step adds **no** `router.replace` at all, which is the cleanest possible obedience to the one-write-per-interaction rule the page's own comment at `:90-94` records.
7. **(R36, R37, R54)** Copy in `client/messages/en/prReview.json` for the picker footer, the count labels and the results link — the link's own label has to read sensibly both a second after a run starts and a day later, so do not word it as "your run has started". Compare the picker against `specs/assets/SPEC-05-multi-agent-review-configure-run.png` element by element and report differences rather than resolving them (`client/AGENTS.md` § A design is an acceptance criterion). **Check:** `cd client && pnpm lint && pnpm typecheck && pnpm test`.

---

### P4 — Client: the Multi-Agent Review pages

**Agent:** implementer · **Depends on:** P1, P3

**Owns:**
- `client/src/app/repos/[repoId]/multi-agent/**`
- `client/messages/en/runs.json`
- `client/src/app/globals.css` (only new `dd-` media-query blocks appended)

**Contract it must honour:** P1's block and route table; and from P3 — `@/components/run-trace-drawer`, `@/components/finding-card` (with `extraActions`), `@/lib/agent-color`, `@/lib/line-numbers` (`lineLabel`), `@/lib/hooks/multi-agent`. Each of those is imported, never re-implemented.

**Steps:**

1. **(R39)** Three route segments under `app/repos/[repoId]/multi-agent/`:
   - `page.tsx` — the landing. Calls `useLatestMultiAgentRun(repoId)`; a hit `router.replace`s to that multi-run's own URL so the address bar ends on the permanent link; a miss renders the AC-94 empty state with a link to Configure run. **This split is inferred, not stated** (requirement row R39): AC-92 puts Configure run on a repo-scoped path and AC-94 describes a repo-scoped page that is empty when the repo has no multi-runs, and both are only true at once if "Multi-Agent Review" is the parent of Configure run. The mockups' breadcrumbs say the same thing — `Multi-Agent Review › Configure run` and `Multi-Agent Review › #482`.
   - `configure/page.tsx` — Configure run.
   - `[multiRunId]/page.tsx` — the results.
   Every one is `"use client"`, thin, and delegates to a colocated `_components/<Name>/`; `client/AGENTS.md` § Conventions. No new `<Suspense>`: `app/layout.tsx:29` already wraps children, which is what lets these pages call `useSearchParams`. Each page renders `RepoNotFound` on `useRepoNotFound(repoId)` exactly as `pulls/[number]/page.tsx:151` does (AC-93).
2. **(R1…R6)** `configure/_components/ConfigureRunView/` — heading, subtitle, the two numbered steps, the PR dropdown (`usePulls(repoId)`, every status listed, the merged/closed warning reused from the PR page's copy), the "Pick a pull request first" empty state gated on no PR, the agent cards (`useAgents()`, every agent, disabled marked and selectable, enabled preselected on first open), Select all / Clear all, and the CTA whose label follows the count. `?pr=` carries the chosen PR in the URL so "Configure run" from the results page (AC-43) can arrive with it. Labels come from the mockup and `specs/assets/SPEC-05-multi-agent-review-screen.jsx`; do not paraphrase them.
3. **(R7, R8, R9)** The estimate line beside the CTA and the per-card time/cost, both from `useLastSuccessfulRuns()`. Time = max, cost = sum, over the **chosen** agents only. An agent with no row contributes to neither and shows `—`; an agent whose row has `cost_usd: null` still contributes its `duration_ms` to the maximum. A sum missing at least one chosen agent carries a count of how many. A sum with no contributors renders `—`. Use `formatCost` from `@/components/run-cost-badge` — it already draws the line between "no data" (`—`) and "genuinely free" (`$0.0000`), and a second implementation of that rule is how the two disagree. The fan-out text is the honest one (`SPEC-05 § D9`): in-process execution with a stated ceiling, taken from `MultiAgentRun.concurrency`, never "worktrees" and never "p-queue". Unit-test the arithmetic as a pure helper, not through the DOM.
4. **(R19…R24, R33)** `[multiRunId]/_components/` — the meta row (PR number, title, agent count, execution description, total time, total cost with the partial mark from `total_cost_partial`), the Columns/Tabs switch, "Configure run", and the Columns grid: one column per agent, header with name + `agentColor(agent_id ?? agent_name)` + status + time + cost + score (`—` when null), body of finding cards, footer with the count and "View trace". Live status per column comes from `useMultiRunColumnEvents`; a reload restores it from the one `useMultiAgentRun` fetch the page makes on open (AC-78 + AC-79 are two halves of one behaviour, and neither of them is a timer). The header's status word comes from `runStateLabel(status)` in the view's colocated `helpers.ts` — **the same function the section's `not_reviewed` caption calls** (P4 S6), because AC-125 requires the two to say the same word and two maps are two things that drift. More columns than fit scroll horizontally with none hidden — the `overflowX` rule belongs in a `dd-` class in `globals.css`, not in `styles.ts` (`client/AGENTS.md`).
5. **(R25, R26, R27, R44, R45, R46)** The Tabs mode: a tab per agent with name and score, the selected agent's header (summary, score, time, cost, View trace), and the finding list rendered with the promoted `FindingCard`. **Do not pass `repoFullName` or `headSha`** — with them the card builds a github.com link out of a model-written file path, and `SPEC-05 § Untrusted inputs` says this feature treats that path as an opaque string and makes no link out of it. Pass `extraActions` holding: `Learn` and `Turn into eval case`, both `disabled` and wired to nothing (AC-62 — `modules/reviews/findings.ts` accepts only `accept` and `dismiss`), and `Reply to author`, which opens an editable body prefilled from `finding.rationale`, sends `{ path: finding.file, line: finding.start_line, body }` through the existing `useCreatePrComment` only after an explicit confirm, and on success shows the returned `html_url`. On `github_unavailable` or `github_comment_failed` show `ApiError.message` beside the finding **without clearing the field**. Warn before sending when the PR is `merged`/`closed` (naming the PR's state as the cause) and when `multiRun.head_sha !== pr.head_sha` (naming a possible line shift). Accept/Dismiss go through the existing `useFindingAction`, and `accepted_at`/`dismissed_at` arriving in the response is what makes AC-63 true without a second request.
6. **(R28…R32, R47, R50, R51, R52, R53)** The "Where agents disagree" section, rendered in **both** modes from `multiRun.conflicts`, **from the first open of the page** — including while agents are still `queued` or `running` (AC-133, `§ D24`). Nothing is grouped here; the only computation is the filter and the empty-state choice.
   - **Three take states, three renderings.** Flagged → the severity marker in that severity's colour plus the note, clamped visually with a `dd-` line-clamp class. `ignored` → a grey **round** marker, `did not flag`, nothing under it. `not_reviewed` → a marker differing from the grey one **in shape**, not merely in shade (AC-121 — a hollow ring or a dash, decided against the design and reported if it differs), **no note at all** (AC-122), and a caption naming the run state through `runStateLabel(column.status)`: `queued` / `reviewing` / `run failed` / `run cancelled` (AC-123). The take finds its column by `take.run_id`, never by `agent_id` (AC-125, and two deleted agents both carry `agent_id: null`). **`did not flag` must not appear on a `not_reviewed` take under any run state** (AC-124).
   - **Do not port `flagged = t.verdict !== "ignored"` from `specs/assets/SPEC-05-multi-agent-review-screen.jsx:35`.** On `not_reviewed` that expression is `true`, so a failed agent renders as a yellow severity chip (`screen.jsx:39-40`) — the fifth named divergence from the mockup in `SPEC-05 § П'ять розходжень з макетом`. Branch on the three values explicitly.
   - **Conflict rule (AC-126), one pure function in the view's `helpers.ts`:** drop every `not_reviewed` take; if fewer than two remain it is not a conflict (AC-127); otherwise it is a conflict when at least one of the rest flagged while at least one is `ignored`, or two of them carry different severities. The toggle on keeps only conflicts; the toggle off shows every position **with** its `not_reviewed` takes (AC-128, AC-75) — that is what stops a lone finding reading as one the others disagreed with. Neither state ever filters the columns or the tabs (AC-77).
   - **The four empty texts are empty-*state* texts:** they are consulted only when the list the toggle leaves is empty, and then in exactly this order, first match wins (AC-132) — (1) one agent in the multi-run → "nothing to compare with" and how to add agents (AC-110); (2) two or more agents but fewer than two runs at `done` → "nothing to compare yet" **with the three numbers**: how many finished, how many are still running, how many never got there — never claiming agreement and never claiming different places (AC-129, AC-130), and when nothing is still running it also offers the re-run of P4 S7 (AC-131); (3) at least two runs at `done` and no shared position → "the agents looked at different places" (AC-111); (4) positions exist but none is a conflict and the toggle is on → present it as the **result**, "they agreed everywhere" (AC-112), which is the best answer this screen can give and must not read as missing data. Four texts, no string shared between them (AC-113).
   - **While any column is non-terminal the section carries a visible not-final mark** (AC-133), and it keeps that mark plus whatever is already on screen if a recompute fails — TanStack Query leaves the previous `data` in place on a failed refetch, so this is a matter of not blanking the section on `isError`, and it needs a test because the default is easy to undo (AC-135).
7. **(R34, R35, R48, R52)** `?view`, `?agent`, `?conflicts`, `?trace` all live in the URL through one `setParams` helper of the same shape as `pulls/[number]/page.tsx:90-100` — one `router.replace` per interaction, never several. `?trace` mounts `@/components/run-trace-drawer` with `running` taken from that column's status; nothing about the drawer is configured differently from the PR page (AC-80). "Run again" calls `useRerunMultiAgentRun`, then `router.push`es to the new id (AC-116) and names anything the response reported under `skipped` (AC-117).
8. **(R1…R6, R19…R32, R47, R50, R52)** `client/messages/en/runs.json` — **rewrite the `page` block, do not wire it as it stands.** It was written for an older design of this screen (`client/INSIGHTS.md` § "`messages/en/runs.json` already holds a `page` block for a Multi-Agent screen that no longer exists"). Specifically: delete `page.runAll` (there is no "run all" — the screen picks a set), replace `page.subtitle` and `page.meta` (which promises `fan-out via p-queue`, a mechanism `modules/reviews` never uses) with the mockup's subtitle and an honest fan-out line parameterised on the concurrency ceiling, replace `page.noAgents.body` and `page.noRun.*` for the same reason, and replace the single `conflicts.empty` with the **four** strings AC-113 requires. `conflicts.didNotFlag` stays and is used only on an `ignored` take. New keys this screen needs and the file does not have: the four run-state words behind `runStateLabel` (`queued`, `reviewing`, `run failed`, `run cancelled`), read by both the column header and the `not_reviewed` caption from the same key so AC-125 cannot be broken by editing one of two strings; the not-final mark for the live section (AC-133); and the second empty text, which takes **three numbers as ICU arguments** rather than being a finished sentence — `{done}` finished, `{running}` still running, `{unfinished}` never got there (AC-129). `runs.json` already uses ICU plurals (`column.findingsCount`), so this is the file's own idiom rather than a new one. Keep `viewTrace`, `column.*`, `tabs.noSummary`, `finding.trifecta` and every `trace.*` / `drawer.*` key — the last two belong to the moved drawer and must not move namespace. Walk all four mockups element by element before writing copy, and report every difference instead of resolving it.

---

### Dispatch order

```
P1 ──┬── P2 ─────────────┐
     └── P3 ── P4 ───────┴── gates, then /pr-self-review
```

1. **P1 alone.** It is the only package allowed to write under either `vendor/` tree. Nothing else starts until `diff -r server/src/vendor/shared client/src/vendor/shared` is silent and `cd server && pnpm db:migrate` has run — seven of the contract edits sit on the `server/` ↔ `client/` seam, and two packages editing their own copy in parallel is exactly how `shared-sync` fails on both.
2. **P2 and P3 in parallel** once P1 has landed. They share no file.
3. **P4** once P3 has landed. It imports four things P3 creates and re-implements none of them. It does not need P2 to have finished to compile — the contracts are P1's — but the feature cannot be exercised end to end until P2 is up.

**The amendment of 2026-08-26 does not move any of these boundaries**, and it is worth saying
plainly rather than leaving to inference. `not_reviewed` is one more value in a file P1 already
rewrites; the narrowed conflict rule is a signature and three branches inside `conflicts.ts`,
which P2 already creates; the recompute ceiling removes an option from a hook P3 already writes;
and the four empty states and the third marker are states of a section P4 already builds. The one
new coupling is *within* a package, not across: P2 S5 must build the columns **before** it calls
the grouper, because the takes' `not_reviewed` and the header's word now come from one read of one
column (AC-125).

---

## Tests

| Suite | Files | Command |
|---|---|---|
| server · unit | `test/multi-agent-conflicts.test.ts` (new), `test/reviews-concurrency-default.test.ts` (new), `test/contracts.test.ts` (touched) | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| server · integration | `test/multi-agent.it.test.ts` (new) | `cd server && pnpm exec vitest run .it.test` |
| client | `src/lib/agent-color.test.ts` (new), `src/lib/line-numbers.test.ts` (new or extended), `src/components/finding-card/FindingCard.test.tsx` (moved + one case), `src/components/run-trace-drawer/RunTraceDrawer.test.tsx` (moved, unedited), `src/vendor/ui/nav.test.ts` (existing, extended), configure-view / results-view / conflicts-section / picker tests (new), PR-page link test (new) | `cd client && pnpm test` |

The PR-page link test is the one that proves R54 rather than restating it: mount the PR page with
`GET /pulls/:id/multi-agent` answering a ref and **no run started in this session**, and assert the
link is on screen — that is the reload case, and it fails against any implementation that keeps the
id only in page state or in a query parameter. A second case pins the precedence: with both a fresh
create response and an older server ref, the link points at the fresh one.

The conflicts-section suite carries five cases the amendment added and nothing else covers: the
three take renderings side by side (severity chip · grey round marker + `did not flag` · a
different-shaped marker + a run-state caption + no note); `did not flag` absent from every
`not_reviewed` take at all four run states (AC-124); the caption and that run's column header
printing the same word (AC-125); the four empty texts firing in AC-132's order on four fixtures,
sharing no string; and a failed refetch leaving the previous positions and the not-final mark on
screen instead of an empty section (AC-135).

**Integration is in scope** — `test/multi-agent.it.test.ts` is the only place the transaction, the workspace scoping, the cascade on run delete and the deleted-agent column can be exercised at all. Run it locally; `pr-self-review` deliberately does not (`gates.md` § "Integration tests are deliberately absent").

**e2e is not in scope.** Nothing under `e2e/` is touched.

Two tests carry more weight than the rest and must be written before the code they guard, then watched to fail:

- **the default-concurrency case** (P2 S9) — it fails if anybody changes `opts.concurrency ?? 1`, which is the single line standing between this feature and a behaviour change on the PR page and on `POST /reviews/diff`;
- **`FindingCard` with no `extraActions`** (P3 S2) — it fails if the promotion changes what the PR page renders;
- **a `failed` run with no findings comes back `not_reviewed`, never `ignored`** (P2 S8) — this is the defect the 2026-08-26 amendment exists for, and it is invisible in every other test: the shape is identical, only the word is a lie.

---

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`.

```sh
cd server && pnpm arch
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd client && pnpm lint
cd client && pnpm typecheck
cd client && pnpm test
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

`reviewer-core` is not touched, so its two gates skip — and `skip` is not `ok`.

Then `/pr-self-review` before any push: `.claude/settings.json` registers `scripts/pr-self-review/gate.sh` as a `PreToolUse` hook that refuses `git push` and `gh pr create` without a fresh passing verdict for the current `HEAD`.

---

## Risks (from INSIGHTS.md)

| Risk, quoted | What this plan does |
|---|---|
| *"The multi-agent fan-out is SEQUENTIAL — `runReview` runs N agents one after another … `p-queue` is a dependency but is used only in `platform/jobs.ts:40` and `repo-intel/pipeline/full.ts:132` — never in `modules/reviews`."* (`server/INSIGHTS.md` § Codebase Patterns) | The estimate is `max` only because P2 S1–S2 make concurrency real for this path. Every piece of copy about fan-out is written from `MultiAgentRun.concurrency`, never from the word "parallel" (P4 S3, S8) |
| *"Every `agent_runs` row of a fan-out is written `status: 'running'` up front … a per-agent live status read straight from that column is honest only about the set, never about the individual agent. Any UI that shows one lane per agent needs a `queued` state that this column cannot currently express."* (same) | P1 S1 adds `queued` and `cancelled` to `AgentColumnStatus`; P2 S3 makes `createAgentRun` write `queued` for a multi-run and adds the guarded `startAgentRun` transition, plus the reaper widening without which a restart strands a column at `queued` |
| *"`messages/en/runs.json` already holds a `page` block for a Multi-Agent screen that no longer exists … an implementer who reuses these keys ships a screen whose copy promises 'run all agents' over a picker, and names a queue that never runs."* (`client/INSIGHTS.md` § What Doesn't Work) | P4 S8 names each stale key and says rewrite or keep, one by one. `page.runAll` is deleted, not repurposed |
| *"The file-placement rule is applied by eye, and drifts in both directions … four violations of that one item on a single branch, in **both** directions."* (`client/INSIGHTS.md` § What Doesn't Work) | Every move in P3 S1–S3 names its second consumer and its target folder from `frontend-architecture` § step 4, and nothing is promoted speculatively |
| *"Several keys at once, because one `router.replace` per key races: each builds its params from the same stale `search`, so the last write wins and the others are lost."* (`pulls/[number]/page.tsx:90`, from `client/INSIGHTS.md:585-592`) | P3 S6 writes `multiRun` in the same `setParams` call as `tab`; P4 S7 gives the results page one `setParams` helper for all four keys |
| *"A link pinned to the indexed commit 404s on every file a PR adds."* (`client/INSIGHTS.md` § What Doesn't Work) | Sidestepped rather than repeated: P4 S5 passes no `repoFullName`/`headSha` to `FindingCard`, so this screen builds no commit-pinned link at all — which is also what `SPEC-05 § Untrusted inputs` requires |
| *"An integration test that starts a review makes LIVE OpenRouter calls unless `secrets` is overridden."* (`server/INSIGHTS.md`, cited by `TESTING.md`) | P2 S10 overrides `secrets` and `llm` with the mocks `reviews.it.test.ts` already uses. A multi-run fans out to up to ten paid calls, so this one is not optional |

---

## Alternatives rejected

- **A `modules/multi-agent/` slice of its own.** `SPEC-05 § Module interactions` calls it "a new module slice", and `no-cross-module` makes that impossible without either moving `ReviewRunExecutor` into `_shared/` or hanging it off the container as a new port with a mock obligation — both are edits to the shared execution path, which is precisely what G6 and AC-35 protect. Everything lands in `modules/reviews/` instead, which already owns `agent_runs`, `reviews`, `findings` and the executor. The slice's *parts* are still what the spec named: routes, service, repository, and a pure grouping function.
- **A `multi_run_id` column on `agent_runs`** instead of the `multi_agent_run_items` table. It expresses "at most one" just as well, but it has nowhere to put the agent-name snapshot AC-118 needs or the `position` AC-46 needs, and adding three columns to the table every existing run path writes is a wider blast radius than a new table nothing else touches.
- **`p-queue` for the bounded fan-out.** Already a dependency and already used inside `modules/` (`repo-intel/pipeline/full.ts:132`), so it was the obvious reach. Rejected because the default-of-1 guarantee has to be provable by a hermetic unit test that observes ordering, and a queue that schedules through its own ticks makes "byte-for-byte the loop it replaced" an argument rather than an assertion.
- **Making concurrency the default for every path.** `SPEC-05 § D10` rejects it and AC-35 forbids it. Recorded here too because it is the one-line change someone will be tempted to make while reading `executeRuns`.
- **Re-running through `POST /pulls/:id/multi-agent-run` with the client filtering out deleted agents first.** Cheaper by one route, and it keeps AC-28 intact. Rejected because AC-117 makes the *system* responsible for skipping, and a client-side filter races: an agent deleted between the page load and the click turns a re-run into a 404 instead of a run with one name in `skipped`.
- **Building a second finding card for the results page** rather than promoting `FindingCard`. Rejected on `frontend-architecture` § principle 2 and the four under-promotions `client/INSIGHTS.md` records; the optional `extraActions` slot is what keeps the PR page's render identical while giving AC-60 its five buttons.
- **Four verdict values instead of one** — `failed`, `cancelled`, `running`, `queued` inside `ConflictTake.verdict`. Rejected by `SPEC-05 § D22` and recorded here because it is the obvious first instinct when reading AC-123: the caption names four states, so why not carry four values? Because the run state is already in `AgentColumn.status` in the same body, and a section reading "reviewing" beside a column reading "run failed" is a defect the reader can see. The take says **that** there is no opinion; the column says **why**.
- **Counting a failed run as silence** — the pre-amendment behaviour, where a failed agent's take was `ignored`. It survives nowhere: `SPEC-05 § D23` rejects it in the filter as well ("the toggle would show positions where nobody disagreed with anybody"), and counting it as disagreement instead is worse, because that is invented dissent rather than invented silence.
- **A `refetchInterval` on `useMultiAgentRun`**, copied from `usePrRuns`. It is what the first draft of this plan specified, and the amended `§ Non-functional requirements` rules it out: the terminal signal is already on the event stream, and a 4-second timer over the 1 min 35 s in `INSIGHTS.md:450` is roughly 24 recomputes against a stated ceiling of 11.
- **Hiding the section until every run finishes.** `SPEC-05 § D24` rejects it twice over: it throws away the earliest useful signal — two agents finished and already disagree — and it leaves half the screen dead for a minute and a half before the content jumps in under the reader's hands.
- **Answering `GET /pulls/:id/multi-agent` with a whole `MultiAgentRun`**, which is what the contract's header comment promised before this plan. Rejected: the PR page renders one anchor from it, and the full shape carries every column's every finding — up to 500 of them with their rationales — fetched on every PR page load. `MultiAgentRunRef` is the same shape the repo-scoped latest read already returns.
- **Keeping the PR page's multi-run id in `?multiRun`**, which is what the first draft of this plan specified. Once the id is readable from the server it is redundant, it is not shareable state in its own right (the multi-run's own URL is), and removing it means this step writes the URL zero times instead of racing the `tab` write it would have had to join.
- **Computing the positions on the client.** The contract already carries `conflicts`, AC-98 wants one request, and a pure server function is the only version `test/multi-agent-conflicts.test.ts` can pin on a fixed finding set.

---

## Verification

Each line names the criterion it proves and is observable without reading the source.

1. **`cd server && pnpm db:migrate`** applies `0021` cleanly; `\d multi_agent_run_items` shows `run_id` as the primary key and both indexes. — R10, R42
2. **`./scripts/dev.sh`**, then in the sidebar: a GLOBAL section with one row, "Multi-Agent Review"; pressing `?` lists `g m`; pressing `g` then `m` navigates; the row is lit on all three of the feature's pages and unlit on the PR page. — R38
3. **Open `/repos/:repoId/multi-agent` on a repo with no multi-runs** → the empty state with a link to Configure run. — R39
4. **On Configure run with no PR chosen** → "Pick a pull request first", no agent cards, the CTA disabled and visibly so. Choose a `merged` PR → it is listed and warns without blocking. — R1, R2
5. **With a PR chosen** → every agent has a card, disabled ones marked, enabled ones preselected; Select all / Clear all flip the label; the CTA reads "Run multi-agent review (N)" at N ≥ 2 and "Run 1 agent" at 1. — R3, R4, R6
6. **The estimate beside the CTA** equals the max duration and the sum of cost over the chosen agents; deselect the only agent with cost data → the cost reads `—`, not `$0.00`, and the line says how many agents are unaccounted for. — R7, R8, R9
7. **Run four agents.** Within a second, `select status, count(*) from agent_runs where id in (…) group by status` shows three `running` and one `queued`; the fourth column header reads queued, not running. — R15
8. **Reload the page mid-run** → columns come back in their real states and keep updating; nothing shows as finished or empty. — R33
9. **When it settles**, the meta row shows the PR number and title, four agents, the honest fan-out line, total time = the slowest run and total cost = the sum. Columns show findings; a zero-finding agent says so in words. — R19, R22, R23
10. **Copy the URL, open it in a new tab tomorrow** → the same comparison. Switch to Tabs, pick an agent, toggle "Show only conflicts", open a trace, reload → all four survive. — R20, R25, R32, R35
11. **Open a trace from a column footer** → the same drawer the PR page opens, same tabs, same Copy raw output. Open one from the PR page → unchanged, and its default tab still follows `running`. — R34
12. **In "Where agents disagree"**, a position shows one cell per agent of the multi-run; an agent whose run reached `done` without flagging shows a grey marker, `did not flag` and nothing under it; the toggle changes only this section, never the columns or tabs. Run one agent alone → the "nothing to compare with" text and none of the other three. — R28, R30, R32, R47
12a. **Open the results page the moment the run starts** → the section is already there, carrying the not-final mark, every take reading `queued` or `reviewing` and none reading `did not flag`; as each agent finishes, its takes change without a reload. Watch the network tab: `GET /multi-agent-runs/:id` is requested once on open and once per finished run, never on a timer. — R50, R52, R53
12b. **Kill one agent's provider key so its run fails, and let another flag something.** With the toggle off the position is visible, the failed agent's cell reads `run failed` with a differently shaped marker and no note, and the column header for the same run also reads `run failed`. With the toggle on the position disappears and the section shows the numbers text — how many finished, how many are running, how many never got there — plus the re-run action. — R50, R51, R52
13. **Expand a finding in Tabs**, press Accept → the state changes and survives a reload. Learn and Turn into eval case are inert and the network tab shows no request when they are clicked. — R27
14. **Press Reply to author** on a PR whose head has moved → the line-shift warning appears before anything is sent; edit the prefilled body, confirm, and either the posted comment's link appears or the returned reason does, with the typed text still in the field. — R44, R45, R46
15. **Press Run again** → a new URL, a new multi-run, and the previous link still opens its own comparison. Delete one of the previous run's agents first → the re-run names it under skipped and runs the rest. — R48, R49
16. **From the PR page**, pick two agents and run → the address bar does not change **at all** beyond `?tab=findings`, a link to the multi-run appears beside the run status, and following it shows both columns. — R36, R37
16a. **Reload that PR page, then close the tab and open the same PR from the PR list.** The link is still there both times, and the URL carries no `multiRun` parameter — it came from `GET /pulls/:id/multi-agent`. On a PR that has never been compared the same request answers `200` with `null` and the page simply shows no link, with no error toast. — R54
17. **`DELETE /runs/:runId`** on one of a multi-run's runs → the results page loses that column and the positions no longer mention its findings. — R42
18. **`curl -s localhost:3001/multi-agent-runs/<id> | wc -c`** on the largest multi-run available stays well under 2 MB. — `SPEC-05 § Non-functional requirements`
19. **`cd client && pnpm build`** succeeds. It is not a Track A gate, and it is the only thing that catches a broken value import from the vendored ESM barrel or a bad route segment (`client/next.config.mjs`, the `MAX_DOC_CHARS` incident of 2026-08-14).
20. **All eight gate commands above exit 0**, and `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing. — R43

---

## Open questions

_None._

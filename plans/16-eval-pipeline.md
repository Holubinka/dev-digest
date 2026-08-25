# 16 — Eval Pipeline for the reviewer agents

**Status:** Planned 2026-08-22
**Scope:** server · client
**Modules touched:** `server/src/modules/eval` (new), `server/src/modules/_shared`, `server/src/modules/reviews` (delegation only), `server/src/platform/container.ts`, `server/src/vendor/shared`, `client/src/vendor/shared`, `client/src/app/evals` (new), `client/src/app/agents`, `client/src/app/repos/[repoId]/pulls/[number]`, `client/src/lib`, `scripts/`
**Requirements source:** `specs/SPEC-05-eval-pipeline.md` (approved 2026-08-22, 76 criteria)
**Execution:** multi-agent — P1 contract (blocking) → P2 server ∥ P3 client → P4 acceptance

`reviewer-core` is **consumed, never edited**. The spec calls that the design's self-check: if a
step needs the engine to change, the run went the wrong way. It does not need to — see
`## What already exists`.

## Requirements as understood

Every criterion of the spec is here. `Source` names the criterion, not the file.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | «Turn into eval case» on an **accepted** finding creates a case, `owner_kind='agent'`, `owner_id` = the agent whose run produced it, one `must_find` expectation carrying file / start_line / end_line / severity / category / title | § AC-1 | clear |
| R2 | The same button on a **dismissed** finding creates one `must_not_flag` expectation with the same coordinates | § AC-2 | clear |
| R3 | Neither `accepted_at` nor `dismissed_at` → button inert, reason named, no row written | § AC-3 | clear |
| R4 | `input_diff` = the PR diff fragment for **only** the file the finding cites, with all of that file's hunks; diff unobtainable → 409 and no case | § AC-4, AC-5 | clear |
| R5 | Finding range intersecting no hunk of the stored fragment → 422 naming the citation gate | § AC-6 | clear |
| R6 | Case name = slug of the finding title; collision inside the agent's set → smallest free numeric suffix | § AC-7, AC-8 | clear |
| R7 | `notes` carries provenance as plain text (finding id, repo, PR number, decision kind, decision date); the case and its runs outlive deletion of the finding, review or PR | § AC-9, AC-11 | clear |
| R8 | A second click on the same finding opens the existing case, creates no second one | § AC-10 | clear |
| R9 | `input_meta` = PR title + body truncated to the limit; `input_files` = the paths the stored fragment carries | § AC-12 | clear |
| R10 | The Evals tab lists every case owned by this agent; an empty set explains how to make the first instead of rendering nothing | § AC-13, AC-16 | clear |
| R11 | A case row shows last-run state in three values (passed / failed / never run) and expected-vs-received finding counts | § AC-14, AC-15 | clear |
| R12 | The set heading carries an `N / M passing` badge | § AC-17 | clear |
| R13 | The case editor shows name, the input in three tabs (diff, files, PR meta) and `expected_output` as editable JSON | § AC-18 | clear |
| R14 | `expected_output` failing the expectation contract blocks save and says what is wrong | § AC-19 | clear |
| R15 | With «Run on save» on, a successful save immediately runs that case and shows the result in the editor | § AC-20 | clear |
| R16 | A single-case run returns `EvalRunResult` with `result.traces_total = 1` and writes exactly one `eval_runs` row | § AC-21 | clear |
| R17 | Deleting a case deletes its run rows and changes no already-written batch aggregate | § AC-22 | clear |
| R18 | An `input_diff` that does not parse to at least one hunk carrying new-side lines is refused on save and on run | § AC-23 | clear |
| R19 | A set run executes the agent on every case and writes exactly one `eval_runs` row per case | § AC-24 | clear |
| R20 | The prompt is the current version's system prompt + linked skill bodies + `input_diff` + `input_meta` + a fixed task line, and nothing else — no repo-intel, project context, derived intent or memory | § AC-25 | clear |
| R21 | Two runs of an unchanged set with an unchanged agent send byte-identical prompts | § AC-26 | clear |
| R22 | Three refusals before any model call: empty set → 409; a batch already running for this agent → 409 naming its `batch_id`; no provider key → refusal with zero provider calls | § AC-27, AC-28, AC-29 | clear |
| R23 | Each row's `actual_output` carries the envelope: `batch_id`, `agent_id`, `agent_version`, provider, model, linked-skill list, post-gate findings, dropped count | § AC-30 | clear |
| R24 | On completion the aggregate is written into **every** row of the batch: case count, passed count, pooled recall / precision / citation_accuracy, total cost and duration | § AC-31 | clear |
| R25 | A case whose model call failed is written with `pass = false`, `null` metrics and the error text, the batch continues, the aggregate carries the error count, and errored cases enter no pooled denominator | § AC-32, AC-33 | clear |
| R26 | Every case errored → no aggregate is written, and that batch appears in neither the trend nor the comparison list | § AC-34 | clear |
| R27 | While a batch runs the launching screen says so and refuses to start the same set twice | § AC-35 | clear |
| R28 | At most one concurrent call to the model provider for the duration of a batch | § AC-36 | clear |
| R29 | «Run all agents» runs the set of every agent that has at least one case and names the ones it skipped | § AC-37 | clear |
| R30 | All three metrics are computed with zero model calls | § AC-38 | clear |
| R31 | A finding credits an expectation only on same file path + intersecting line ranges — severity, category and title do not affect crediting; at most one finding per expectation and one expectation per finding | § AC-39, AC-40 | clear |
| R32 | Batch recall = credited `must_find` expectations ÷ all `must_find` expectations of the batch's cases | § AC-41 | clear |
| R33 | Batch precision = findings that closed a `must_find` ÷ all batch findings that survived the citation gate | § AC-42 | clear |
| R34 | A finding intersecting a `must_not_flag` expectation is noise and credits nothing; so is a finding absent from the case's expectations, even elsewhere in the same fragment | § AC-43, AC-44 | clear |
| R35 | citation_accuracy = findings kept by the gate ÷ findings the model returned into it; a dropped finding credits nothing and is absent from precision's denominator | § AC-45, AC-46 | clear |
| R36 | A case with no `must_find` has per-case recall 1 and adds nothing to the pooled recall denominator; a case with no findings has per-case precision and citation_accuracy 1 and adds nothing to theirs | § AC-47, AC-48 | clear |
| R37 | A case passes only when every `must_find` is credited and no noise finding remains | § AC-49 | clear |
| R38 | Pooled metrics are the micro-average over merged counters, never the mean of per-case values | § AC-50 | clear |
| R39 | All three metrics stay within [0, 1] inclusive | § AC-51 | clear |
| R40 | An Eval Dashboard entry in the sidebar's SKILLS LAB group | § AC-52 | clear |
| R41 | The dashboard shows one card per agent that has cases: name, model badge, latest batch (version, date, passed-of-total), sparkline, three metrics | § AC-53 | clear |
| R42 | Below the cards, a summary table of all agents' latest batches, one row per batch | § AC-54 | clear |
| R43 | An agent's own page: three metric cards with the delta to the previous batch, a trend chart and a batch table with a cost column | § AC-55 | clear |
| R44 | Fewer than two completed batches → neither deltas nor a banner | § AC-56 | clear |
| R45 | With two or more completed batches, a banner generated from the deltas in code — no model call — naming the metric, the direction and the version | § AC-57 | clear |
| R46 | The date-range filter bounds the trend chart and the batch table alike | § AC-58 | clear |
| R47 | Compare is enabled at exactly two selected rows and disabled at every other count | § AC-59 | clear |
| R48 | The comparison shows four old→new values with deltas: recall, precision, citation_accuracy, cost | § AC-60 | clear |
| R49 | Different agent versions → the full system prompt with only the changed lines highlighted; the same version → a statement that the prompt did not change, with the metric deltas still shown | § AC-61, AC-62 | clear |
| R50 | Case sets differing in size or membership → a warning that the comparison is not like-for-like | § AC-63 | clear |
| R51 | «Promote» applies the chosen version's config snapshot through the ordinary agent-update path, creating a **new** version; the promoted version's own history row is untouched | § AC-64, AC-65 | clear |
| R52 | The Evals tab shows the same four figures — recall, precision, citation_accuracy, passed cases — with deltas and a link to the full dashboard | § AC-66 | clear |
| R53 | Every `eval_runs` read and write is scoped through the owner's workspace; an owner in another workspace answers 404 and creates nothing | § AC-67, AC-68 | clear |
| R54 | `input_diff` over the size limit or `expected_output` over the record/byte limit → 422 before any model call | § AC-69 | clear |
| R55 | A set larger than the per-batch ceiling is refused, with both numbers in the message | § AC-70 | clear |
| R56 | `input_diff` and `input_meta` reach the prompt only through the engine's fenced untrusted slots | § AC-71 | clear |
| R57 | Two batches of one set under different system prompts show two different metric triples and a non-empty prompt diff; a prompt instructed to report outside the set's expectations lowers the next batch's precision | § AC-72, AC-73 | assumed — **not code.** Both are outcomes of real paid runs. This plan delivers a hermetic proof of the mechanism (`## Tests`) plus a manual, real-model stage (`## Verification` V9–V10). Nothing here writes a fixture that "proves" them |
| R58 | At least one agent's set holds ≥ 8 cases, each created through the real «Turn into eval case» flow rather than inserted | § AC-74 | assumed — **out of band.** The dataset is being assembled by the human, through the product, in parallel with this work. No step depends on it existing and **no step seeds a case** (D11, and the repo's no-fabricated-demo-data stance). The plan's obligation is that the flow makes it reachable |
| R59 | `verify:l06` runs hermetic checks, prints for each step which criterion it proves, and exits non-zero on the first failure | § AC-75 | clear |
| R60 | With the DB flag, the verification command additionally runs the route tests on a Testcontainers Postgres | § AC-76 | clear |

## Out of scope

No acceptance criterion is dropped — all 76 are `R#` above. What this plan deliberately does not
build, from the spec's own Non-goals:

- **N1** — cases owned by a skill (`owner_kind = 'skill'`). The contract permits them; the routes,
  the batch runner and the UI here handle `'agent'` only, and refuse the other with a clear error.
- **N3** — export-your-own-agent. Not a requirement, not a TODO, not a stub.
- **N4** — export-to-CI, `ci_runs`, running evals in GitHub Actions.
- **N5** — the root `evals/` package. A different harness for `.claude/skills` and `.claude/agents`.
  Unrelated plane, untouched; do not add a case, a grader or a baseline there.
- **N6** — new tables and new columns. `eval_cases` / `eval_runs` as migration `0000` left them.
  Every new field rides an existing `jsonb` column. **No migration is generated in this plan.**
- **N7** — bulk auto-generation of cases from existing findings.
- **N8** — cron, scheduling, or auto-running evals after an agent changes.
- **N9** — the mockup's Memory, Multi-Agent Review, Agent Performance and CI Runs sidebar entries.
- **N10** — the Stats and CI tabs the mockup draws beside Evals in the agent editor.

Also out of scope, and deliberately so:

- **Assembling the ≥8-case dataset (R58).** Human work through the running product, in parallel.
- **A `/promote` route.** R51 needs none — see `## What already exists`.

## What already exists

Read these before writing anything; most of this feature is wiring things that are already here.

- **The tables.** `server/src/db/schema/eval.ts:7-35` — `evalCases` (workspace-scoped, `ownerKind`,
  `ownerId`, `inputDiff` text, `inputFiles`/`inputMeta`/`expectedOutput` jsonb, `notes`) and
  `evalRuns` (`caseId` with `onDelete: 'cascade'`, `actualOutput` jsonb, `pass`, `recall`,
  `precision`, `citationAccuracy`, `durationMs`, `costUsd`). Migrated, empty, unchanged by this plan.
- **The contracts.** `server/src/vendor/shared/contracts/eval-ci.ts:20-89` — `EvalCaseInput`,
  `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard`. `knowledge.ts:530-565` —
  `EvalRun`, `EvalPerTrace`, `EvalOwnerKind`, `EvalCase`. All used as they stand.
- **The engine already accepts exactly what R20 demands.** `reviewer-core/src/review/run.ts:45-101`
  — `ReviewInput` takes `systemPrompt`, `model`, `diff`, `llm`, `strategy`, `skills` (resolved
  bodies), `prDescription`, `task`, and treats `repoMap` / `specs` / `intent` / `memory` /
  `callers` as optional. Omitting them **is** AC-25. `run-executor.ts:397-433` shows the conditional
  spreads that keep an absent feature byte-identical to the shape before it existed — copy that.
- **The citation gate returns both halves R35 needs.** `reviewPullRequest` hands back
  `review.findings` (kept) and `dropped[]` (`run.ts:225-238`, `grounding.ts:59-91`).
- **Fragment extraction is already in the engine.** `sliceDiff(diff, path)` —
  `reviewer-core/src/review/reduce.ts:58-72`, exported from `reviewer-core/src/index.ts`. Its
  fallback returns the **whole** `diff.raw` when the path is absent; R4 needs exactly one file, so
  the caller must reject an absent path rather than accept that fallback.
- **PR diff loading.** `server/src/modules/reviews/diff-loader.ts:12-44` — `container.git.diff`
  first, persisted `pr_files` patches second. This is the code the spec flags as living in the wrong
  slice; P2 step 1 moves it.
- **The hunk guard R18 needs, already written and already load-bearing.**
  `server/src/modules/reviews/diff-review.ts:113-158` `assertReviewable` — four checks, one of them
  the over-claiming-hunk check whose comment records a measured 1345 ms / 478 MB event-loop block
  from a 49-byte body. Do not re-implement it; move it.
- **Skill-body assembly.** `server/src/modules/reviews/helpers.ts:144-162` — `attachedSkills`,
  `skillBodiesFor`, `skillBlock`, with the two filters (globally disabled, injection-detected) and
  the `LinkedSkillLike` structural type.
- **Cross-slice data access already hangs off the composition root.**
  `server/src/platform/container.ts:189-213` — `agentsRepo`, `reviewRepo`, `pullsRepo`,
  `settingsRepo`. `reviewRepo.findingContext(findingId)` returns `{ finding, review, pull }`
  (`reviews/repository.ts:120-124`), `getRepo(repoId)` and `getPrFiles(prId)` are on the same object.
  `review.agentId` is R1's `owner_id`.
- **Agent versions and the promote path.** `agents/repository.ts:135-211` — any config change bumps
  `version` and snapshots into `agent_versions`; `getVersion(agentId, version)` reads one back.
  `GET /agents/:id/versions/:version` and `PUT /agents/:id` already exist (`agents/routes.ts:109`,
  `:134`). **R51 is those two calls in sequence — no new route.**
- **The single-flight-on-the-container precedent R27/R28 depend on.**
  `container.ts:259-296` (`briefService`, `onboardingService`): a service holding an in-process lock
  map must be memoised on the container, or the second instance has an empty map and the lock is
  not a lock.
- **Per-route rate limiting keyed by workspace.** `onboarding/routes.ts:55-75` and
  `brief/routes.ts:45-60` — the global limiter is not registered under `NODE_ENV=test`, which is why
  the bound is declared per route.
- **Client charts already exist.** `client/src/vendor/ui/charts/` — `Sparkline.tsx` (R41),
  `LineChart.tsx` (R43), `MetricCard.tsx`, `Donut.tsx`. Do not write new ones.
- **Client copy already exists.** `client/messages/en/eval.json` carries `dashboard.*`,
  `caseEditor.*`, `evalsTab.*` and `page.*` — including `evalsTab.emptyCases` (R10),
  `dashboard.running` (R27), `caseEditor.validJson` / `invalidJson` (R14), `evalsTab.neverRun` (R11).
  Read it before inventing a key; add only what is genuinely missing.
- **The module registry names this module already.** `server/src/modules/index.ts:28-30` — "Each
  course lesson adds its own module here (… eval/ci/hooks …)".
- **Nothing exists** for: the eval module itself, any eval hook or screen on the client, any Zod
  schema for an expectation or for the `actual_output` envelope, and `scripts/verify-l06.sh`.

## Constraints

| # | Constraint | Mandated by |
|---|---|---|
| C1 | `modules/eval/**` may not import from `modules/reviews/**` or any other slice — type-only imports included, and a re-export barrel does not help. Share through `_shared/`, a port, or a repository on the container | `server/.dependency-cruiser.cjs` rule `no-cross-module` (its own comment) |
| C2 | `service.ts` and `*-executor.ts` may not import `src/adapters/**` (except `adapters/mocks.ts`) nor `node:fs`. `parseUnifiedDiff` lives in `adapters/git/diff-parser.ts`, so **the batch executor may not call it** — it must arrive already parsed, or through a non-executor file | `.dependency-cruiser.cjs` rules `no-service-to-adapter-impl`, `no-fs-in-service` |
| C3 | Drizzle appears only in `modules/<m>/repository(.ts\|/)`. A repository takes `Db`, never `Container` | `.dependency-cruiser.cjs` `no-sql-outside-repository`; `onion-architecture` §3.2 |
| C4 | A new service takes `constructor(container: Container, repo = new EvalRepository(container.db))` — the repository is a parameter, which is the seam its unit tests need | `onion-architecture` §3.3 |
| C5 | A route validates with a declared `schema`, resolves tenancy via `getContext`, delegates, and maps `undefined` → `NotFoundError`. No hand-rolled `Schema.parse(req.body)`, no `container.db` | `onion-architecture` §3.1; `server/README.md`; `modules/agents/routes.ts:70-82` |
| C6 | `reviewer-core` gains no runtime dependency and no edit at all. Two deps, `openai` and `zod` | `.dependency-cruiser.cjs` `core-stays-pure`; `onion-architecture` §3.8; the spec's own self-check |
| C7 | `vendor/shared/**` may import only `zod` and itself. New schemas are **added** to `eval-ci.ts`; no existing schema changes shape | `.dependency-cruiser.cjs` `contracts-stay-pure`; spec D1 |
| C8 | `@devdigest/shared` is vendored twice. The server copy is the source of truth; the client copy must be byte-identical. Type-checking cannot see the drift | root `AGENTS.md` § Non-default conventions; `pr-self-review/gates.md` § repo · vendor |
| C9 | Secrets reach code only through `SecretsProvider`, i.e. `await container.llm(provider)`. Never `AppConfig`, never `process.env` | `onion-architecture` §3.7; `server/AGENTS.md` |
| C10 | `expected_output` is parsed by a Zod contract **at the route boundary**, once. The service receives an already-parsed value and does not re-validate | `onion-architecture` §3.6 (`parse-validate-early`, `parse-avoid-double-validation` in the `zod` skill) |
| C11 | The expectation object schema is `.strict()`. Zod strips unknown keys by default, and the spec's edge-case table requires an object *with unknown fields* to be **rejected**, not silently trimmed | spec § Edge cases, row `expected_output` — не масив або з невідомими полями; `zod` skill `object-strict-vs-strip` |
| C12 | Untrusted text (`input_diff`, `input_meta.body`) reaches the model only through the engine's existing fenced slots — `diff` and `prDescription` — never concatenated into `systemPrompt` or `task` | R56/AC-71; `reviewer-core/src/prompt.ts` (INJECTION_GUARD) |
| C13 | `eval_runs` has **no `workspace_id`**. Every read and write scopes through the join to `eval_cases.workspace_id`. `owner_id` is checked against the workspace *before* any insert | `server/INSIGHTS.md:955-966`, which names this table by name: "When the next lesson fills `conventions`, `memory`, `eval` or `ci`, audit the same shape before wiring it up: parent scoped, child assumed" |
| C14 | Modules are registered by hand in `modules/index.ts`. **`eval` is not a legal binding name in an ES module** (strict mode forbids `eval` and `arguments` as identifiers), so `import eval from './eval/routes.js'` is a SyntaxError. Import it as `evalModule` and write the registry entry as `eval: evalModule` — the object *property* is fine | `server/AGENTS.md` § Conventions; ECMAScript strict mode |
| C15 | `client/src/vendor/ui/nav.ts` is a vendored file the root `AGENTS.md` lists under "Do not touch". Editing it to add a sidebar entry is nonetheless the established path — `git log` shows Skills, Conventions, Project Context and the Onboarding Tour each doing it. Two edits travel with it and are easy to forget: a `nav.<key>` entry in `messages/en/shell.json` (the label is `t(\`nav.${it.key}\`)`, so a missing key renders untranslated) and a `SHORTCUTS` row if the item takes a `gKey`, since that array is hand-maintained and drives the `?` help modal | `client/src/vendor/ui/nav.ts:26-34, 64-70`; confirmed against the human 2026-08-22 |
| C16 | No `fetch` in a component. Data goes through TanStack Query hooks in `src/lib/hooks/*`. The new hook file is **not** added to `lib/hooks/index.ts` — that barrel is `export *` over five modules and reaching one hook through it drags in the other four | `client/AGENTS.md`; `client/src/lib/hooks/onboarding.ts:9-13`; `client/INSIGHTS.md:805-819` |
| C17 | `client/src/lib/api.ts` does not validate responses. The server's contract is the only guarantee the client gets, which is why P1 pins it before P2 and P3 start | `client/AGENTS.md` § Conventions |
| C18 | The date-range filter is URL state; the two selected batch ids are screen state | spec § Module interactions; `frontend-architecture` principle 5 |
| C19 | A mockup is an acceptance criterion. Every client screen is compared element by element against its PNG under `specs/assets/` before it is called done, answering *matches / differs / absent*; a difference is reported, never silently resolved | `client/AGENTS.md` § A design is an acceptance criterion |
| C20 | `*.it.test.ts` means DB-backed (Testcontainers). Anything importing `test/helpers/pg.ts` carries that suffix; everything else is hermetic | `server/AGENTS.md` § Tests; `TESTING.md` |
| C21 | Ceilings, from the spec's NFRs, all enforced before a model call: 25 cases per batch, 200 cases per agent set, 3 batch starts per minute per workspace, 50 000 chars of `input_diff`, 50 records / 64 KB of `expected_output`, 4 000 chars of `input_meta.body`, 100 findings stored per case (excess truncated with a flag), 60 s per case | spec § Non-functional requirements; R54, R55 |

## Recommendations

For the human, not the implementer. The work packages below are written to the requirements as
they stand, not to these.

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Give `verify-l06.sh` a third, opt-in mode (`--dataset`) that counts cases per agent in the **development** database and fails under 8, so R58/AC-74 stops being purely manual | Yes — one more step in P4 and a read path to the dev DB, which no other verify script has | ~30 lines of script, plus a decision that a verification script may read a live database. Rejected by default: AC-75 says hermetic, and `verify-l03.sh` reads nothing |
| 2 | Record the assembled prompt's SHA-256 in the envelope alongside `agent_version` and the skill list | Yes — one field in P1's envelope, one line in P2's executor | Near zero, and it turns R21/AC-26 from a test-only property into a permanently observable one: two batches with equal hashes are provably the same input. Not folded in because it is a contract addition the spec did not ask for |
| 3 | Extract the `must_not_flag` polarity into its own column later, if skills-owned cases (N1) arrive | No | — Noted only so the jsonb choice is a decision on record, not an oversight |

## Skills the implementer must invoke

| Package · step | Skill | Why |
|---|---|---|
| P1 · all | `zod` | The whole package is schema authoring. Specifically `object-strict-vs-strip` (C11), `type-input-vs-output` (`.default()` fields need a `z.input` alias for callers — the file already does this for `ComposeReviewInputBody`), `schema-use-unknown-not-any` |
| P2 · 1, 2 | `onion-architecture` | The `_shared` extraction and which ring each new file sits in. §1 the ring table, §2 the four-step procedure, §3.2/§3.3 repository and service shape, and the escalation order when `pnpm arch` fails |
| P2 · 3 | `drizzle-orm-patterns` | The new repository: the join through `eval_cases` for every `eval_runs` read (C13), the batch-scoped update in step 6, and grouping for the dashboard reads |
| P2 · 4, 5, 6 | `onion-architecture` | Service vs executor placement, the container-memoised single-flight lock, and C2's constraint on what an `*-executor.ts` may import |
| P2 · 7 | `fastify-best-practices` | Route declaration (`rules/routes.md`), `schema` blocks (`rules/schemas.md`), per-route `config.rateLimit` and the workspace `keyGenerator`, and `rules/error-handling.md` for mapping the pre-flight refusals to codes |
| P2 · 7 | `security` | This module's whole input surface is untrusted: a hand-edited diff from a stranger's repository entering a model prompt, a client-supplied `owner_id`, and the only spend ceiling in the system |
| P3 · 1, 2 | `frontend-architecture` | Where each new component, hook, type and constant goes. The five-step procedure, principle 2 (promotion needs a second consumer) and principle 6 (reuse before you create — the charts and the message keys already exist) |
| P3 · 3–7 | `react-best-practices` | Component and hook correctness across six new screens: derived state, keys, the disabled-button pattern for R3, a11y on the compare selection |
| P3 · 4, 6 | `next-best-practices` | The new `app/evals` route segment: file conventions, where `'use client'` goes, and metadata |
| P4 | — | Bash and two package scripts. No skill governs it; `verify-l03.sh` is the whole specification |

`postgresql-table-design` is deliberately **not** listed: N6 forbids new tables and columns, and
reading the schema confirmed no genuine schema question remains. If one appears, that is a finding
to report, not a step to improvise.

## Work packages

### P1 — the contract, in both vendored copies

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/eval-ci.ts`
- `client/src/vendor/shared/contracts/eval-ci.ts`

No other package writes either file. Nothing else in `vendor/shared` changes.

**Contract:** what P2 and P3 may assume once this lands. Additive only — every existing schema in
`eval-ci.ts` and `knowledge.ts` keeps its current shape (C7, D1). Names below are normative;
P2 and P3 both import them.

```
EvalExpectationPolarity  = z.enum(['must_find','must_not_flag'])
EvalExpectation          = strict object { file, start_line, end_line,
                             polarity: EvalExpectationPolarity.default('must_find'),
                             severity: Severity.nullish(), category: FindingCategory.nullish(),
                             title: z.string().nullish() }
EvalExpectations         = z.array(EvalExpectation).max(50)

EvalBatchAggregate       = { batch_id, completed_at, cases, passed, errored,
                             recall, precision, citation_accuracy,
                             cost_usd: number|null, duration_ms, case_ids: string[] }
EvalRunEnvelope          = { batch_id, agent_id, agent_version, provider, model,
                             skills: {id,name}[], findings: Finding[], findings_truncated,
                             returned, dropped, error: string|null,
                             aggregate: EvalBatchAggregate|null }

EvalCaseRow              = { id, name, owner_kind, owner_id, notes, expected_count,
                             last_run: { ran_at, pass, recall, precision,
                                         citation_accuracy, findings_count } | null }
EvalCaseSet              = { cases: EvalCaseRow[], passing, total }
EvalBatchSummary         = { batch_id, agent_id, agent_name, agent_version, ran_at,
                             cases, passed, errored, recall, precision,
                             citation_accuracy, cost_usd, duration_ms }
EvalBatchResult          = { batch_id, agent_id, agent_version, result: EvalRun,
                             errored, aggregate: EvalBatchAggregate|null }
EvalCaseFromFinding      = { case: EvalCase, created: boolean }
EvalDashboardCard        = { agent_id, agent_name, provider, model, cases_total,
                             latest: EvalBatchSummary|null, trend: EvalTrendPoint[] }
EvalDashboardAll         = { cards: EvalDashboardCard[], recent: EvalBatchSummary[] }
EvalAgentDashboard       = { dashboard: EvalDashboard, batches: EvalBatchSummary[] }
EvalCompare              = { a: EvalBatchSummary, b: EvalBatchSummary,
                             delta: { recall, precision, citation_accuracy, cost_usd },
                             prompt: { changed, a_version, b_version, a_text, b_text,
                                       changed_lines: number[] },
                             like_for_like, case_diff: { only_in_a, only_in_b } }
EvalRunAllResult         = { batches: EvalBatchResult[], skipped: { agent_id, agent_name, reason }[] }
```

**Steps:**

1. **(R23, R24, R31)** Add the schemas above to
   `server/src/vendor/shared/contracts/eval-ci.ts`, in the file's existing Eval section, below the
   schemas already there. Reuse `Severity` and `FindingCategory` from `./findings.js` (already
   imported there for `Finding`), `EvalRun` / `EvalOwnerKind` / `EvalCase` from `./knowledge.js`
   (also already imported), and `EvalTrendPoint` / `EvalRunRecord` / `EvalDashboard` from this file.
   Export a type alongside each schema, as every neighbour does. For any schema carrying a
   `.default()`, also export the `z.input<>` alias — the pattern is `ComposeReviewInputBody` at
   line 106.
   *Check:* `cd server && pnpm typecheck` passes, and `git diff` shows only additions in that file.
2. **(C11)** `EvalExpectation` is `.strict()`. Add a one-line comment saying why: Zod strips unknown
   keys by default, and the spec requires an expectation object with unknown fields to be **refused**
   so the editor can say what is wrong (R14), not silently trimmed.
   *Check:* a scratch `EvalExpectation.safeParse({file:'a',start_line:1,end_line:1,bogus:1})` returns
   `success: false`. Delete the scratch.
3. **(C8)** Mirror the file into `client/src/vendor/shared/contracts/eval-ci.ts`. Copy, do not
   retype — the two must be byte-identical.
   *Check:* `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing, and
   `cd client && pnpm typecheck` passes.

---

### P2 — the server: `eval` module, scoring, batch runner

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `server/src/modules/eval/**` (new folder)
- `server/src/modules/_shared/pr-diff.ts`, `server/src/modules/_shared/diff-guards.ts`,
  `server/src/modules/_shared/skill-prompt.ts` (new)
- `server/src/modules/reviews/diff-loader.ts`, `diff-review.ts`, `helpers.ts` — **delegation edits
  only**, no behaviour change
- `server/src/modules/index.ts`, `server/src/platform/container.ts`
- `server/test/eval-*.test.ts`, `server/test/eval-*.it.test.ts`

Writes nothing under `client/`, nothing under `vendor/`, no migration.

**Contract:** the routes P3 codes against. Every one resolves tenancy with `getContext` first and
answers 404 for an owner outside the workspace (C13, R53). Response bodies are the P1 schemas.

```
POST   /findings/:id/eval-case        → EvalCaseFromFinding   (created=false when it already existed)
GET    /agents/:id/eval-cases         → EvalCaseSet
POST   /agents/:id/eval-cases         → EvalCase              (hand-made case, editor "New case")
GET    /eval-cases/:id                → EvalCase
PUT    /eval-cases/:id                → EvalCase
DELETE /eval-cases/:id                → 204
POST   /eval-cases/:id/run            → EvalRunResult         (traces_total = 1)
POST   /agents/:id/eval-runs          → EvalBatchResult       (rate-limited: 3/min per workspace)
POST   /eval-runs                     → EvalRunAllResult      (same limit)
GET    /eval-dashboard                → EvalDashboardAll
GET    /agents/:id/eval-dashboard?from=&to=  → EvalAgentDashboard
GET    /eval-batches/compare?a=&b=    → EvalCompare
```

Error codes P3 must be able to branch on, all as `AppError` (`platform/errors.ts`):
`no_cases` 409 · `batch_in_progress` 409 (body names the running `batch_id`) ·
`provider_not_configured` 409 · `diff_unavailable` 409 · `expectation_unanchored` 422 ·
`invalid_diff` 422 · `limit_exceeded` 422 · `set_too_large` 422 · `not_found` 404.

**Promote (R51) needs no route here.** The client reads
`GET /agents/:id/versions/:version` and writes `PUT /agents/:id`. Do not build one.

**Steps:**

1. **(C1, R4)** Move PR-diff loading out of the `reviews` slice into
   `server/src/modules/_shared/pr-diff.ts`, exporting `loadPrDiff`. Body is today's
   `reviews/diff-loader.ts:12-44`, unchanged in behaviour: `container.git.diff(...)` first, the
   `pr_files` reconstruction second. Reach the composition root **structurally**, not by importing
   `platform/container.js` — declare the shape it needs (`{ git: { diff(...) }, reviewRepo: {
   getPrFiles(prId) } }`), exactly as `_shared/feature-models.ts:33-35` declares `SettingsReader`,
   and for the same reason: the container constructs services that reach this file, so naming
   `Container` here closes a cycle `no-circular` rejects. Leave `reviews/diff-loader.ts` exporting
   `loadDiff` with its current signature, delegating — `run-executor.ts` must not change.
   *Check:* `cd server && pnpm arch` exits 0 and `pnpm arch:strict` reports no more entries than
   before; the existing review suites still pass.
2. **(C1, C2, R18)** Move `assertReviewable` from `reviews/diff-review.ts:113-158` to
   `server/src/modules/_shared/diff-guards.ts` **verbatim**, messages and comments included, and
   have `diff-review.ts` import it. Then move `attachedSkills`, `skillBodiesFor`, `skillBlock` and
   `LinkedSkillLike` from `reviews/helpers.ts:118-162` to
   `server/src/modules/_shared/skill-prompt.ts`, and re-export them from `reviews/helpers.ts` —
   that file already re-exports `reduceReviews` and `sliceDiff` this way at line 14, so the pattern
   is its own.
   **Why verbatim matters:** the four checks in `assertReviewable` include the over-claiming-hunk
   guard, and its comment records the measurement — a 49-byte crafted body blocking the event loop
   for 1345 ms while allocating 478 MB. A hand-edited `input_diff` is the same attacker-controlled
   text on a new route. A re-implementation that keeps three of the four checks passes every test
   in this plan and reopens that hole.
   *Check:* `pnpm arch` exits 0; the `diff-review` route tests pass with byte-identical error
   messages.
3. **(C3, C13, R53)** `server/src/modules/eval/repository.ts` — `constructor(private db: Db) {}`,
   Drizzle only. Methods, every one workspace-scoped: `listCases(workspaceId, ownerId)`,
   `getCase(workspaceId, caseId)`, `insertCase`, `updateCase`, `deleteCase`,
   `caseByFindingId(workspaceId, findingId)` (matches on the provenance marker written into
   `notes`, R7/R8 — D11 forbids a foreign key), `insertRun`, `updateRunEnvelopes(batchId, patch)`,
   `runsForCases`, `latestRunPerCase(workspaceId, ownerId)`, `batchesForOwner(workspaceId, ownerId,
   range, limit)`, `batchById(workspaceId, batchId)`, `runningBatch(workspaceId, ownerId)`.
   Every `eval_runs` query joins `eval_cases` and filters on `eval_cases.workspace_id` — this table
   has no `workspace_id` of its own, and `server/INSIGHTS.md:955-966` names it as the next place
   the "parent scoped, child assumed" bug will appear.
   *Check:* `pnpm arch` exits 0 (no Drizzle escaped the file); the integration test in step 9 proves
   a foreign-workspace id returns nothing.
4. **(C2, R4, R5, R9, R18)** `server/src/modules/eval/diff-fragment.ts` — a plain module, **not**
   `service.ts` and not `*-executor.ts`, which is what lets it import `parseUnifiedDiff` from
   `adapters/git/diff-parser.js` the way `reviews/diff-loader.ts` already does (C2).
   - `fragmentFor(diff, path)` — `sliceDiff` from `@devdigest/reviewer-core`, but **first** assert
     the path is among `diff.files`; `sliceDiff` returns the whole `diff.raw` when it is not
     (`reduce.ts:70`), which would store the entire PR diff and silently break R4 and D7.
   - `filesIn(fragmentText)` — parse, return the paths (R9's `input_files`, D13: derived, not edited).
   - `assertRunnableFragment(text)` — parse, then call the moved `assertReviewableDiff` from step 2.
   - `intersectsAHunk(diff, file, start, end)` — R5's pre-check, using the same rule the gate uses
     (`grounding.ts:48-53` walks the covered lines, never the declared range: an unbounded
     `end_line` iterated directly is a 13-second block).
   *Check:* `server/test/eval-fragment.test.ts` (step 8) covers a two-file diff yielding a one-path
   fragment, an absent path refusing rather than returning everything, a `--stat` summary refused,
   and the over-claiming hunk refused.
5. **(R30–R39)** `server/src/modules/eval/scoring.ts` — pure, importing only contracts. No
   container, no port, no clock. That purity is the proof of R30/AC-38 and is why its test needs no
   provider at all.
   - `creditFindings(expectations, findings)` → deterministic greedy one-to-one matching: walk
     expectations in array order, take the first not-yet-claimed finding on the same path whose
     range intersects (R31). Same file + intersecting lines only — severity, category and title are
     stored and displayed but never consulted (D5).
   - `scoreCase({ expectations, kept, returned })` → `{ pass, recall, precision,
     citation_accuracy, counters }`. `counters` carries the raw numerators and denominators —
     `mustFindTotal`, `mustFindCredited`, `keptTotal`, `keptCredited`, `returnedTotal` — because
     step 6 pools those, not the ratios (R38/D14).
     Rules to encode: a finding intersecting a `must_not_flag` is noise and credits nothing (R34); a
     finding matching no expectation is noise even elsewhere in the same fragment (R34/D7); a
     gate-dropped finding credits nothing and is outside precision's denominator (R35); zero
     `must_find` → per-case recall 1 with a zero recall denominator (R36); zero findings → per-case
     precision and citation_accuracy 1 with zero denominators (R36); pass only when every
     `must_find` is credited **and** no noise remains (R37).
   - `poolBatch(counters[])` → micro-average over summed numerators and denominators, skipping
     errored cases entirely (R25, R38). A zero denominator yields 1, matching the per-case rule.
   - Clamp all three outputs to [0, 1] (R39) — the contract's `EvalRun` declares `.min(0).max(1)`
     and would throw at the boundary otherwise.
   *Check:* `server/test/eval-scoring.test.ts` (step 8), which constructs no container.
6. **(C2, C4, R19–R29, C21)** `server/src/modules/eval/batch-executor.ts` — the Application ring.
   Because of its filename it may import **no** `adapters/**` and no `node:fs` (C2), so the parsed
   diff and every guard arrive from step 4's module or as parameters.
   Sequence per batch: generate `batch_id` → resolve the agent through `container.agentsRepo`
   (workspace-scoped) → read `agent.version` and the linked skills, filtered through
   `_shared/skill-prompt.ts` (step 2) → check the three pre-flight refusals in order (empty set,
   batch already running for this agent, provider key) → resolve `await
   container.llm(agent.provider)` **once**, before the loop, translating `ConfigError` into
   `provider_not_configured` 409 so R22/AC-29 fails with zero provider calls → loop the cases
   **sequentially** (R28: one concurrent provider call, which sequential execution gives for free
   and which the test asserts) with a 60 s cap per case → per case call `reviewPullRequest` with
   `systemPrompt`, `model`, the parsed `input_diff`, `llm`, `strategy`, `skills` (bodies only when
   non-empty — the conditional-spread pattern at `run-executor.ts:411-433`), `prDescription` from
   `input_meta.body`, and the fixed eval task line; pass **nothing** else, which is R20/AC-25 →
   score with step 5 → write the row immediately (D9: a dropped connection must not lose paid work).
   After the loop: if every case errored, write no aggregate (R26) — the batch then has no
   `aggregate` in any envelope, which is exactly how the reads in step 7 exclude it from the trend
   and from the comparison list. Otherwise pool and write the aggregate into every row of the batch
   in one update (R24).
   The eval task line is a module constant, written once and never rebuilt per run — R21/AC-26 is
   byte-identical prompts, and a task line that interpolates anything variable breaks it.
   Model errors: catch per case, write `pass = false`, `null` metrics and the error text into the
   envelope, continue (R25).
   *Check:* `server/test/eval-batch.test.ts` (step 8).
7. **(C4, C5, R53–R56)** `server/src/modules/eval/service.ts` and `routes.ts`.
   Service: `constructor(container: Container, repo = new EvalRepository(container.db))` (C4). Owns
   case creation from a finding (R1–R9, reading `container.reviewRepo.findingContext`, `getRepo` and
   `loadPrDiff` from step 1), the case CRUD, the dashboard and compare reads, and the in-process
   single-flight map keyed by `agentId` that R22/AC-28 and R27/AC-35 rest on.
   **The service must be memoised on the container** (`container.ts:259-296`, `briefService` and
   `onboardingService`, whose comments spell out why): a second instance means a second empty map
   and the lock stops being a lock. Add an `evalService` getter and an override field, both
   following those two verbatim, and build the repository in the container, not in the constructor.
   Routes: one `schema` block per route (C5), `getContext` first, `AppError` for every refusal, and
   `config.rateLimit` on the two batch routes copying the workspace `keyGenerator` from
   `onboarding/routes.ts:55-75` — the global limiter is absent under `NODE_ENV=test`, so a global
   bound would be untested and unenforced there. `expected_output` is parsed by
   `EvalExpectations` in the route's `schema`, once (C10, C11); the size and count ceilings of C21
   are checked here, before anything reaches the executor (R54, R55).
   Agent-detail dashboard: at most four DB queries (spec NFR), at most 20 completed batches in the
   trend and 50 rows in the summary table.
   Compare: computes the changed line numbers of the two system prompts **in code** (R49/AC-61), and
   sets `like_for_like` false when the two batches' `case_ids` differ in size or membership
   (R50/AC-63); `aggregate.case_ids` from P1 is what makes that answerable.
   Banner text (R45/AC-57) is generated from the deltas in code — no model call.
   *Check:* `server/test/eval-routes.it.test.ts` (step 9).
8. **(C14)** Register the module: `import evalModule from './eval/routes.js'` and the entry
   `eval: evalModule` in `server/src/modules/index.ts`. **`import eval from …` is a SyntaxError** —
   strict mode, which every ES module is, forbids `eval` as a binding name. The object property is
   legal; the import binding is not.
   *Check:* `cd server && pnpm exec vitest run test/routes-smoke` (or the existing route-smoke suite)
   boots the app with the new module registered.
9. **Hermetic tests.** `server/test/eval-scoring.test.ts` (R30–R39, constructing no container —
   that is the AC-38 proof), `server/test/eval-fragment.test.ts` (R4, R5, R9, R18),
   `server/test/eval-batch.test.ts` (R19–R29 with `MockLLMProvider` from
   `src/adapters/mocks.ts:67`). The batch suite must assert: exactly one row per case; the envelope's
   fields; the aggregate written to every row; a mid-batch failure leaving the others written; an
   all-failed batch writing no aggregate; a concurrency counter that never exceeds 1; the prompt
   section list containing no repo-map / specs / intent / memory section; and two runs producing
   identical `messages` from the mock's recorded `calls`.
   *Check:* `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` green.
10. **Integration test.** `server/test/eval-routes.it.test.ts` (C20) — create from an accepted
    finding, from a dismissed one, the repeat click returning the same case, deletion of the source
    PR leaving the case readable, single-case run writing one row, case deletion cascading its runs
    while a previously written aggregate is unchanged, and the four refusals (empty set, concurrent
    batch, missing key, foreign workspace) each leaving the provider call count at zero.
    *Check:* `cd server && pnpm exec vitest run .it.test` green with Docker running.

---

### P3 — the client: button, tab, dashboard, compare

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `client/src/lib/hooks/eval.ts` (new), `client/src/lib/types.ts`
- `client/src/vendor/ui/nav.ts`, `client/messages/en/*.json`
- `client/src/app/evals/**` (new route segment)
- `client/src/app/agents/[id]/page.tsx` and `_components/AgentEditor/**`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**` and the parent that
  passes its props

Writes nothing under `server/`, nothing under `client/src/vendor/shared/`.

**Contract:** the routes and error codes are P2's, repeated here because this agent starts cold —

```
POST   /findings/:id/eval-case        → EvalCaseFromFinding   (created=false ⇒ open the existing one)
GET    /agents/:id/eval-cases         → EvalCaseSet
POST   /agents/:id/eval-cases         → EvalCase
GET    /eval-cases/:id                → EvalCase
PUT    /eval-cases/:id                → EvalCase
DELETE /eval-cases/:id                → 204
POST   /eval-cases/:id/run            → EvalRunResult         (result.traces_total = 1)
POST   /agents/:id/eval-runs          → EvalBatchResult
POST   /eval-runs                     → EvalRunAllResult      ({ batches, skipped })
GET    /eval-dashboard                → EvalDashboardAll      ({ cards, recent })
GET    /agents/:id/eval-dashboard?from=&to=  → EvalAgentDashboard  ({ dashboard, batches })
GET    /eval-batches/compare?a=&b=    → EvalCompare
```

Error codes to branch on: `no_cases` 409 · `batch_in_progress` 409 (body carries the running
`batch_id`) · `provider_not_configured` 409 · `diff_unavailable` 409 · `expectation_unanchored` 422
· `invalid_diff` 422 · `limit_exceeded` 422 · `set_too_large` 422 · `not_found` 404. `ApiError`
(`src/lib/api.ts:8`) exposes `.status` and `.code`.

Promote (R51) uses two **existing** agent routes: `GET /agents/:id/versions/:version` for the
snapshot, then `PUT /agents/:id` with its config. That creates a new version and leaves the
promoted version's own row untouched — which is the whole of AC-64 and AC-65. Do not ask P2 for a
promote endpoint.

**Steps:**

1. **(C16, C17)** `client/src/lib/hooks/eval.ts` — one TanStack Query hook per route above, with a
   shared query-key factory so a mutation writes where a query reads. Model it on
   `src/lib/hooks/onboarding.ts`, including its header comment: **do not** add this file to
   `lib/hooks/index.ts`. Re-export the P1 types from `src/lib/types.ts` (re-export, never redefine).
   A paid mutation gets no retry and no optimistic update.
   *Check:* `cd client && pnpm typecheck` and `pnpm lint` pass.
2. **(C15, R40)** Add the Eval Dashboard item to the SKILLS LAB group in
   `client/src/vendor/ui/nav.ts`, plus its `nav.<key>` label in `messages/en/shell.json` and, if it
   takes a `gKey`, its row in `SHORTCUTS`. `p`, `o`, `d`, `s`, `a`, `c` and `,` are taken. Check
   `activeKeyFor()` in the same file returns the new key for an `/evals` path.
   *Check:* `client/src/vendor/ui/nav.test.ts` still passes; the sidebar renders a translated label.
3. **(R1–R3)** The «Turn into eval case» control on `FindingCard`. Enabled only when `accepted_at`
   or `dismissed_at` is set; otherwise rendered **disabled with the reason stated** (R3/AC-3), not
   hidden — the reason is a message key, not a literal. On success with `created: false`, open the
   existing case rather than reporting an error (R8/AC-10). Do **not** widen the shared
   `FindingActionKind` enum: it lives in `vendor/shared/contracts/findings.ts:82` and widening it
   drags both vendored copies into this package's diff, which P1 owns. Use a separate prop.
   *Check:* `FindingCard.test.tsx` gains three cases — accepted, dismissed, undecided-and-disabled —
   asserting the reason is present in the accessible name.
4. **(R10–R15, R52)** The Evals tab. Add `{ key: "evals", … }` to `TABS` in
   `AgentEditor/constants.ts` (`VALID_TABS` derives from it, so `?tab=evals` follows) and build
   `AgentEditor/_components/EvalsTab/`: the case list with the three-state last-run indicator and
   expected-vs-got counts (R11), the `N / M passing` badge (R12), the empty-state text (R10), the
   four summary figures with deltas and the dashboard link (R52). The case editor modal (R13–R15)
   is its own colocated component: name, three input tabs, `expected_output` as editable JSON with
   the valid/invalid badge blocking save (R14), and the «Run on save» switch that runs the case and
   shows its result inline (R15).
   Reuse `messages/en/eval.json` — `evalsTab.*` and `caseEditor.*` already carry these strings.
   *Check:* component tests for the three last-run states, the badge count, the blocked save on
   invalid JSON, and the result strip after a run-on-save.
5. **(R41, R42, R46, R47)** `client/src/app/evals/page.tsx` — agent cards (R41) and the all-agents
   recent-batches table (R42). Reuse `vendor/ui/charts/Sparkline` and `MetricCard`; do not write new
   chart code (`frontend-architecture` principle 6). The «Run all agents» action reports the skipped
   agents by name (R29/AC-37).
   *Check:* a test renders two agents and asserts the card fields and the table's one-row-per-batch
   shape.
6. **(R43–R47)** `client/src/app/evals/[agentId]/page.tsx` — three metric cards with deltas, the
   trend chart (`vendor/ui/charts/LineChart`), the batch table with a cost column, the date-range
   filter in **URL** state bounding both the chart and the table (C18, R46), the banner (R45), the
   suppression of deltas and banner below two completed batches (R44), and row selection in
   **screen** state enabling Compare at exactly two (C18, R47).
   *Check:* tests for zero/one/two/three selected rows against the Compare button's disabled state,
   and for a single-batch agent showing no delta and no banner.
7. **(R48–R51)** The compare modal: four old→new tiles with deltas (R48); the full system prompt
   with only the changed lines highlighted, using the `changed_lines` the server computed (R49); the
   same-version message with the metric deltas still shown (R49); the not-like-for-like warning
   (R50); and Promote, which reads the version snapshot and PUTs it (R51).
   *Check:* tests for different-version, same-version and different-case-set renderings.
8. **(C19)** Walk each of the six screens against its mockup under `specs/assets/` — element by
   element, answering *matches / differs / absent* for placement, the shape of each value, every
   label in the design's own words, and what each element does. Report differences; resolve none
   silently, in either direction.
   *Check:* the walk is written into the implementation report, not into a file.

---

### P4 — the acceptance command

**Agent:** implementer · **Depends on:** P2, P3

**Owns:** `scripts/verify-l06.sh`, `server/package.json`

**Contract:** none — it consumes what P2 and P3 built.

**Steps:**

1. **(R59, R60)** Write `scripts/verify-l06.sh` on the shape of `scripts/verify-l03.sh` — read that
   file first; it is the whole specification. Same header comment naming what each step proves and
   where, same `set -euo pipefail`, same `step()` printer, same `--with-db` opt-in with the Docker
   check and the explicit note when it is skipped, same non-zero exit on the first failure, and
   `pnpm` for `server/` and `client/` (never npm).
   Steps, each printing the criteria it proves:
   - scoring — `server/test/eval-scoring.test.ts` (AC-38 … AC-51)
   - fragment and diff guards — `server/test/eval-fragment.test.ts` (AC-4, AC-6, AC-12, AC-23)
   - batch runner on a stubbed provider — `server/test/eval-batch.test.ts` (AC-24 … AC-37)
   - client — the Evals tab, case editor, FindingCard, dashboard and compare suites (AC-3, AC-14 …
     AC-20, AC-53 … AC-63)
   - `--with-db` — `server/test/eval-routes.it.test.ts` (AC-1 … AC-11, AC-21, AC-22, AC-27 … AC-29,
     AC-67 … AC-70)
   *Check:* `./scripts/verify-l06.sh` exits 0 and prints a criterion for every step; deliberately
   breaking one assertion makes it exit non-zero at that step and run no later one.
2. **(R59)** Add `"verify:l06"` to `server/package.json`, mirroring `"verify:l03"` at line 6 — a
   plain `vitest run` over the hermetic server suites, not a call into the shell script.
   *Check:* `cd server && pnpm verify:l06` is green.

---

**Dispatch order.** P1 alone first, and it must land before either of the next two is dispatched —
P2 and P3 both import its schemas, and the client cannot validate a response it was given the wrong
shape for (C17). Then P2 and P3 **in parallel**: their file sets are disjoint, and P3's whole
dependency on P2 is the route table quoted into its brief. Then P4, once both have landed, because
it runs both suites.

The one file two packages could collide on is `client/src/vendor/shared/contracts/eval-ci.ts`: P1
owns it, P3 must not touch it. If P3 finds it needs a contract change, that is a finding to report,
not an edit — a one-sided vendored change is a critical the `repo · vendor` gate catches after the
fact.

## Tests

| Suite | Files | Command |
|---|---|---|
| server unit (hermetic) | `server/test/eval-scoring.test.ts` (new), `eval-fragment.test.ts` (new), `eval-batch.test.ts` (new) | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| server integration | `server/test/eval-routes.it.test.ts` (new) | `cd server && pnpm exec vitest run .it.test` |
| client | `FindingCard.test.tsx` (extended), `EvalsTab` + case-editor tests (new), `app/evals` page tests (new), compare-modal test (new) | `cd client && pnpm test` |

**In scope:** the integration suite above — yes, it is required, and it is where R53's tenancy,
R17's cascade and the four pre-flight refusals are actually proved. **Out of scope:** e2e. No
`e2e/specs/*.flow.json` is added or edited by this plan.

Two properties are worth stating because a test can pass without them being true:

- The scoring suite constructs **no container and no provider**. That is not tidiness; it is the
  evidence for R30/AC-38, and a suite that reaches a container proves nothing about it.
- Before leaving a new test green, confirm it fails when the behaviour is removed. The root
  `AGENTS.md` singles this out as the one check not to economise on — it has already caught a
  vacuous test and a `vi.mock` that had stopped intercepting in this repo.

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`.

```sh
cd server && pnpm arch          # depcruise src --config --ignore-known
cd server && pnpm typecheck     # tsc --noEmit -p tsconfig.json
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd client && pnpm lint          # eslint .
cd client && pnpm typecheck     # tsc --noEmit
cd client && pnpm test          # vitest run
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

Beyond Track A, this plan owes three more:

```sh
cd server && pnpm exec vitest run .it.test     # the integration suite is in scope here
./scripts/verify-l06.sh                        # and again with --with-db, Docker running
cd server && pnpm arch:strict                  # the frozen baseline must not have grown
```

`pnpm arch:baseline` is never run to clear a failure. The baseline only shrinks.

## Risks (from INSIGHTS.md)

| Risk | Recorded at | What this plan does |
|---|---|---|
| **Parent scoped, child assumed.** `agent_skills` shipped with the parent workspace-checked and the child's rows trusted, and it was unreachable — therefore unreviewable — until the lesson that filled the table. The entry closes: "When the next lesson fills `conventions`, `memory`, `eval` or `ci`, audit the same shape before wiring it up" | `server/INSIGHTS.md:955-966` | C13 and P2 step 3: `eval_runs` has no `workspace_id`, so **every** query joins `eval_cases` and filters on its `workspace_id`, and `owner_id` is checked against the workspace before any insert. P2 step 10 pins both halves with a foreign-workspace case, the way `skills.it.test.ts` pinned that one |
| **A hunk header can declare lines it does not carry.** A 49-byte crafted diff parsed to one file and one hunk, and building its line index blocked the single-process event loop for 1345 ms while allocating 478 MB; a 20-digit count reached `RangeError: Set maximum size exceeded` | `server/src/modules/reviews/diff-review.ts:101-147` (the guard's own comment) | P2 step 2 **moves** `assertReviewable` rather than re-implementing it, and P2 step 4 runs it over every `input_diff` on save and on run. A hand-edited case body is the same attacker-controlled text arriving on a new route |
| **A single-flight map on a second service instance is not a lock.** `BriefService` and `OnboardingService` are memoised on the container precisely because constructing them in `routes.ts` made their correctness depend on module registration running exactly once — the first non-HTTP caller would get a fresh empty map | `server/src/platform/container.ts:259-296` | P2 step 7: `evalService` is a memoised container getter with an override field, copying those two |
| **A re-export barrel does not satisfy `no-cross-module`.** The edge is reported against the file you import, so an `index.ts` inside the foreign slice just moves the violation onto the barrel | `.dependency-cruiser.cjs` rule `no-cross-module` comment | P2 steps 1–2 move the shared code out of `reviews/` into `_shared/`; `reviews/helpers.ts` re-exporting it back is legal because that import runs *into* `_shared`, not out of another slice |
| **`export *` barrels drag four unrelated module graphs into a test.** | `client/INSIGHTS.md:805-819`, quoted in `client/src/lib/hooks/onboarding.ts:9-13` | C16 and P3 step 1: `lib/hooks/eval.ts` is imported directly and never added to the barrel |
| **Truncating an API string with `String.slice` corrupts emoji** — `slice` counts UTF-16 units, so a fixed offset can land between surrogate halves, and reviewer text routinely carries emoji | `server/INSIGHTS.md` § Truncating text…; the fix is `truncateChars` in `modules/pulls/status.ts` | R9 truncates `input_meta.body` to 4 000 characters and R7 writes free text into `notes`. Both cut by code point, reusing that helper's approach rather than `slice` |
| **A vendored contract change that lands on one side only is invisible to both typecheckers** | root `AGENTS.md`; `pr-self-review/gates.md` § repo · vendor | C8, and P1 owning both copies as one step. P2 and P3 are forbidden from touching either |

## Alternatives rejected

Implementation approaches, not product decisions — the product decisions are the spec's D1–D14.

- **Import `loadDiff`, `assertReviewable` and `skillBodiesFor` from `modules/reviews` directly.**
  The shortest path and a straight `no-cross-module` failure — type-only imports included, since
  dependency-cruiser runs with `tsPreCompilationDeps`. Moving them to `_shared/` is the escape the
  rule's own comment names first.
- **Give `eval` its own copies of the diff guards and the skill filters.** No arch violation, and
  the worst option: two copies of the over-claiming-hunk guard, one of which will be updated. The
  measured 478 MB allocation is what the second copy would eventually stop preventing.
- **A `PrDiffLoader` port in `vendor/shared/adapters.ts` with a mock in `adapters/mocks.ts`.**
  Correct-looking and too heavy. A port is for an external dependency (`onion-architecture` §3.4);
  this is a pure composition of `container.git` — already a port — and a repository already hung off
  the container. The port would add an interface, an implementation and a mock to express nothing
  new.
- **A `batch_id` column, or an `eval_batches` table.** Contradicts N6 and D1; the jsonb column is
  already there and already `z.unknown()` in the contract.
- **Recomputing a batch's aggregate on read.** D3, and worth restating as an implementation trap: it
  is the *easier* code, and it silently makes a past batch's "17/20" move when a case is deleted,
  which turns every v6→v7 comparison into a comparison of different denominators.
- **A background job queue for the batch.** D9. It adds a "still running, come back later" state and
  a second read path, for a bounded 25-case ceiling.
- **Averaging per-case metrics.** D14/R38. A case with one expectation would weigh as much as a case
  with ten, and the harness would report improvements that are re-weightings.
- **A `POST /agents/:id/promote` route.** `GET /agents/:id/versions/:version` and `PUT /agents/:id`
  already exist and already produce exactly the behaviour AC-64 and AC-65 describe. A new route
  would be a second way to change an agent's config, and a second place for the version bump to
  drift.
- **Seeding eval cases so a screen looks populated.** Forbidden by D11, by the spec's stance, and by
  a standing instruction in this repository. R58's dataset is assembled through the product.

## Verification

Observable, checkable, ending in one end-to-end run through the real entry points.

| # | Check | Proves |
|---|---|---|
| V1 | `cd server && pnpm arch` exits 0 and `pnpm arch:strict` lists no more entries than before the branch | C1–C3, and that the `_shared` extraction actually removed the cross-slice need instead of hiding it |
| V2 | `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing | C8, P1 |
| V3 | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` green, with the scoring suite constructing no container | R30–R39 |
| V4 | `cd server && pnpm exec vitest run .it.test` green, Docker running | R16, R17, R22, R53–R55 |
| V5 | `cd client && pnpm lint && pnpm typecheck && pnpm test` green | R10–R15, R40–R52 |
| V6 | `./scripts/verify-l06.sh` exits 0 and names a criterion at every step; with one assertion deliberately broken it exits non-zero at that step and runs no later one | R59 |
| V7 | `./scripts/verify-l06.sh --with-db` additionally runs the route suite; with Docker stopped it fails with the explicit message rather than skipping silently | R60 |
| V8 | **Through the running app** (`./scripts/dev.sh`): open a PR with a decided finding, press «Turn into eval case», see the case in the agent's Evals tab; press it again and land on the same case; run the set from the tab; open the Eval Dashboard from the sidebar and see the batch in the card, the trend and the table | R1–R3, R8, R10–R12, R19, R27, R40–R43 — the one path no unit test covers |
| V9 | **Manual, real model.** Run the set, edit the agent's system prompt, run it again, select the two batches and compare: two different metric triples, a non-empty prompt diff with only the changed lines highlighted | R57 / AC-72 |
| V10 | **Manual, real model.** Add to the system prompt an instruction to report findings outside the set's expectations, run again on the same set: the new batch's precision is lower than the previous one's | R57 / AC-73 |
| V11 | **Manual, out of band.** At least one agent's set holds ≥ 8 cases, each carrying provenance in `notes`, and every one created through the button rather than inserted | R58 / AC-74 |

V9–V11 are stages, not code. They are the only criteria this plan cannot make green by itself, and
they are listed so that "all tests pass" is not mistaken for "the lesson is accepted". V11's dataset
is being assembled in parallel, outside this plan.

## Open questions

_None._ Both questions raised during planning were answered by the human on 2026-08-22: the
execution mode (multi-agent, the four packages above, in that order), and the treatment of AC-72,
AC-73 and AC-74 as non-code criteria proved hermetically in mechanism and manually in fact.

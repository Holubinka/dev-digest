# 13 — Onboarding Tour: server HTTP, persistence and the index-state gate

**Status:** Planned 2026-08-17
**Scope:** server (+ the two vendored `shared` copies)
**Modules touched:** `server/src/modules/onboarding` (new), `server/src/platform/container.ts`,
`server/src/modules/index.ts`, `server/src/vendor/shared/`, `client/src/vendor/shared/`,
`server/README.md`, and one file of `server/src/modules/repo-intel` (P1.9, by human decision)
**Requirements source:** `specs/SPEC-03-onboarding-tour.md` (approved 2026-08-17, 94 criteria)
**Execution:** multi-agent — this file is slice **B** of three. Slice A is
`plans/12-…-server-generation.md` (prompt, model call, grounding, package discovery, input budget);
slice C is `plans/14-…-client.md` (everything under `client/src/app` and `client/src/components`).
Inside this file there is exactly one work package.

---

## Requirements as understood

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | Reading a saved tour makes zero model calls, however many times it is read | `SPEC-03 § AC-46`, `§ AC-55` | clear |
| R2 | Both routes resolve the repo through the caller's workspace; a repo in another workspace answers exactly as a missing one | `SPEC-03 § AC-9` | clear |
| R3 | The saved record carries the index state it was built from: last indexed sha, files indexed, files skipped, status | `SPEC-03 § AC-54`, D6 | clear |
| R4 | The file count the API serves is the facade's `filesIndexed`, unmodified and not renamed | `SPEC-03 § AC-75` | clear |
| R5 | The read answer says whether the index has moved past the state the tour was built from, carries both states, and starts nothing | `SPEC-03 § AC-56`, D22 | clear |
| R6 | Generating replaces the one row for that repo; no previous tour is reachable anywhere afterwards | `SPEC-03 § AC-57`, `§ AC-59`, D8 | clear |
| R7 | A failed generation leaves the stored tour untouched and returns the cause | `SPEC-03 § AC-60` (server half), `§ AC-51` (persistence half) | clear |
| R8 | Generation is refused before any model call, naming exactly one of three machine-readable reasons: no ready index, indexing failed, language not supported | `SPEC-03 § AC-63`, `§ AC-73`, `§ AC-83` (server half), D19 | clear |
| R9 | The three reasons are derived only from what `IndexState` can express today; no "building" state is invented, and the reason id claims nothing about waiting | `SPEC-03 § AC-84` (server half), D19, `repo-intel/types.ts:25` | assumed — the exact mapping is mine, see § the gate |
| R10 | The generate route carries a 6-per-minute limit **per workspace** and resolves tenancy before any spend | `SPEC-03 § AC-61`, NFR «Межа частоти» | clear |
| R11 | Two concurrent generations for one repo make one call and both receive its result | `SPEC-03 § AC-74` | clear |
| R12 | The five numbers AC-52 names — attempts, our counted input tokens, the counter id, the provider's `tokens_in`, the cost — are **accepted from the generator and persisted on the record**, unaltered and none of them recomputed here. Producing them is slice A's half | `SPEC-03 § AC-52` (recording half; slice A's R23 is the counting half) | clear |
| R13 | The five grounding drop counters are recorded on the record and logged with the request. Counting them is slice A's half | `SPEC-03 § AC-40` (recording half) | clear |
| R14 | A feature model that is not configured answers as `config_error`, not as a 500 | `SPEC-03 § AC-53` (server half) | clear |
| R15 | With no tour saved, the read returns an explicit empty answer and generates nothing | `SPEC-03 § AC-62` (server half), D9 | clear |
| R16 | A partial index generates, and `files_skipped` travels to the client | `SPEC-03 § AC-64` (server half) | clear |
| R17 | Generation runs inside the request, not through `JobRunner` | NFR «Незавершена фонова задача» | clear |
| R18 | A read is one primary-key row read plus tenancy plus `getIndexState` (p95 < 150 ms) | NFR «Час відповіді читання» | clear |
| R19 | Neither route accepts a locale or language input, and the row is keyed by repo alone | `SPEC-03 § AC-88` (supporting half; the criterion is slice A's), D20 | assumed |
| R20 | The persisted document and the API record are one shape, defined in a **new** vendored contract file and mirrored to the client copy; the `onboarding` table gains no column | D6 (explicitly left to the planner), `0000_init.sql:205` | assumed — see § Alternatives rejected |

Every step below cites the `R#` it serves. Criteria this plan does not carry are named by number in
**Out of scope**.

---

## Out of scope

**Not built here, and not a suggestion — these files belong to another agent.**

- Anything under `client/` except `client/src/vendor/shared/` (the mirrored contract).
- The prompt, the model call, grounding, package discovery, the input budget and the
  `Onboarding` / `OnboardingSection` / `OnboardingDraft` contracts — slice A owns
  `modules/onboarding/{generate-executor.ts,prompt.ts,helpers.ts,packages.ts,constants.ts}`,
  `src/prompts/onboarding.system.md` and `contracts/knowledge.ts` in **both** vendored copies.
- **`modules/repo-intel`, with exactly one admitted exception.** Its facade is not widened (D21,
  N7) and nothing here reindexes. The exception is `pipeline/full.ts` in **P1.9**: the second of
  AC-83's three refusal reasons is unreachable end to end until something writes
  `status: 'failed'`, and no other slice touches that module. Admitted by human decision on
  2026-08-17 rather than deferred, and scoped to one catch block, one type widening and one lying
  comment — anything else in `repo-intel` remains out of scope.
- Reindexing. `POST /repos/:id/resync` already exists and no route here calls it (N4).
- `JobRunner`, a `running` row, cancellation, history (N2, NFR).
- A migration. See R20 and § Alternatives rejected.

**Acceptance criteria deliberately left to another slice**, so the coordinator can check 1…94:

- **To slice A (plan 12)** — AC-10, 14, 15, 17, 19, 21, 23, 25, 26, 28, 30, 31, 32, 34, 37, 38, 39,
  41, 42, 43, 45, 47, 48, 49, 50, 51, 70, 71, 72, 76, 79, 80, 86 (produces), 87, 88, 89, 90
  (produces), 91, 92, 93, 94.
- **To slice C (plan 14)** — AC-1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 16, 18, 20, 22, 24, 27, 29, 33,
  35, 36, 44, 58, 65, 66, 67, 68, 69, 77, 78, 81, 82, 84, 85.
- **Split, halves named** — this plan carries the server half of AC-53, 56, 60, 62, 64, 75, 83 and
  the recording half of AC-40 and AC-52; the screen half of each is slice C's, and the counting
  half of AC-40 and AC-52 is slice A's _(settled by the coordinator 2026-08-17: A produces the
  numbers, this slice persists them — see R12)_. AC-51's "nothing is saved" is the same write this
  plan governs; its repair loop is slice A's.

---

## What already exists

- **The table, with its migration.** `onboarding` — `repo_id` PK, `json` jsonb NOT NULL,
  `generated_at` — is declared at `server/src/db/schema/context.ts:123-129` and created by
  `server/src/db/migrations/0000_init.sql:205-209`, with the FK cascade at `:385`. **There is no
  pending migration and none is needed** (R20). No row has ever been written: nothing in
  `server/src` references the table.
- **Cost is already wired end to end.** `deepseek/deepseek-v4-flash` is in the static fallback table
  (`server/src/adapters/llm/pricing.ts:36`, "confirmed 2026-08-05"), and
  `container.llm('openrouter')` injects `priceBook.estimate` as the provider's per-call cost hook
  (`platform/container.ts:335-341`). `StructuredResult.costUsd`
  (`vendor/shared/adapters.ts:83-91`) therefore arrives already priced. **No price-book work.**
- **The nearest precedent pair**, named by the spec's `## Module interactions`:
  `GET /repos/:id/conventions` + `POST /repos/:id/conventions/extract`
  (`modules/conventions/routes.ts:40-62`), including the audit line at `:54-59`.
- **The cache + paid-mutation shape with a single-flight**: `modules/brief/{routes,service}.ts` —
  the `inFlight` map at `service.ts:61`, the per-workspace `keyGenerator` at `routes.ts:51-77`, and
  the memoised container getter at `platform/container.ts:258-261`.
- **Tenancy read**: `ConventionsRepository.getRepo(workspaceId, repoId)`
  (`modules/conventions/repository.ts:52-65`) is the exact query this slice needs.
- **The facade read**: `container.repoIntel.getIndexState(repoId)` — always answers, degrades
  instead of throwing (`modules/repo-intel/service.ts:204-211`).
- **Nothing else.** There is no `modules/onboarding/`, no entry in `modules/index.ts:31-47`, and no
  onboarding route in `server/README.md`'s API map.

---

## Constraints

| Rule | Source |
|---|---|
| Register the module by hand in `src/modules/index.ts`; there is no filesystem autoload | `server/AGENTS.md` § Conventions; `modules/index.ts:22-25` |
| `modules/onboarding` may not import `modules/repo-intel` — the `no-cross-module` rule catches `import type` too. Reach the facade through `container.repoIntel`, and declare the index shape **structurally** in this slice's own `types.ts` | `server/.dependency-cruiser.cjs:146-160`; precedent `_shared/feature-models.ts:33-35`, `modules/brief/types.ts` |
| No Drizzle outside `repository.ts`, no `container.db` in a route | `onion-architecture` §3.1–3.2; rules `no-sql-outside-repository`, `no-db-from-routes` |
| The service takes its repository as a constructor parameter (the test seam) and reaches ports through the container | `onion-architecture` §3.3 |
| A service holding instance state is memoised by the container, never constructed by a route — otherwise the single-flight map holds by registration count | `server/INSIGHTS.md:857-877` |
| A jsonb column is untyped input: parse it on read. Every field this contract later gains carries `.default(...)`, or old documents 422 | `server/INSIGHTS.md:699-718`, `:1341-1361` |
| Both vendored copies stay byte-identical; the server copy is the source of truth | root `AGENTS.md` § Non-default conventions; gate `repo · vendor` |
| Per-route rate limits, not the global one: the global limiter is not registered under `NODE_ENV=test` | `app.ts:105-107`; `modules/context/routes.ts:50-58` |
| A per-**workspace** bound needs an async `keyGenerator`; `@fastify/rate-limit` keys by IP by default | `modules/brief/routes.ts:51-77` |
| Declare `schema.params`; never hand-roll `Schema.parse(req.body)` | `server/README.md:51-53` |
| The generate POST carries **no body**, so it must declare no `schema.body`: `apiFetch` omits `content-type` for a body-less POST, and Fastify then rejects a declared JSON body as empty | `client/src/lib/api.ts:24-33` (the comment names "tour generate" verbatim) |
| Secrets never through `AppConfig` or `process.env` | root `AGENTS.md`; `platform/container.ts` |
| `pnpm arch` must stay green with the baseline **unchanged** — never `pnpm arch:baseline` | `onion-architecture` §2 |

---

## Recommendations

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | ~~`repo_index_state` is never stamped `status: 'failed'`~~ — **accepted by the human on 2026-08-17 and built here as step P1.9**, not deferred. Kept as a row so the finding stays readable: the comment at `full.ts:64-70` claims the stamp happens, the only `failed` written anywhere is the *job* row (`platform/jobs.ts:91`), and AC-83's second reason was therefore unreachable end to end. | It **is** the plan now (P1.9). `status.ts` needed no change — the reader was already correct. | One catch block, one type widening, one comment, one unit case. |
| 2 | **Add a "building" state to `IndexStatus`.** D19 and AC-84 exist only because it is absent. With it, the first refusal text could honestly say "wait". | Yes — AC-84 says the criterion is revisited if the contract gains the state. | A `repo-intel` contract change plus every consumer of `IndexStatus`. Not proportionate to this feature alone. |
| 3 | **`server/README.md`'s API map is already missing `context`.** This plan adds its own row and does not fix that. | No. | One line, whenever someone touches that file next. |

---

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| P1.2–P1.6 | `onion-architecture` | which file each piece goes in, the repository-as-parameter seam, ports through the container, and why `pnpm arch` will otherwise fail |
| P1.7 | `fastify-best-practices` | route-level `config.rateLimit`, thrown-error → status mapping, no body schema on a body-less POST |
| P1.5 | `drizzle-orm-patterns` | the `onConflictDoUpdate` upsert; **no schema change is planned**, so read it for the query, not for a migration |
| P1.1 | `zod` | the contract file: `.extend()`, `.nullable()`, and `.default()` on every field that could be added later |

---

## Work packages

One package. The work is a single dependency chain — contract, then ports, then repository, then
service, then routes — and a second cold context would pay to re-read the same contract it was
handed. The multi-agent split of this feature is **across** plans 12/13/14, not inside this one.

### P1 — the `onboarding` server module

**Agent:** implementer · **Depends on:** plan 12 (see *Dispatch order* below)

**Owns — the exact files this package may write. No other package writes them:**

```
server/src/vendor/shared/contracts/onboarding-api.ts      (new)
client/src/vendor/shared/contracts/onboarding-api.ts      (new, byte-identical mirror)
server/src/vendor/shared/index.ts                         (one export line)
client/src/vendor/shared/index.ts                         (one export line)
server/src/modules/onboarding/types.ts                    (new)
server/src/modules/onboarding/status.ts                   (new)
server/src/modules/onboarding/repository.ts               (new)
server/src/modules/onboarding/service.ts                  (new)
server/src/modules/onboarding/routes.ts                   (new)
server/src/modules/index.ts                               (one import + one entry)
server/src/platform/container.ts                          (two getters + two override fields)
server/README.md                                          (one line in the API map)
server/src/modules/repo-intel/pipeline/full.ts            (P1.9 — one catch, one type, one comment)
server/test/indexer-pipeline.test.ts                      (P1.9 — one case, reusing its stub)
server/test/onboarding-contract.test.ts                   (new)
server/test/onboarding-status.test.ts                     (new)
server/test/onboarding-service.test.ts                    (new)
server/test/onboarding-routes.test.ts                     (new)
server/test/onboarding.it.test.ts                         (new)
```

The last two entries before the tests are the **only** files outside this slice's own folders, and
they are there by the human decision recorded in P1.9 — not by drift. Nothing else in
`modules/repo-intel` is touched.

**Explicitly NOT owned here:** `modules/onboarding/{generate-executor.ts,prompt.ts,helpers.ts,packages.ts,constants.ts}`
and `contracts/knowledge.ts` (both copies, including `Onboarding`, `OnboardingDraft` and every
counter, id and number inside them) — slice A. Everything under `client/` other than the vendored
mirror — slice C.

**Two coordination points, both named because two other agents are writing concurrently:**

1. `vendor/shared/index.ts` (both copies) is the one file this package and slice A might both
   touch. This package adds exactly one line: `export * from './contracts/onboarding-api.js';`.
   Slice A extends `knowledge.ts`, which the barrel already exports, so it should need no edit
   there — if it does, the two lines do not overlap and a merge is trivial.
2. `platform/container.ts` is edited **only** here, and one line of it names a class slice A owns
   (below).

---

#### Contract — what slices A and C may assume once P1 is done

Repeated in full because each agent starts cold.

**A · the wire.** Two routes, mirroring the conventions pair.

```
GET  /repos/:id/onboarding            → 200 OnboardingPage      (zero model calls, always)
POST /repos/:id/onboarding/generate   → 200 OnboardingRecord     (one generation, 6/min/workspace)
```

`OnboardingPage`:

```jsonc
{
  "tour": null,                  // OnboardingRecord when one is saved
  "index": {                     // the CURRENT facade state
    "status": "full",            // full | partial | degraded | failed
    "last_indexed_sha": "",      // "" when there is no index at all
    "files_indexed": 0,
    "files_skipped": 0,
    "updated_at": "1970-01-01T00:00:00.000Z"
  },
  "stale": false,                // see the rule below — never derive it on the client
  "generate_blocked": null       // null | "index_missing" | "index_failed" | "language_unsupported"
}
```

**`OnboardingRecord` is `OnboardingDraft` plus two stamps, and nothing else**
_(coordinator's split, 2026-08-17)_. `OnboardingDraft` lives in `contracts/knowledge.ts` and
belongs to slice A: it carries the tour itself (sections, first tasks, the `packages` blocks,
whatever marks verified paths for prose links) **and** everything the generation knows about
itself — `inputs`, `dropped`, `package_scan`, `budget`, `input_tokens_counted`, `tokenizer`,
`attempts`, `tokens_in`, `provider`, `model`, `cost_usd`. It deliberately carries **no stamps**:

```ts
// contracts/onboarding-api.ts — this slice. The whole of its record vocabulary.
export const OnboardingIndexState = z.object({
  last_indexed_sha: z.string(),
  files_indexed: z.number().int(),
  files_skipped: z.number().int(),
  status: z.enum(['full', 'partial', 'degraded', 'failed']),
});

export const OnboardingRefusal = z.enum(['index_missing', 'index_failed', 'language_unsupported']);

export const OnboardingRecord = OnboardingDraft.extend({
  index_state: OnboardingIndexState,   // the state the gate approved and the tour was built from
  generated_at: z.string(),            // ISO-8601, stamped by the write
});
```

Everything else in the record — every counter, every id, every number — is declared once, in
`knowledge.ts`, by the agent that produces it. This slice declares four things: the index state,
the refusal enum, the record and the page.

**Why the split, in one line each, because it is what keeps the three plans from colliding:**

- **A draft has no stamps, so `.extend()` cannot overwrite anything.** The seam is safe by
  construction rather than by agreement. It is the same cut as AC-52's: slice A produces the
  numbers, this slice records them.
- **The two stamps belong to whoever gates and stores.** `index_state` is the snapshot this
  slice's gate approved (P1.5), and `generated_at` is set by the write. A generator cannot know
  either without being handed them, and handing them in only to have them handed back is a longer
  way to the same value.
- **One declaration per type.** Both slices had declared an `OnboardingRecord` in mirrored files;
  each package compiles against its own vendored copy, so only the `repo · vendor` gate would have
  seen it, and only after both had landed.

**The canonical vocabulary** _(coordinator's decision 2026-08-17 — plans 12 and 14 have the same
table)._ Keys are `snake_case` throughout: the repository's contracts carry 309 snake keys against
14 camel.

| Vocabulary | Owner | Canonical |
|---|---|---|
| `packages` | **slice A** | the array of package blocks, inside `Onboarding` |
| walk facts | **slice A** | `package_scan`: `found`, `shown`, `depth`, `excluded_dirs` |
| drop counters | **slice A** | `unknown_path`, `unknown_script`, `manager_mismatch`, `unknown_complexity`, `unknown_section` |
| input ids | **slice A** | `repo_map`, `package_configs`, `critical_paths`, `file_samples`, `project_docs` |
| refusal reasons | **this slice** | `index_missing`, `index_failed`, `language_unsupported` — slice A drops its duplicate |
| index provenance | **this slice** | `index_state` |

The rule behind it: **the wrapper renames, the wrapped does not.** This record is built *around*
slice A's draft, so A's names come first and any name of this slice's must go around them. An
earlier draft of this file called the walk facts `packages`, which under `.extend()` would have
silently replaced A's array of package blocks with an object of counts — the whole "How to run"
section gone from the record, with no error anywhere: typecheck cannot see it (each package
compiles against its own vendored copy) and the client does not validate responses
(`client/src/lib/api.ts`, by design). That is why P1.10's contract test exists and why the two
stamps are the only keys this slice adds.

**One obligation this slice hands to slice A, because the reason for it lives here.** The record is
**parsed on read** out of a jsonb column (P1.4), so every field of `OnboardingDraft` needs
`.default(...)` — a count `.default(0)`, an array `.default([])`. A field added to the draft later
without one turns every stored row into a 422 blamed on the caller, which is the failure recorded
at `server/INSIGHTS.md:1341-1361`. The `.default()` belongs beside the field, in A's file; the
consequence lands here.

**Errors on the wire** — the envelope is `{ error: { code, message, details } }` (`app.ts:163-167`),
and the client already surfaces `code` as `ApiError.code` (`client/src/lib/api.ts:47-61`). The three
refusal reasons are three **codes**, not a payload the client has to parse:

| Status | `error.code` | When | Criterion |
|---|---|---|---|
| 404 | `not_found` | repo missing **or** in another workspace — identical answers | AC-9 |
| 409 | `onboarding_index_missing` | no ready index (no row, `flag_off`, clone not finished) | AC-63, AC-83 |
| 409 | `onboarding_index_failed` | the indexer stamped `failed`/`degraded` | AC-83 |
| 409 | `onboarding_language_unsupported` | a completed pass indexed zero files | AC-73, AC-83 |
| 429 | (rate limit) | more than 6 generations a minute in this workspace | AC-61 |
| 500 | `config_error` | no model / no provider key | AC-53 |
| 502 | `external_service_error` | generation failed; **the saved tour is untouched** | AC-51, AC-60 |

**Timing, for slice C:** the POST holds the connection for as long as the generation takes — up to
the 180 000 ms clock slice A puts on the call (NFR). Nothing on the server shortens that: `app.ts`
sets no `requestTimeout` or `connectionTimeout`, and `apiFetch` sets no `AbortSignal`. The GET is a
sub-150 ms read.

**B · the A↔B seam.** Declared in `modules/onboarding/types.ts` (this package), implemented by
slice A:

```ts
export interface OnboardingGenerator {
  /** Everything between "here is the repo" and a grounded draft. */
  run(input: OnboardingGenerateInput, log: OnboardingLogger): Promise<OnboardingDraft>;
}

export interface OnboardingGenerateInput {
  workspaceId: string;
  repo: { id, owner, name, fullName, defaultBranch, clonePath: string | null };
}
```

**Three things about that signature, each settled against a precedent rather than a preference**
_(coordinator, 2026-08-17)_:

- **`run`, not `generate`.** The repository has exactly one executor and it is
  `ContextScanExecutor.run(input)` (`modules/context/scan-executor.ts:38`), called as
  `executor.run({ workspaceId, repoId })` (`context/service.ts:79`). Slice A declares
  `OnboardingGenerateExecutor.run(...)`; the call site is this slice's, so it follows.
- **`log` is a second positional argument, not a field of the input.** Same house style as
  `BriefService.compute(workspaceId, prId, log)` — the composition root has no logger of its own,
  `req.log` belongs to the request, and `server/INSIGHTS.md:875-877` records the move out of the
  constructor and the `ReviewService` precedent behind it.
- **`repo`, not `repoId`** — deliberately diverging from `scan-executor`, which takes `repoId`
  because a job handler starts with nothing but ids. This slice has already read the `RepoRef` to
  prove tenancy (P1.5 step 1), so passing it hands over a row that is already in memory. Do not
  "restore the precedent": re-reading it inside the executor is a second query for a fact the
  caller holds, and the tenancy proof would then live in two places.

**There is no `index` argument.** Slice A neither reads nor produces the index state; this slice
gates on it and stamps it (`index_state`). The honest consequence, stated because the earlier draft
of this file claimed something stronger: the stamp is **the state the gate approved**, not a state
re-verified after the generation. A background reindex landing inside the ≤180 s window would leave
the stamp naming the earlier sha — and the visible outcome is exactly right anyway, because the very
next read compares it against the current state and reports the tour as `stale` (AC-56). No extra
read, no lock, and nothing claimed that is not true.

**The seam returns the draft whole** — one type, `snake_case`, already the contract. There is no
decomposition into `{ tour, inputs, dropped, usage }` and no `camelCase` → `snake_case` mapping in
this slice: the draft *is* the record minus two stamps, so P1.5 spreads it and adds them.
The five numbers AC-52 names (`attempts`, `input_tokens_counted`, `tokenizer`, `tokens_in`,
`cost_usd`) must therefore be **on the draft**; this slice persists what it is handed and computes
none of them (R12).

Slice A's implementation **throws `ConfigError` unchanged** when the model or key is missing (this
slice lets it propagate — AC-53); every other throw is wrapped here as `ExternalServiceError` with
nothing written (AC-60). It is reached at `container.onboardingGenerator`, and this package's
`container.ts` edit constructs it as `new OnboardingGenerateExecutor(this)` from
`modules/onboarding/generate-executor.ts` — the class name slice A declares, in the file the
`*-executor` convention puts it in (`onion-architecture` §2, `modules/<m>/<verb>-executor.ts`).
**If plan 12 places it elsewhere, use its path — that one line is the only place in P1 that depends
on it.** The port interface keeps its own name (`OnboardingGenerator`) rather than matching the
class: `container.ts` imports both, and two identical names in one file is a collision. That
port-named-for-the-role / class-named-for-the-work pair is the existing shape —
`BriefReader` implemented by `BriefService` (`container.ts:258-261`).

**C · the gate**, which is this slice's rule and lives in `status.ts` in one place so nothing
re-derives it:

| `IndexState` from the facade | Answer | Why |
|---|---|---|
| `status` is `failed`, **or** `degraded === true` with `degradedReason` other than `no_data` / `flag_off` | `index_failed` | the indexer stamped a failure |
| no row → `degradedReason: 'no_data'`; `flag_off`; a persisted `no_clone` row | `index_missing` | there is nothing to read; **the id claims nothing about waiting** (AC-84) |
| a completed pass (`full` / `partial`, not degraded) with `filesIndexed === 0` | `language_unsupported` | `walkClone` found no file with a `SUPPORTED_EXT`, and the pipeline persists exactly this: `status:'partial'`, `filesIndexed: 0`, `stats.reason:'no_files'` (`pipeline/full.ts:101-114`) |
| `full` or `partial` with `filesIndexed > 0` | generate | `partial` is a working index — AC-64 |

**The honest boundary, stated rather than papered over.** `IndexStatus` is
`full | partial | degraded | failed` (`repo-intel/types.ts:25`) and has **no "building" state**, so
"indexing just started" and "indexing never started" are the same observation. This plan does not
pretend otherwise: it answers within what exists, `index_missing` is a statement about the present
and not a promise about the future, and the two ways to lift that limit are Recommendations 1 and 2
rather than steps. A second, smaller consequence is recorded with them: `flag_off` is a fourth
cause folded into `index_missing`, because AC-83 fixes the count at three — so the service logs the
underlying `degradedReason` on every refusal, and the log is where that distinction lives.

**Staleness (AC-56), exactly:**

```
stale = tour !== null
     && index.last_indexed_sha !== ''
     && index.last_indexed_sha !== tour.index_state.last_indexed_sha
```

The empty-string guard is load-bearing: a plain `!==` would report a perfectly good tour as stale
the moment the index row goes missing, which is the opposite of what AC-56 describes.

---

#### Steps

**P1.1 — the contract file, in both vendored copies.**
Files: `server/src/vendor/shared/contracts/onboarding-api.ts` (new),
`server/src/vendor/shared/index.ts`, then the identical pair under `client/src/vendor/shared/`.
Serves R3, R4, R20 (AC-54, 75), and carries R12/R13 by persisting what the draft brings.
Four declarations and no more: `OnboardingIndexState`, `OnboardingRefusal`, `OnboardingRecord =
OnboardingDraft.extend({ index_state, generated_at })`, `OnboardingPage`. `OnboardingDraft` is
imported from `./knowledge.js` — **do not restate one field of it**, and do not re-declare an
`OnboardingRecord` there either: that duplication is what the coordinator's split resolved.
`index_state.status` restates the four `IndexStatus` values as a local `z.enum`: the client
compiles only against the vendored copies and cannot import a server module type; say so in a
comment so nobody "fixes" it into an import.
`index_state` and `generated_at` are the only keys this extension adds, and neither may exist on
the draft — that is the property `test/onboarding-contract.test.ts` (P1.10) asserts, because a
collision produces a **valid** schema and no error anywhere.
Check: `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing;
`cd server && pnpm typecheck` and `cd client && pnpm typecheck` both pass.

**P1.2 — ports and structural types.**
File: `server/src/modules/onboarding/types.ts` (new). Serves R8, R9, R11 and the A↔B seam.
Declare `OnboardingGenerator` (one method, `run(input, log)`), `OnboardingGenerateInput`
(`workspaceId` and `repo`, and nothing else), `OnboardingLogger`, `OnboardingReader` (what the route
and the container getter type against) and `IndexSnapshot`. There is no `OnboardingGenerateResult`:
the generator returns `OnboardingDraft` from `@devdigest/shared`.
`IndexSnapshot` is consumed by `status.ts` and the service and is **not** part of the seam — the
generator is never handed one.
It is declared **structurally** — `status`, `degraded?`, `degradedReason?`,
`filesIndexed`, `filesSkipped`, `lastIndexedSha`, `updatedAt`, `reason?` — and never imported from
`modules/repo-intel/types.ts`: that import is a `no-cross-module` violation even as `import type`.
An `IndexState` satisfies it by construction. Precedent for the technique: `SettingsReader`
(`_shared/feature-models.ts:33-35`).
**These field names stay `camelCase` and are not "corrected" to the contract's `snake_case`:** the
type's whole purpose is to be satisfied by `IndexState` (`repo-intel/types.ts:42-50`) without a
mapping, and renaming a key here breaks that structurally while typecheck reports it as an
unrelated error at the call site. The `snake_case` rule governs `contracts/**` — what goes over the
wire — and `index_state` is where this snapshot becomes snake, in P1.5 step 5.
Check: `cd server && pnpm arch` exits 0.

**P1.3 — the pure gate and staleness.**
File: `server/src/modules/onboarding/status.ts` (new). Serves R5, R8, R9 (AC-56, 63, 73, 83, 84).
Two pure functions over `IndexSnapshot`: `refusalFor(index): OnboardingRefusal | null` implementing
the table above, and `isStale(record, index): boolean` implementing the formula above. No I/O, no
container, no clock — `status.ts` is Core in this repository's rings.
Check: `test/onboarding-status.test.ts` (P1.10) covers all five gate rows and both staleness edges.

**P1.4 — the repository.**
File: `server/src/modules/onboarding/repository.ts` (new). Serves R2, R6, R20 (AC-9, 54, 57, 59).
`constructor(private db: Db) {}` and three methods:
- `getRepo(workspaceId, repoId)` — the `RepoRef` for the service and slice A, workspace-scoped;
  copy `conventions/repository.ts:52-65` including the returned columns (`clonePath` is needed by
  slice A).
- `get(repoId): Promise<OnboardingRecord | null>` — one PK read, then
  `OnboardingRecord.safeParse(row.json)`. **On a parse failure return `null` and log a warning with
  the repoId**: a stored document that no longer matches the contract must degrade to "no tour yet,
  press Generate", not to a 422 blamed on the caller — that is exactly the failure recorded in
  `server/INSIGHTS.md:1341-1361`.
- `upsert(repoId, record)` — `insert … onConflictDoUpdate({ target: onboarding.repoId, set: { json,
  generatedAt } })`, the shape used by `repo-intel/repository.ts:294-320`. One row per repo is what
  makes AC-59 true; there is no second write path and no history table.
No `workspaceId` column exists on `onboarding` and none is added: every read starts from a repo the
service has already proved belongs to the caller, exactly as `repo_doc_edits` documents
(`db/schema/context.ts:264-269`).
Check: covered by `test/onboarding.it.test.ts` (P1.10).

**P1.5 — the service.**
File: `server/src/modules/onboarding/service.ts` (new). Serves R1, R2, R5, R6, R7, R8, R10, R11,
R14, R15, R16, R17, R19.
`constructor(private container: OnboardingContainer, private repo: OnboardingRepository)` — the
repository as a parameter is the unit-test seam (`onion-architecture` §3.3); ports (`repoIntel`,
`onboardingGenerator`) are reached through the container, which is what the container is for.

- `page(workspaceId, repoId)` → `OnboardingPage | undefined`. `undefined` means "not this
  workspace's repo" and the route turns it into 404 (AC-9). Reads the row and `getIndexState` in
  one `Promise.all`, then fills `stale` and `generate_blocked` from `status.ts`. **Nothing on this
  path may touch `container.onboardingGenerator` or `container.llm`** — that is AC-46 and it is
  what the unit test asserts.
- `generate(workspaceId, repoId, log)` → `OnboardingRecord`, in this order and no other:
  1. `getRepo` → `undefined` becomes `NotFoundError` (tenancy **before** spend — AC-61).
  2. single-flight: `private inFlight = new Map<string, Promise<OnboardingRecord>>()` keyed by
     `repoId` alone; a second caller awaits the first promise and both get the same record
     (AC-74). `finally { this.inFlight.delete(key) }`.
  3. `getIndexState` once, then `refusalFor` → throw
     `new AppError('onboarding_' + reason, <message>, 409)` and log the underlying
     `degradedReason`. Nothing past this point runs, so zero model calls (AC-63).
  4. `container.onboardingGenerator.run({ workspaceId, repo }, log)` — two arguments, `run` not
     `generate`, no `index` (see the seam above for all three, each settled against a precedent).
     The snapshot from step 3 stays here; it is what step 5 stamps.
  5. stamp and store: `{ ...draft, index_state: fromSnapshot(index), generated_at: new
     Date().toISOString() }`, then `upsert`. Two keys added, no mapping, no renaming — the draft is
     already the contract (coordinator's split), and it carries no stamp for the spread to
     overwrite. The write happens **only here**: every earlier throw leaves the previous row
     untouched (AC-60).
  6. Errors: `ConfigError` re-thrown as itself (AC-53); anything else wrapped as
     `ExternalServiceError` (AC-51/AC-60). `BriefService.compute` (`brief/service.ts:98-126`) is the
     precedent for both halves.
- Neither method takes a locale or language argument, and the key is `repoId` (R19, AC-88): a
  locale in the key would multiply a cache the spec fixed at one row per repo.
- No `container.jobs` anywhere in this file (R17).
Check: `test/onboarding-service.test.ts` (P1.10).

**P1.6 — composition root.**
File: `server/src/platform/container.ts`. Serves R11, R14.
Add `onboarding?: OnboardingReader` and `onboardingGenerator?: OnboardingGenerator` to
`ContainerOverrides`, and two memoised getters beside `briefService`
(`container.ts:254-261`): `onboardingService` → `new OnboardingService(this, new
OnboardingRepository(this.db))`, and `onboardingGenerator` → `new OnboardingGenerateExecutor(this)`
from `modules/onboarding/generate-executor.ts` (slice A's class — see the Contract note for what to
do if plan 12 puts it elsewhere). **The service must be memoised**: the single-flight map
is a lock only while there is one instance, and constructing it in the route is the exact bug
`server/INSIGHTS.md:857-877` records.
Check: `test/onboarding-routes.test.ts` asserts `container.onboardingService ===
container.onboardingService`.

**P1.7 — the routes, and registration.**
Files: `server/src/modules/onboarding/routes.ts` (new), `server/src/modules/index.ts`.
Serves R1, R2, R10, R13, R15 (AC-9, 40, 46, 61, 62).
A Fastify plugin in the shape of `conventions/routes.ts`: `const service = container.onboardingService;`
and nothing else constructed. Both routes declare `schema: { params: IdParams }` and **no body
schema**. `getContext(container, req)` first, then delegate, then `if (!result) throw new
NotFoundError('Repo not found')`.
The POST carries `config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator } }`, with the
async `keyGenerator` copied from `brief/routes.ts:67-77` including its `req.ip` fallback — 6 is the
figure the NFR names and **per workspace** is why the generator is needed at all.
After a successful generation the route logs the audit line, the way `conventions/routes.ts:54-59`
does and for the reason its comment gives — the drop counters are the only record of what grounding
threw away (AC-40): `req.log.info({ repoId, ...record.dropped, package_scan: record.package_scan,
inputs: record.inputs.map(i => ({ id: i.id, status: i.status, tokens: i.tokens })), attempts,
tokens_in, cost_usd }, 'onboarding generation')`. **No tour text and no `packages` blocks in the
log** — that is another repository's content, the record already holds it, and the counters are
what the line exists for.
Then one import and one entry in `modules/index.ts` (hand registration, `server/AGENTS.md`).
Check: `cd server && pnpm arch` exits 0 (no `container.db` in the route); the integration test
reaches both routes.

**P1.8 — the API map.**
File: `server/README.md`. Serves R20's discoverability, no AC.
One node in the `Repo intelligence` subgraph of the API-map diagram:
`onboarding["onboarding<br/>GET /repos/:id/onboarding (cached, zero LLM)<br/>POST /repos/:id/onboarding/generate (one call, 6/min per workspace)"]`.
Do not touch the rest of the file; the missing `context` row is Recommendation 3, not this step.

**P1.9 — make AC-83's second reason reachable: stamp `status: 'failed'`.**
Files: `server/src/modules/repo-intel/pipeline/full.ts`, `server/test/indexer-pipeline.test.ts`.
Serves R8 (AC-83's second reason, end to end).
_(Human decision, 2026-08-17: this is a step of this plan, not a recommendation deferred to another
one. It is a **deliberate reach into another module** — see § Out of scope for why it is admitted.)_

The defect, verified rather than assumed: the doc comment at `full.ts:64-70` states "Errors that
abort the whole run still stamp a `status='failed'` row before re-throwing", and **nothing does**.
The only writer of `status: 'failed'` in the repository is `platform/jobs.ts:91`, which writes the
*job* row. The reader is intact and correct — `repo-intel/repository.ts:218` maps
`'degraded' | 'failed'` onto a degraded state, and `status.ts` (P1.3) maps that to `index_failed` —
so the branch is **live on read and dead on write**, and an index that crashed is today
indistinguishable from one that never ran.

1. Wrap the body of `runFullIndex` after the clone check in `try/catch`. In the catch: read the
   previous state with `repository.tryGetIndexState(repoId)`, then `safePersist(repository, repoId,
   prev?.lastIndexedSha ?? '', 'failed', prev?.filesIndexed ?? 0, prev?.filesSkipped ?? 0, { reason:
   'index_failed', degradedReason: 'index_failed', error: asMessage(err), durationMs: Date.now() -
   startedAt })`, then re-throw. Both keys, matching the house style of the `no_clone` early exit
   (`full.ts:88-92`): `'index_failed'` is already a member of `DegradedReason` (`types.ts:27-32`),
   and `repository.ts:230-232` would default to it anyway — writing it is what makes that a fact
   rather than a fallback. `safePersist`'s `status` parameter widens from `'partial' | 'degraded'`
   to include `'failed'`; it already swallows its own persistence failure, which is exactly what
   "stamp before re-throwing" needs.
2. **Carry the previous row's facts forward rather than zeroing them.** `upsertIndexState` writes
   every column, so stamping zeros would erase `lastIndexedSha` — and that sha is what
   `blast/service.ts:100-113` uses as `linkSha` for every line number it renders. A failed re-index
   must cost the *status*, never the record of what the last good pass saw.
3. **Fix the comment at `full.ts:64-70`** so it describes what the code now does. A comment that
   describes behaviour which does not exist is worse than none — the next reader relies on it, and
   this one hid a dead branch for the whole life of the module.
4. `runIncremental` is **not** changed here, and that is a named gap, not an oversight: it delegates
   to `runFullIndex` for a missing state row, an indexer-version mismatch and an over-threshold diff
   (`incremental.ts:1-12`), so the common crash paths already land in the catch above. A crash
   inside the slice path still leaves the previous row; if measurement shows that matters, the same
   catch goes there.

**The consequence, named because it reaches a neighbouring feature.** A repo whose re-index crashes
now reports `failed` where it previously reported its last good status. `blast` already has a
branch for exactly that (`blast/helpers.ts:128-132`, "everything else — `degraded`, `failed` …"),
so it degrades with a reason instead of serving an answer built on a state nobody re-verified; and
this feature refuses with `index_failed`, which is precisely the reader action AC-83 names —
"look at why, and retry". Both are honest states, and neither existed before because the row was
never written.

Check: `test/indexer-pipeline.test.ts` gains a case that forces a throw mid-run (the in-memory
`makeRepoStub` at `:39` already gives the seam — make one persistence method reject) and asserts
three things: the error still propagates, `upsertIndexState` was called with `status: 'failed'`,
and the previous `lastIndexedSha` / `filesIndexed` survived. The existing file is reused rather
than duplicated because its stub and tmpdir fixture are 60 lines that would otherwise be copied;
slice A touches no repo-intel test, so the file is uncontested.

**P1.10 — the tests.** See § Tests for what each file must prove.

---

**Dispatch order (across plans, for the coordinator).**

1. **Plan 12 (slice A) lands `OnboardingDraft` in `knowledge.ts` (both copies) and
   `generate-executor.ts`** — P1.1 extends that schema and P1.6 names that class. Until it does,
   P1.1 does not typecheck, and that is the correct order rather than a blocker to work around: a
   stub `OnboardingDraft` written here would be a second declaration of the type the split just
   de-duplicated.
2. **P1.1 alone unblocks slice C**: once `contracts/onboarding-api.ts` exists in
   `client/src/vendor/shared/`, plan 14 can be written and executed against it without waiting for
   the rest of this package.
3. **P1.9 depends on nothing here** — it touches only `repo-intel` and can land first, last, or in
   parallel. It is the one step of this plan that could be dispatched on its own.
4. The remaining P1 steps are a single chain and are executed in order.

---

## Tests

`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` for the unit files;
`cd server && pnpm exec vitest run .it.test` for the integration one. **Integration is in scope** —
routes and a repository are not accepted without it. No e2e (N8).

| File | Kind | Must prove |
|---|---|---|
| `test/onboarding-contract.test.ts` | unit | the split holds mechanically: for every key of `OnboardingDraft.shape`, `OnboardingRecord.shape[key]` is **the same schema object** (nothing was overwritten by `.extend()`); and `OnboardingDraft.shape` carries neither `index_state` nor `generated_at`. Both are the failure that produces a valid schema and no error — the only thing that can report it is this test (R20) |
| `test/onboarding-status.test.ts` | unit | all five rows of the gate table, from hand-built `IndexSnapshot`s including the real `pipeline/full.ts:101-114` shape (`partial`, `filesIndexed: 0`) and a stamped `failed` row from P1.9; both staleness edges — index advanced → `true`, index row gone (`last_indexed_sha: ''`) → `false` (R5, R8, R9) |
| `test/indexer-pipeline.test.ts` | unit | a run that throws mid-way still stamps `status: 'failed'`, still re-throws, and leaves the previous `lastIndexedSha` and `filesIndexed` intact — the write half of AC-83's second reason (R8, P1.9) |
| `test/onboarding-service.test.ts` | unit | with a fake repository and a **counting** fake generator (`{ run: async () => draft }` — one method, two arguments, no `index`): reading calls `run` zero times (R1); each of the three refusals throws its own code and the count stays 0 (R8); two concurrent `generate` calls produce **one** `run` and two identical records (R11); a `run` that throws leaves `upsert` uncalled (R7); `ConfigError` propagates as itself while any other error arrives as `ExternalServiceError` (R14); a `partial` index generates (R16) |
| `test/onboarding-routes.test.ts` | unit | `container.onboardingService === container.onboardingService`, and that `overrides.onboarding` actually answers the route — the two halves `server/INSIGHTS.md:857-877` says a memoisation bug hides behind (R11) |
| `test/onboarding.it.test.ts` | integration | against testcontainers Postgres and a canned `overrides.onboardingGenerator` returning a fixture **draft**: GET for an unknown id and for a repo in another workspace return the **identical** 404 body (R2); GET with nothing saved returns `tour: null` and the generator is untouched (R15); POST writes one row, GET then returns it with zero generator calls (R1, R6); a second POST replaces it — `select count(*) … where repo_id = …` is still 1 and the old text is gone (R6); the stored record carries `index_state`, `generated_at` and the draft's five numbers unchanged (R3, R12); advancing `repo_index_state.last_indexed_sha` flips `stale` to true and `generate_blocked` stays `null` (R5) |

**Three traps this suite must not walk into**, each already paid for once:

- A rate-limit test must run under `NODE_ENV: 'development'`, because `app.ts:105-107` does not
  register the limiter at all under `test` and the assertion passes vacuously otherwise. It must
  also assert the **generator call count** either side of the 429, not just the status — a limiter
  wired after the spend returns 429 having already paid. `test/brief-rate-limit.it.test.ts:1-33`
  carries both lessons in its header; add the equivalent case to `onboarding.it.test.ts` or a
  sibling `onboarding-rate-limit.it.test.ts` (R10).
- Every integration test builds the app with `overrides.llmFallback` **and**
  `MockSecretsProvider({})`. Overriding the generator already keeps this slice off the network, but
  the defence-in-depth pair is what `server/INSIGHTS.md:1235-1283` requires after live OpenRouter
  calls escaped from a suite that thought it was isolated.
- A local `async` helper must `await buildApp(...)` inside itself; returning `{ app: buildApp() }`
  costs a full testcontainers run to diagnose (`server/INSIGHTS.md:1286-1296`).

---

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`:

```sh
cd server && pnpm arch                                            # depcruise src --config --ignore-known
cd server && pnpm typecheck                                       # tsc --noEmit -p tsconfig.json
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd client && pnpm typecheck                                       # tsc --noEmit
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

Integration is not a Track A gate and is still required by this plan:

```sh
cd server && pnpm exec vitest run .it.test
```

`cd client && pnpm lint` and `cd client && pnpm test` are slice C's; this package touches
`client/src/vendor/shared/` only, which the client typecheck and the vendor diff already cover.

---

## Risks (from INSIGHTS.md)

| Risk | Recorded at | What this plan does |
|---|---|---|
| A service holding instance state constructed by a route holds its lock "by registration count"; `pnpm arch` stays green throughout | `server/INSIGHTS.md:857-877` | P1.6 memoises the service on the container; P1.7 only reads it; `onboarding-routes.test.ts` asserts both halves |
| A jsonb column is untyped input — a cast is a promise the type system never checked | `server/INSIGHTS.md:699-718` | P1.4 parses on read with the contract, which is the edge for this value |
| Parse-on-read turns a contract field removed later into a **422 blamed on the caller** | `server/INSIGHTS.md:1341-1361` | P1.1 defaults every count and array; P1.4 degrades a failed parse to `null` + a warning, never an error |
| An integration test made live, paid OpenRouter calls because isolation ran through the failure path | `server/INSIGHTS.md:1235-1283` | P1.10 requires `llmFallback` **and** `MockSecretsProvider({})` in every `*.it.test.ts` here |
| A rate-limit test under `NODE_ENV=test` passes vacuously; asserting the 429 alone still allows spending first | `test/brief-rate-limit.it.test.ts:1-33` | P1.10 names both conditions as required |
| `drizzle-kit generate` cannot be answered from a pipe, and has emitted an unrunnable migration twice | `server/INSIGHTS.md:1066-1078`, `:1102-1140` | Avoided entirely — R20 adds no column, so no migration is generated |
| "In flight" needs its own column when the outcome columns must survive a failure — a job killed mid-run leaves `running` forever | `server/INSIGHTS.md:720-737` | The reason generation stays synchronous (R17): there is no in-flight row to leak, and the previous tour survives by not being touched |
| `app.inject is not a function` in a new `*.it.test.ts` | `server/INSIGHTS.md:1286-1296` | Named in § Tests |

---

## Alternatives rejected

- **New columns on `onboarding`, mirroring `pr_brief`** (`db/schema/reviews.ts:104-160` carries
  fifteen). Rejected: nothing filters, sorts or aggregates on any of them — the table is one row per
  repo read by primary key — so the columns buy no query and cost a `drizzle-kit generate` round
  whose traps are recorded twice in INSIGHTS. The cost of the choice is stated rather than hidden:
  parse-on-read is now load-bearing, which is why P1.1 and P1.4 both carry rules about it.
- **Declaring the record's provenance fields here rather than on `OnboardingDraft`.** Rejected by
  the coordinator's split, and it is the better cut on its own terms: the numbers are produced by
  the generator, so declaring them beside the producer keeps one declaration per type and leaves
  this slice adding only what it alone knows — the index state it gated on and the moment it wrote.
- **Zeroing `lastIndexedSha` when stamping `failed` (P1.9).** Rejected: that sha is what
  `blast/service.ts:100-113` renders every line number against, and losing it would turn a failed
  *re*-index into destroyed provenance for a neighbouring feature. The stamp costs the status and
  keeps the facts.
- **The refusal reason inside `error.details`.** Rejected: `ApiError.code` is already first-class on
  the client (`client/src/lib/api.ts:47-61`) while `details` is `unknown` and would have to be
  parsed and validated a second time.
- **200 with `{ status: 'refused', reason }`.** Rejected: this is a refusal of a paid action, and
  the repository's precedent for a refusal with its own vocabulary is a thrown `AppError` with a
  module-specific code (`modules/context/service.ts:209-238`). A 200 would also make the client
  branch on two body shapes for one route.
- **Letting the client derive the refusal from `index`.** Rejected: it would put this slice's gate
  table in two places, in two languages, and drift is guaranteed the first time the rule changes.
  Hence `generate_blocked` on the read.
- **A single-flight keyed by `${repoId}:${lastIndexedSha}`** (the brief's key shape). Rejected:
  there is one row per repo, so two runs on different shas would race to write the same row; AC-74
  asks for "already running for this repository", and `repoId` is that.
- **Generation through `JobRunner`.** Rejected by the NFR and by the mechanism behind it: the queue
  restores nothing on start, so a restart mid-generation would leave a `running` row forever. The
  price is named — the request holds for up to 180 s.
- **Auto-generating on an empty read** (what `SPEC-02` does for the brief). Rejected by D9 and D22:
  the tour is opened once per person and each open would spend workspace money.

---

## Verification

Each line names the `R#` it proves. The last is one end-to-end run through the real entry point.

1. `cd server && pnpm arch && pnpm typecheck` — the module sits in the right rings and imports no
   sibling slice. (R20, and the `no-cross-module` constraint.)
2. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — the four new unit files and the
   extended `indexer-pipeline.test.ts` green. (R1, R5, R7, R8, R9, R11, R14, R16, R20.)
3. `cd server && pnpm exec vitest run .it.test` — the integration file green, including the two
   404s being byte-identical. (R2, R3, R6, R12, R15.)
4. `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing, and
   `cd client && pnpm typecheck` passes with the new contract file. (R20.)
5. `grep -rn "container.jobs" server/src/modules/onboarding` returns nothing. (R17.)
6. `grep -rn "locale\|language" server/src/modules/onboarding/{routes,service}.ts` returns nothing.
   (R19.)
7. **End to end, against a running app** (`./scripts/dev.sh`, a repo that is imported and indexed):
   - `curl -s localhost:3001/repos/<id>/onboarding | jq '{tour, stale, generate_blocked}'` →
     `tour: null`, `generate_blocked: null`, and the server log shows no model call. (R1, R15.)
   - `curl -sX POST localhost:3001/repos/<id>/onboarding/generate | jq '{index_state, attempts,
     tokens_in, cost_usd, dropped}'` → the index state, the five numbers, the five counters; the
     log line `onboarding generation` carries the same counters. (R3, R12, R13.)
   - the same GET again → the record, byte-for-byte, with no model call in the log. (R1, R6.)
   - `curl -s localhost:3001/repos/<other-workspace-repo-id>/onboarding` and
     `curl -s localhost:3001/repos/00000000-0000-0000-0000-000000000000/onboarding` → identical
     404 bodies. (R2.)
   - against a repo with no index: `curl -sX POST … | jq .error.code` →
     `onboarding_index_missing`, and no model call in the log. Against a Python or Go repo that has
     been indexed: `onboarding_language_unsupported`. (R8, R9.)
   - **the third reason, end to end** (P1.9): set `status='failed'` on that repo's
     `repo_index_state` row the way P1.9's catch now does —
     `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "update repo_index_state set
     status='failed' where repo_id='<id>'"` (the role is `devdigest`, not `postgres` —
     `server/INSIGHTS.md:1358-1361`) — then `curl -sX POST … | jq .error.code` →
     `onboarding_index_failed`, and `GET` reports `generate_blocked: "index_failed"` with the
     previous tour still served. Three reasons, three codes, all reachable. (R8.)
   - two `POST`s fired within the same second (`&` in one shell line) → one `onboarding generation`
     log line, two identical bodies. (R11.)

## Open questions

_None._

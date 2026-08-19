# 12 — Onboarding Tour, slice A: the server generation pipeline

**Status:** Planned 2026-08-17
**Scope:** server · client (the vendored contract mirror only)
**Modules touched:** `server/src/vendor/shared/contracts/knowledge.ts`, `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/**` (mirror), `server/src/adapters/git`, `server/src/adapters/mocks.ts`, `server/src/modules/onboarding` (generation files only), `server/src/prompts/onboarding.system.md`, `server/test`
**Requirements source:** `specs/SPEC-03-onboarding-tour.md` (approved 2026-08-17, 94 criteria)
**Execution:** multi-agent
**Sibling plans:** `plans/13-…-server-api.md` (slice B — table, migration, repository, routes, module registration, cache, refusal states, the service's public entry points) and `plans/14-…-client.md` (slice C — everything under `client/` except the vendored contract mirror, which is **this** plan's).

This plan owns the inside of one generation: from the inputs the model is allowed to see to a
**verified object** handed back to slice B. It writes no route, no table and no screen.

## Requirements as understood

`R#` follows the spec's `AC` numbers in ascending order. Every criterion this plan does **not**
serve is listed by number under `## Out of scope`, with the slice that owns it.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | Architecture prose leans on the repo skeleton from the index and names **this** repository's paths, not paths typical of the stack. | `§ AC-10` | clear |
| R2 | Critical-path flows are ordered file lists assembled **from `getCriticalPaths` chains** — a step outside the chains shown to the model is not a flow step. | `§ AC-14`, D13 | clear |
| R3 | A critical-path row whose path fails the existence check never reaches the record. | `§ AC-17` | clear |
| R4 | Environment variables are named only when they appear in a config file this run actually read. | `§ AC-21` | clear |
| R5 | A command naming a script absent from the `package.json` of **the package whose block it is in** is dropped and counted. | `§ AC-23`, D18 | clear |
| R6 | The package manager in a block's commands is the one the lock file **beside that package's** `package.json` dictates. | `§ AC-25`, D18 | clear |
| R7 | The first reading-path item is a file that is in the critical-path chains or in the top-ranked set. | `§ AC-28` | clear |
| R8 | Task complexity is a closed enum of exactly three values in the contract. | `§ AC-31`, D10 | clear |
| R9 | A complexity value outside the three rejects **the task**; it is never normalised and never defaulted. | `§ AC-32` | clear |
| R10 | A task whose path fails the existence check is dropped and counted. | `§ AC-34` | clear |
| R11 | Every path that reaches the record — section link, flow step, reading item, task — corresponds to a file that exists in the clone. | `§ AC-37`, D4 | clear |
| R12 | A path that does not exist is dropped entirely and counted. | `§ AC-38` | clear |
| R13 | Each generation records how many claims were dropped, by five separate reasons: unknown path, unknown script, manager mismatch, unknown complexity, section outside the list. | `§ AC-40` | clear |
| R14 | A path that is absolute, carries `..`, carries a control character, or names `.git/` is rejected **before** any existence check and never becomes a link. | `§ AC-41` | clear |
| R15 | A section whose `kind` is outside the closed five is rejected, not shown sixth. | `§ AC-42`, D11 | clear |
| R16 | The tour's prose carries no quantitative claim about the repository. | `§ AC-43`, D7, D21 | clear |
| R17 | Exactly **one** structured model call per generation, for all five sections. | `§ AC-45`, D3 | clear |
| R18 | The assembled input is counted against the named budget with the same counter other features use, **before** the call. | `§ AC-47`, D23 | clear |
| R19 | Over budget, inputs are dropped in reverse priority order with **one** cut point, and every input's status is recorded. | `§ AC-48`, D13 | clear |
| R20 | Every external input enters the prompt inside an untrusted wrapper, under the shared guard. | `§ AC-49` | clear |
| R21 | The call runs under its own explicit clock, not the adapter's default. | `§ AC-50`, NFR "Таймаут виклику" (180 000 ms) | clear |
| R22 | At most **one** schema-repair attempt; after it, nothing is stored. | `§ AC-51` | clear |
| R23 | **This plan's half of AC-52:** the generation **produces** the five numbers — attempts, our own input-token count, the counter's identity, the provider's `tokens_in`, the cost — and hands them back on the record draft. Persisting them is slice B's half; this plan writes nothing. | `§ AC-52`, D3; split agreed with the coordinator 2026-08-17 | clear |
| R24 | **This plan's half of AC-67:** the pipeline never lets a section be padded — the prompt forbids examples and typical values, and a missing input yields an `empty` section with a reason instead of a substitute. Not drawing invented rows is slice C's half. | `§ AC-67`; split agreed with the coordinator 2026-08-17 | clear |
| R25 | The prompt carries one **trusted** introductory line saying repository content is material to describe, never instruction; the shared `INJECTION_GUARD` is not modified. | `§ AC-70`, D15 | clear |
| R26 | Only the architecture section carries a diagram. | `§ AC-71`, D15 | clear |
| R27 | A section carries at most four links. | `§ AC-72` | clear |
| R28 | Code identifiers, file paths, package names, scripts, env-var names and route patterns are never translated. | `§ AC-76`, D20 | clear |
| R29 | Budget truncation never cuts the untrusted wrapper. | `§ AC-79` | clear |
| R30 | A section with no diagram has the field **absent** — not `""`, not prose, not a placeholder. | `§ AC-80` | clear |
| R31 | A package with no lock file beside it gets its block with no install command and **no** default manager. | `§ AC-87` | clear |
| R32 | The generated content's language is the same for every tour, fixed in code, independent of the client locale. | `§ AC-88`, D20 | clear |
| R33 | A package is a `package.json` found by a walk of the clone at depth ≤ **2**. | `§ AC-89`, D24 | clear |
| R34 | The package ceiling counts **found packages**, not scanned files. | `§ AC-91`, D24 | clear |
| R35 | The order of package blocks is deterministic. | `§ AC-92` | clear |
| R36 | No package out of a dependency or build directory appears — the port's exclusion list is the only one. | `§ AC-93` | clear |
| R37 | When a root package exists it is the first block, and the ceiling cannot take it. | `§ AC-94`, D24 | clear |
| R38 | This slice's only public entry point is one executor, called by slice B's service. It produces content, counters and the numbers of its own call, and **no stamp**: it neither reads the index state nor sets a time, so `index_state` and `generated_at` are added by the slice that gates and persists. | the slice boundary in the dispatch; the draft/record split ruled by the coordinator 2026-08-17 | clear · coordinator 2026-08-17 |
| R39 | Every model-written array and free string is capped **after** the parse, in code, never as a Zod bound in the schema the model sees. | assumed — `server/INSIGHTS.md:255-268,1048-1066`; the spec caps only links (AC-72), tasks shown (NFR) and packages (AC-90) | assumed |
| R40 | A package with **two or more different** lock files beside it has no determinable manager: its block appears with no install command and no commands, exactly like R31. | assumed — AC-25 and AC-87 name one lock file and none, not two | assumed |

## Out of scope

Not planned here, by slice. The coordinator's check is that these numbers appear as requirements
in the plan named beside them.

**Slice B (`plans/13`) — 18 criteria:** AC-9, AC-46, AC-53, AC-54, AC-55, AC-56, AC-57, AC-58,
AC-59, AC-60, AC-61, AC-62, AC-63, AC-64, AC-73, AC-74, AC-83, AC-84.
What this plan hands B for them: the executor returns an `OnboardingDraft` carrying every audit
number and every number of the call, and **no stamp** — B extends it with `generated_at` and
`index_state`, which is what makes AC-54 B's by construction and the `.extend()` collision-free;
a `ConfigError` from the model resolution propagates out of the executor **unflattened** (AC-53);
the executor makes no call of any kind when it is not called (AC-46, AC-62); it is not
concurrency-safe by itself — the single-flight is B's (AC-74). This plan's contract file declares
**neither** the refusal vocabulary (`index_missing` / `index_failed` / `language_unsupported`)
**nor** the index-state shape and its status enum: both are B's by the coordinator's dictionary,
and this pipeline neither refuses nor reads the index state. For AC-73's detection,
`container.git.listFiles(repo, { roots: ['.'], extensions: [...SUPPORTED_EXT], names: [], maxFiles: 1, maxFileBytes: … })`
answers "does this repo contain any file the indexer parses" with the port as it stands after P2.

**Slice C (`plans/14`) — 39 criteria:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-11,
AC-12, AC-13, AC-15, AC-16, AC-18, AC-19, AC-20, AC-22, AC-24, AC-26, AC-27, AC-29, AC-30, AC-33,
AC-35, AC-36, AC-39, AC-44, AC-65, AC-66, AC-68, AC-69, AC-75, AC-77, AC-78, AC-81, AC-82, AC-85,
AC-86, AC-90.
What this plan hands C for them, by field of the `OnboardingDraft` this plan produces — which
slice B extends into the `OnboardingRecord` the route returns: `sections[]` always holds **five**
entries in `OnboardingSectionKind` order, each with `state` and `empty_reason` so an empty section
keeps its place (AC-18, AC-29, AC-35, AC-44, AC-66) without the pipeline ever substituting
top-ranked files for missing chains; `verified_paths[]` per section is the set of paths in that
`body` proven to exist, which is what makes AC-39 decidable at render; `packages[]` carries `name`,
`path`, `manager` and `commands` (AC-19, AC-20); `package_scan` carries `depth`, `excluded_dirs`,
`found`, `shown` and `bounded` (AC-24, AC-90); `tasks[]` carries `title`, `path`, `why`,
`complexity` (AC-30, AC-33); `inputs[]`, `sample_files`, `sample_truncated` (AC-65, AC-86);
`reading_path[]` carries `reason` per item (AC-26). `title` from the model is stored and never
meant for the screen (AC-85) — the docstring says so where C will read it.

Also out of scope here, and not a criterion anyone owns: any table, migration, route, rate limit or
`modules/index.ts` registration (B); anything under `client/src/app`, `client/src/components`,
`client/messages` (C); `reviewer-core` (read, never changed — D4 and the shared `INJECTION_GUARD`
stay exactly as they are); `e2e/` and `mcp/` (N8); extending the `repo-intel` facade (N7, D21);
re-indexing (N4).

## What already exists

- **The contract socket, empty.** `Onboarding`, `OnboardingSection`, `OnboardingLink` —
  `server/src/vendor/shared/contracts/knowledge.ts:28-47`. Grepped 2026-08-17: **zero** consumers
  outside the two vendored copies, so reshaping them breaks nothing. `vendor/shared/index.ts:28`
  re-exports the file with `export *`, so new names reach `@devdigest/shared` with no barrel edit.
- **The system prompt, written and never called.** `server/src/prompts/onboarding.system.md`,
  45 lines, `{{sections}}` and `{{language}}`. It names `routes_and_apis` twice (`:7-8`, `:23-26`)
  as a section allowed a diagram — the dead instruction D11 requires removed.
- **The model registry entry.** `FeatureModelId` `onboarding`, default `openrouter` /
  `deepseek/deepseek-v4-flash` (`contracts/platform.ts:44-50`), reached with
  `resolveFeatureModel(container, workspaceId, 'onboarding')` (`modules/_shared/feature-models.ts:70`).
- **The nearest complete analogue.** `modules/conventions` — one cheap call, config files read
  first, samples from the rank, verification against the clone afterwards, dropped-claim counters,
  the audit line in the route (`conventions/{constants,prompt,service,helpers,routes}.ts`).
- **The budget walk.** `selectWithinBudget` / `truncateToBudget` in
  `server/src/modules/_shared/budget.ts` — one cut point, first-oversized-included-truncated,
  `count` as a parameter.
- **Path string rules.** `sanitizeRelativePath(raw, maxLength)` and `truncateCodePoints` —
  `server/src/modules/_shared/repo-paths.ts:44-71`. It already refuses absolute, `..`, control
  characters and any `.git` segment, case-folded. **R14 is this function plus the port**; a second
  copy is the drift that file exists to record.
- **Untrusted fencing.** `wrapUntrusted` / `escapeUntrusted` via `platform/prompt.js`
  (re-exported from `reviewer-core/src/prompt.ts:75-82`).
- **The repair loop and its metrics.** `parseWithRepair` (`reviewer-core/src/llm/structured.ts:54`)
  behind `LLMProvider.completeStructured`, whose `StructuredResult` already returns `attempts`,
  `tokensIn`, `tokensOut`, `costUsd`, `model` (`vendor/shared/adapters.ts:83-91`).
- **The facade reads this feature was built for.** `getIndexState`, `getRepoMap(repoId, budget)`,
  `getCriticalPaths(repoId)` → `string[][]`, `getTopFilesByRank(repoId, n, { exclude })`
  (`modules/repo-intel/types.ts:180-219`, implemented `service.ts:670-712`), all with **no**
  consumer for the last two.
- **The walk, two capabilities short.** `GitClient.listFiles`
  (`vendor/shared/adapters.ts:303-327`, `adapters/git/simple-git.ts:430-484`) already excludes
  `node_modules`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`, `.git`
  (`adapters/git/constants.ts:15-24`), refuses symlinks and a root that escapes the clone, sorts,
  and reports `bounded`. It filters by **`extname`** (`simple-git.ts:484`) and has **no depth
  parameter**. Nothing else in the repository walks a clone from a module.
- **Nothing at all** under `server/src/modules/onboarding/`.

## Constraints

| Rule | Where it is mandated |
|---|---|
| A service or `*-executor` may not import `node:fs` and may not import a concrete adapter; every external call goes through a port off the container. | `.dependency-cruiser.cjs` `no-fs-in-service`, `no-service-to-adapter-impl`; `onion-architecture` §3.4 — "A port is not finished until `adapters/mocks.ts` has an implementation of it" |
| `modules/onboarding/**` may not import `modules/repo-intel/**` — `import type` included (`tsPreCompilationDeps: true`). The facade arrives through `container.repoIntel`, its types restated structurally. | `no-cross-module`; precedent `modules/brief/types.ts:36-52` |
| `vendor/shared/**` may import only `zod` and itself — so the index-status enum is **restated** in `knowledge.ts`, never imported from `repo-intel/types.ts`. | `contracts-stay-pure` |
| Both vendored copies must stay byte-identical; the server copy is the source of truth. | `AGENTS.md:89-93`; gate `repo · vendor` |
| Bounds (`maxItems`, `minimum`, `maximum`) must not appear in the schema handed to the model — Anthropic's structured-output API rejects them. Cap after the parse. | `server/INSIGHTS.md:1048-1066`; `conventions/prompt.ts:18-25` |
| Anything that transforms text after the count is part of the count: a fence, an escape, a separator. Escape once, before the budget walk measures. | `server/INSIGHTS.md:288-320` |
| The tokenizer degrades to `ceil(chars/4)` silently and irreversibly; a feature that must hold a bound records **which** counter answered. | `adapters/tokenizer/index.ts:20-41`; `server/INSIGHTS.md:1140-1160` |
| `GitClient.readFile` requires a byte bound; a cap applied to the returned string runs one step too late. | `vendor/shared/adapters.ts:291-301` |
| Secrets reach code only through `SecretsProvider`, i.e. only through `container.llm(provider)`. | `AGENTS.md`; `onion-architecture` §3.7 |
| A closed taxonomy is enforced by rejecting what falls outside it, not by normalising it. | `contracts/knowledge.ts:152-170` (`ConventionCategory`); zod skill `schema-use-enums` — "plain strings accept any value including typos" |
| `.optional()` and `.nullable()` are different claims: absent versus present-and-null. R30 turns on this. | zod skill `object-optional-vs-nullable` |
| Generated content is stored and re-served on every open, so it is sanitised on the way **in**, not only on the way out; nothing generated is ever executed. | `security` skill, A05 and ASI05/ASI09 — "sanitize AI output before storing", "never execute AI-generated code" |

## Recommendations

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Emit `cp .env.example .env` as a **code-authored** command when that file exists beside a package — the mockup shows it, and after this plan the run section carries package-manager commands only. | Yes — one more command kind in `packages[]`, authored by code rather than the model, so it needs no grounding. | ~20 lines in the package builder plus a test; no contract change |
| 2 | Give the repository one `TokenizerId` contract enum instead of `RiskBriefTokenizer` plus the copy this plan adds. | No — this plan defines its own and names the duplication. | A rename across `contracts/brief.ts`, the brief record, the client re-export, and one migration-free jsonb read |
| 3 | Enforce R16 harder: when the prose-quantity counter is non-zero, spend the one repair attempt on a re-ask instead of on schema repair. | Yes — changes the call loop, and it competes with R22's single repair. | Non-trivial; and the measurement to justify it does not exist yet |
| 4 | Read `packageManager` from `package.json` (corepack) as a second source for R6. | Yes — a second manager source that can disagree with the lock file. | Small, but AC-25 measures against the lock file, so the disagreement rule would be a new decision |

The steps below are written to the requirements as they stand, not to these.

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| P1 all steps, P4.2 | `zod` | Closed enums, `optional` vs `nullable` (R30), and why the model's schema and the stored contract are different objects |
| P2 all steps | `onion-architecture` | A port change plus its mock: §3.4 and the `no-adapter-to-module` rule the exclusion list already lives under |
| P3, P5 all steps | `onion-architecture` | Executor placement, the structural container port, `no-fs-in-service`, `no-cross-module` |
| P4.1, P4.3, P5.3 | `security` | Untrusted model output stored and re-served, path traversal, and a shell command copied off the screen |

`fastify-best-practices`, `drizzle-orm-patterns` and `postgresql-table-design` are **not** needed
here: this plan writes no route and no SQL. They belong to slice B.

## The canonical vocabulary

**Coordinator's decision of 2026-08-17, not a proposal, and identical in `plans/13` and
`plans/14`.** Rename nothing in this table — not the keys, not the members, not the case — and do
not add a synonym beside one.

| Thing | Owner | Canonical name and members |
|---|---|---|
| Package blocks | this plan | `packages` — the array of blocks in P1's contract |
| Walk facts | this plan | `package_scan`: `found`, `shown`, `depth`, `excluded_dirs` (`bounded` beside them, this plan's addition) |
| Dropped-claim counters | this plan | `unknown_path`, `unknown_script`, `manager_mismatch`, `unknown_complexity`, `unknown_section` |
| Input ids | this plan | `repo_map`, `package_configs`, `critical_paths`, `file_samples`, `project_docs` |
| Refusal reasons | **slice B** | `index_missing`, `index_failed`, `language_unsupported` — declared by B, never here |
| Index provenance | **slice B** | `index_state`, its shape and its status enum — declared by B, never here |
| Content + counters + call numbers, **no stamp** | this plan | `OnboardingDraft` in `contracts/knowledge.ts` |
| The stored record | **slice B** | `OnboardingRecord = OnboardingDraft.extend({ generated_at, index_state })` in `contracts/onboarding-api.ts` |

**Case: `snake_case` for every key above**, in the contract and in the internal shapes that carry
it — the repository's contracts hold 309 snake keys against 14 camel, so camel is the exception, not
the local style. Internal fields that are *not* in this table (`repoMap`, `knownPaths`, `envSources`
on `OnboardingSources`) stay camelCase like any other TypeScript field.

**Why this is not cosmetic.** Slice B builds its record with `.extend()`, and Zod's `.extend()`
**overwrites** on a key collision. B's first draft put its walk-facts object under `packages` —
which would have silently replaced this plan's array of blocks, and the whole "How to run" section
would have vanished from the stored record. Nothing catches that: each package compiles against its
own vendored copy, and the client does not validate the response. It was found by comparing three
independently written plans, which is the only reason it is a paragraph here and not an incident
later.

**Where this plan can still break itself:** P1 declares these names, and P3, P4 and P5 consume them
from four separate cold contexts. A package that invents `packagesFound` or `droppedPaths` locally
compiles fine and diverges silently, so the names above are the ones the tests assert on.

**The second collision — two declarations of one record — was ruled on 2026-08-17, and the split
is by stamp.** This plan declares `OnboardingDraft` in `contracts/knowledge.ts`: content, the five
dropped counters, `package_scan`, the input statuses and the call's own numbers. Slice B declares
`OnboardingRecord = OnboardingDraft.extend({ generated_at, index_state })` in
`contracts/onboarding-api.ts`. One declaration each, one owner each, no shared file — and the
`.extend()` cannot collide **by construction rather than by agreement**, because the draft owns
neither key. The line falls where AC-52 already fell: the pipeline produces what it computed, and
the slice that gates and persists stamps when and against what.

## Work packages

Five packages. `modules/onboarding/` is shared with slice B — B owns `service.ts`,
`repository.ts`, `routes.ts` and `types.ts`; this plan owns the files named below and **no
others in that folder**. Nothing here is added to `modules/index.ts`; that is B's.

### P1 — The contract, the constants, the mirror

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/knowledge.ts`
- `client/src/vendor/shared/contracts/knowledge.ts`
- `server/src/modules/onboarding/constants.ts` (new)
- `server/src/modules/onboarding/generation-types.ts` (new)
- `server/test/contracts.test.ts`

**Contract** — what P2…P5, and slices B and C, may assume once this lands. Written into
`contracts/knowledge.ts` in place of today's three declarations, keeping those three names:

```ts
export const OnboardingSectionKind = z.enum([
  'architecture', 'critical_paths', 'how_to_run', 'reading_path', 'first_tasks',
]);                                  // order IS the page order (AC-1)
export const OnboardingSectionState = z.enum(['ready', 'empty']);
export const OnboardingEmptyReason = z.enum([
  'no_import_graph', 'no_ranked_files', 'no_packages', 'no_tasks', 'model_returned_nothing',
]);
export const OnboardingLink = z.object({ label: z.string(), path: z.string() });
export const OnboardingSection = z.object({
  kind: OnboardingSectionKind,
  title: z.string(),                       // the model's; NOT rendered — AC-85
  body: z.string(),                        // markdown, untrusted
  diagram: z.string().optional(),          // mermaid; architecture only; ABSENT when none (R30)
  links: z.array(OnboardingLink),          // ≤ 4, every path verified
  verified_paths: z.array(z.string()),     // paths inside `body` proven to exist — AC-39
  state: OnboardingSectionState,
  empty_reason: OnboardingEmptyReason.nullable(),
});
export const OnboardingFlow = z.object({
  title: z.string(),
  steps: z.array(z.object({ path: z.string(), note: z.string() })),
});
export const OnboardingReadingStep = z.object({ path: z.string(), reason: z.string() });
export const OnboardingTaskComplexity = z.enum(['low', 'medium', 'high']);
export const OnboardingTask = z.object({
  title: z.string(), path: z.string(), why: z.string(), complexity: OnboardingTaskComplexity,
});
export const OnboardingPackageManager = z.enum(['npm', 'pnpm', 'yarn', 'bun']);
export const OnboardingCommand = z.object({
  script: z.string(), command: z.string(), why: z.string(),
});
export const OnboardingPackageBlock = z.object({
  name: z.string(),                                   // package.json "name", else the directory
  path: z.string(),                                   // repo-relative dir; '.' for the root package
  manager: OnboardingPackageManager.nullable(),       // null = no single lock file (R31, R40)
  install_command: z.string().nullable(),
  commands: z.array(OnboardingCommand),
});
export const OnboardingEnvVar = z.object({ name: z.string(), source_path: z.string() });
export const OnboardingPackageScan = z.object({
  depth: z.number().int(), excluded_dirs: z.array(z.string()),
  found: z.number().int(), shown: z.number().int(), bounded: z.boolean(),
});
export const OnboardingDropped = z.object({          // exactly the five reasons of AC-40
  unknown_path: z.number().int(), unknown_script: z.number().int(),
  manager_mismatch: z.number().int(), unknown_complexity: z.number().int(),
  unknown_section: z.number().int(),
});
export const OnboardingInputId = z.enum([
  'repo_map', 'package_configs', 'critical_paths', 'file_samples', 'project_docs',
]);                                                   // priority order — D13
export const OnboardingInputStatus = z.enum(['included', 'truncated', 'dropped', 'missing']);
export const OnboardingInput = z.object({
  id: OnboardingInputId, status: OnboardingInputStatus,
  tokens: z.number().int(), detail: z.string().nullable(),
});
export const OnboardingTokenizer = z.enum(['cl100k_base', 'heuristic']);
// NO stamp and NO refusal vocabulary here, by the coordinator's ruling of 2026-08-17.
// `index_state` (with its own status enum) and `generated_at` are declared and set by slice B in
// `contracts/onboarding-api.ts`; `index_missing` / `index_failed` / `language_unsupported` are B's
// too. This pipeline neither refuses, nor times, nor reads the index state — it produces content
// and the numbers of its own call, and nothing else.

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),               // always 5, in enum order
  flows: z.array(OnboardingFlow),
  reading_path: z.array(OnboardingReadingStep),
  tasks: z.array(OnboardingTask),
  packages: z.array(OnboardingPackageBlock),
  env_vars: z.array(OnboardingEnvVar),
});
// What the pipeline PRODUCES. No stamp: slice B builds
// `OnboardingRecord = OnboardingDraft.extend({ generated_at, index_state })` in its own file, and
// that `.extend()` is safe by construction rather than by agreement — the draft owns neither key.
export const OnboardingDraft = Onboarding.extend({
  package_scan: OnboardingPackageScan,
  inputs: z.array(OnboardingInput),
  dropped: OnboardingDropped,
  sample_files: z.number().int(),
  sample_truncated: z.boolean(),
  budget: z.number().int(),
  input_tokens_counted: z.number().int(),
  tokenizer: OnboardingTokenizer,
  attempts: z.number().int(),
  tokens_in: z.number().int(),
  provider: z.string(),
  model: z.string(),
  cost_usd: z.number().nullable(),
});
```

**Steps:**

1. Replace the `// ---- Onboarding ----` block of `server/src/vendor/shared/contracts/knowledge.ts`
   with the declarations above, each with `z.infer` type export beside it (the file's existing
   style). Docstrings must carry, at the declaration they belong to: why `kind` and `complexity`
   are closed lists and that anything outside them is **rejected, not normalised**, citing
   `ConventionCategory` above it in the same file (R8, R9, R15); that `diagram` is `.optional()`
   and never `""`, and why (R30); that `title` is stored and never rendered (AC-85, for C); that
   `OnboardingTokenizer` duplicates `RiskBriefTokenizer` deliberately rather than naming another
   feature's type; and — on `OnboardingDraft` itself — that it carries **no stamp on purpose**, so
   slice B's `.extend({ generated_at, index_state })` cannot collide with a key that is already
   there. *Serves R8, R9, R15, R26, R27, R30, R38.*
2. `server/src/modules/onboarding/constants.ts` — every number this slice uses, each with the
   sentence that justifies it and the source it came from:
   `ONBOARDING_FEATURE = 'onboarding'`; `TOUR_LANGUAGE = 'Ukrainian'` (D20, R32 — fixed in code,
   never from a locale, because a locale in the key multiplies the cache); `ONBOARDING_TOKEN_BUDGET
   = 24_000` (NFR, = `conventions/constants.ts:63`); `REPO_MAP_TOKEN_BUDGET = 6_000` (the skeleton's
   share of that budget, passed to `getRepoMap`); `SAMPLE_FILE_COUNT = 20` and `MAX_FILE_CHARS =
   6_000` (D23, and 20 rather than conventions' 12 for the reason D23 gives);
   `MAX_SAMPLE_FILE_BYTES = MAX_FILE_CHARS * 4` (derived, `conventions/constants.ts:29-47`);
   `MIN_FILE_CHARS = 400`; `ONBOARDING_TIMEOUT_MS = 180_000` (NFR — and why not the adapter's
   600 000); `ONBOARDING_MAX_RETRIES = 1` (R22); `PACKAGE_SCAN_DEPTH = 2`, `MAX_PACKAGES = 12`
   (D24), `PACKAGE_SCAN_LIMIT = 64` (**larger than `MAX_PACKAGES` on purpose**: the port slices
   alphabetically, so asking it for exactly 12 could slice away the root package and break R37 —
   the twelve are chosen here, after ordering); `PACKAGE_MANIFEST = 'package.json'`;
   `LOCKFILES = { 'pnpm-lock.yaml': 'pnpm', 'package-lock.json': 'npm', 'yarn.lock': 'yarn',
   'bun.lockb': 'bun' }`; `PACKAGE_CONFIG_FILES = ['.env.example', '.env.sample']`;
   `PROJECT_DOC_PATHS = ['README.md', 'AGENTS.md']`; `PATH_PROBE_BYTES = 1`;
   `MAX_PATH_PROBES = 120`; `MAX_PATH_CHARS = 200`; output caps (R39) `MAX_LINKS_PER_SECTION = 4`
   (AC-72), `MAX_FLOWS = 4`, `MAX_FLOW_STEPS = 6`, `MAX_READING_STEPS = 8`, `MAX_TASKS = 12`
   (NFR shows 6 and reveals the rest, so the store holds more than the screen),
   `MAX_COMMANDS_PER_PACKAGE = 6`, `MAX_ENV_VARS = 12`, `MAX_BODY_CHARS = 6_000`,
   `MAX_DIAGRAM_CHARS = 4_000`, `MAX_LINE_CHARS = 200`. *Serves R17, R18, R19, R21, R22, R27, R32, R33, R34, R37, R39.*
3. `server/src/modules/onboarding/generation-types.ts` — the types this slice's own files share, so
   neither P3 nor P5 has to own a file the other writes, and so slice B's `types.ts` stays B's:
   - `OnboardingGenerationContainer` — **structural**, naming only what is used:
     `readonly git: GitClient`, `readonly prompts: PromptTemplates`,
     `readonly tokenizer: { count(t: string): number; readonly id: OnboardingTokenizer }`,
     `readonly repoIntel: { getRepoMap(id: string, budget?: number): Promise<{ text: string; tokens: number; degraded?: boolean }>; getCriticalPaths(id: string): Promise<string[][]>; getTopFilesByRank(id: string, n: number, opts?: { exclude?: string[] }): Promise<string[]> }`,
     `llm(id: Provider): Promise<LLMProvider>`, and `extends SettingsReader` from
     `modules/_shared/feature-models.js`. It must **not** name `indexRepo`, `refreshIndex` **or
     `getIndexState`**: a port that cannot express indexing cannot accidentally index (N4), and
     after the coordinator's ruling this slice has no business reading the index state at all —
     it neither gates on it nor stamps it (R38). Same reasoning as `modules/brief/types.ts:36-52`,
     which is the file to copy the shape from.
   - `OnboardingRepoRef { id, owner, name, fullName }`,
     `OnboardingLogger { info(o: object, m: string): void; warn(o: object, m: string): void }`,
     `DiscoveredPackage`, `OnboardingSources`, `OnboardingAudit` (the five contract counters plus
     `off_chain`, `unknown_env`, `probes`, and `samples: string[]` for the log line),
     `OnboardingGenerationResult { draft: OnboardingDraft; audit: OnboardingAudit }`.
     There is **no** `OnboardingRecordDraft` and no index snapshot type: the draft is the base
     contract type, not a slice out of a wider one, which is the whole point of the split.
     *Serves R38.*
4. Mirror `knowledge.ts` to `client/src/vendor/shared/contracts/`, then prove it:
   `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing. *Serves the `repo · vendor` gate.*
5. `server/test/contracts.test.ts` — extend with a hand-written `OnboardingDraft` literal that
   round-trips, plus negative cases that must **fail** the parse: `kind: 'routes_and_apis'`,
   `kind: 'gotchas'`, `complexity: 'trivial'`, `manager: 'deno'`, a non-integer counter. Both
   rejected `kind`s are literals from this repository (`onboarding.system.md`,
   `messages/en/onboarding.json:10`), not invented examples — say so in the test name.
   **One more case, and it is the one that keeps the seam safe:** assert that
   `Object.keys(OnboardingDraft.shape)` contains neither `generated_at` nor `index_state`. A
   collision-free `.extend()` on B's side is a property of this shape, and Zod strips unknown keys
   rather than rejecting them, so nothing else in either package would ever say it broke.
   *Serves R8, R9, R15.*

**Check:** `cd server && pnpm typecheck && pnpm exec vitest run contracts` is green,
`cd client && pnpm typecheck` is green, and the `diff -r` prints nothing.

### P2 — The walk learns two things it does not know

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/adapters.ts`
- `client/src/vendor/shared/adapters.ts`
- `server/src/adapters/git/simple-git.ts`
- `server/src/adapters/mocks.ts`
- `server/test/git-list-files.test.ts` (new)

**Contract** — what P3 and P5 may assume once this lands. `listFiles`' options gain two
**optional** members, so every existing call site (`modules/context/scan-executor.ts:53`) is
unchanged and every existing test still passes:

```ts
listFiles(
  repo: RepoRef,
  opts: {
    roots: string[];
    /** Lower-cased, dot-prefixed, e.g. `['.md']`. Matched case-insensitively. */
    extensions: string[];
    /** Exact file NAMES, case-sensitive, e.g. `['package.json']`. A file matches when
     *  its extension is in `extensions` OR its name is in `names`. Absent = extensions only. */
    names?: string[];
    /** Directory depth below each root that is still descended. 0 = the root directory
     *  itself only. Absent = no limit, which is what every caller before this had. */
    maxDepth?: number;
    /** Counts MATCHES, never files visited: the slice happens after the filter. */
    maxFiles: number;
    maxFileBytes: number;
  },
): Promise<{ files: ClonedFile[]; bounded: boolean }>;
```

**Steps:**

1. `vendor/shared/adapters.ts`: add the two options with the doc comments above. The `names`
   comment must say **why** it exists — `package.json` is a name, not an extension, and asking for
   `.json` returns `tsconfig.json`, `package-lock.json` and every fixture in the clone
   (`§ AC-91`, D24). The `maxFiles` comment must say that the slice is applied **after** the filter,
   because that sentence is the whole of R34. *Serves R33, R34.*
2. `adapters/git/simple-git.ts`: thread `names` and `maxDepth` through `listFiles` into `walkDocs`.
   The name set is built as-is (case-sensitive: `Package.json` is not `package.json` to npm); the
   match becomes `names.has(entry.name) || extensions.has(extname(entry.name).toLowerCase())`, so a
   caller passing `extensions: []` and `names: ['package.json']` gets exactly the manifests.
   `maxDepth` is a counter carried down the recursion and compared **before** descending, so a
   depth of 2 descends `a/b/` and stops; the file at `a/b/c/package.json` is never seen. Do not
   touch the symlink refusal, the `.git` refusal, the `EXCLUDED_SET` skip or the sort — R36 is
   those lines continuing to exist, not a new list. *Serves R33, R34, R36.*
3. `adapters/mocks.ts`: `MockGitClient.listFiles` honours both new options over its `tree`, with
   depth computed from the posix path. A mock that ignores `maxDepth` is how a depth bug passes
   every unit test — the file's own comments already make this argument for `maxFileBytes`.
   *Serves R33.*
4. `server/test/git-list-files.test.ts` — against `SimpleGitClient` over a temp clone (the shape
   `git-read-containment.test.ts` already uses), with cases: `names: ['package.json']` returns the
   manifests and **not** `tsconfig.json` or `package-lock.json`; `maxDepth: 2` finds
   `a/b/package.json` and not `a/b/c/package.json`; a manifest under `node_modules/` and one under
   `vendor/` are absent; **40 packages with `maxFiles: 12` returns 12 packages and `bounded` true**
   — the case that fails if the slice ever moves before the filter (R34); and the reverse control,
   `extensions: ['.json']` with `maxFiles: 12` over a clone whose first 12 `.json` files
   alphabetically are not manifests, asserted to show why the module does not do it that way.
   *Serves R33, R34, R36.*
5. Mirror `adapters.ts` to `client/src/vendor/shared/`; `diff -r` prints nothing.

**Check:** `cd server && pnpm arch && pnpm typecheck && pnpm exec vitest run git-list-files` and
`cd server && pnpm exec vitest run context-scan` (the existing caller, unchanged).

### P3 — What the model is allowed to see

**Agent:** implementer · **Depends on:** P1, P2

**Owns:**
- `server/src/modules/onboarding/packages.ts` (new, pure)
- `server/src/modules/onboarding/gather-executor.ts` (new)
- `server/test/onboarding-packages.test.ts` (new)
- `server/test/onboarding-gather.test.ts` (new)

**Contract** — what P5 may assume:
`new OnboardingGatherExecutor(container).gather(repo: OnboardingRepoRef): Promise<OnboardingSources>`,
where `OnboardingSources` carries `repoMap: { text, tokens }`, `chains: string[][]`,
`ranked: string[]`, `packages: DiscoveredPackage[]`, `package_scan: OnboardingPackageScan`,
`envSources: { path: string; text: string }[]`, `samples: { path, text }[]`,
`docs: { path, text }[]`, and `knownPaths: Set<string>` (everything read or listed, which is
already proven to exist). `DiscoveredPackage` is
`{ name, path, manager: OnboardingPackageManager | null, scripts: string[], lockfiles: string[] }`.
The file name ends in `-executor` deliberately: that is the suffix
`.dependency-cruiser.cjs` matches for `no-fs-in-service` and `no-service-to-adapter-impl`, so the
rules that forbid `node:fs` and a concrete adapter apply to this file too.

**Steps:**

1. `packages.ts`, pure — no port, no I/O, everything by parameter:
   - `orderPackages(paths: string[]): string[]` — the root (`.`) first when present, then the rest
     by posix path, ascending. Deterministic by construction (R35, R37).
   - `selectPackages(paths, max)` → `{ shown, found }`, cutting **after** the order, so the root
     survives a full ceiling (R37) and the overflow count is `found - shown.length` (the number C
     shows for AC-90).
   - `managerFor(lockfileNames: string[]): OnboardingPackageManager | null` — exactly one known
     lock file gives its manager; **none gives `null`** (R31); **two or more different ones give
     `null` too** (R40), because either answer would be a guess and this section's output is copied
     and executed. The docstring says that, and names `AGENTS.md:32` ("Do not mix") as the reason
     the wrong answer is not cosmetic.
   - `parseManifest(json: string): { name?: string; scripts: string[] }` — `JSON.parse` inside
     `try`, a malformed manifest yielding no scripts rather than throwing (a public repo decides
     what is in its `package.json`).
   *Serves R31, R33, R35, R37, R40.*
2. `gather-executor.ts` — every read through a port, in this order:
   a. `container.repoIntel.getRepoMap(repo.id, REPO_MAP_TOKEN_BUDGET)`;
   b. **package discovery**: `container.git.listFiles(repo, { roots: ['.'], extensions: [],
      names: [PACKAGE_MANIFEST], maxDepth: PACKAGE_SCAN_DEPTH, maxFiles: PACKAGE_SCAN_LIMIT,
      maxFileBytes: MAX_SAMPLE_FILE_BYTES })`, then `orderPackages` → `selectPackages(…,
      MAX_PACKAGES)`; for each shown package read its manifest with `readFile`, and probe each
      name in `LOCKFILES` beside it with `readFile(path, PATH_PROBE_BYTES)` (present = resolved,
      any throw = absent). `package_scan` records `depth`, `excluded_dirs` (the port's list, quoted
      from `adapters/git/constants.ts` through a local constant — **do not** import the adapter),
      `found`, `shown`, `bounded`;
   c. `container.repoIntel.getCriticalPaths(repo.id)`;
   d. `container.repoIntel.getTopFilesByRank(repo.id, SAMPLE_FILE_COUNT)`, then `readFile` each at
      `MAX_SAMPLE_FILE_BYTES`, skipping anything under `MIN_FILE_CHARS`;
   e. `PACKAGE_CONFIG_FILES` beside each shown package, and `PROJECT_DOC_PATHS` at the root, each
      through `readFile`, missing ones simply absent.
   Every read is `.catch(() => null)` — a missing file is the normal case, exactly as
   `ConventionsService.readMany` treats it. `knownPaths` collects every path that a read or the
   walk returned successfully. *Serves R2, R4, R5, R6, R33, R36.*
3. `onboarding-packages.test.ts` (pure): the DevDigest layout itself — root plus `server`,
   `client`, `reviewer-core`, `e2e`, `mcp` — comes back root-first with pnpm for two and npm for
   three; 40 packages with a ceiling of 12 yield 12 shown, `found` 40, and the root among them;
   a package with `pnpm-lock.yaml` **and** `package-lock.json` yields `null`; a package with none
   yields `null`; two runs over a shuffled input yield the same order. *Serves R35, R37, R40, R31.*
4. `onboarding-gather.test.ts` with `MockGitClient` + a stub facade: a clone whose `.json` files
   are mostly fixtures still finds every manifest; a manifest at depth 3 is absent; nothing under
   `node_modules/` appears; a repo with **no** manifest yields `packages: []` and
   `package_scan.found === 0` **without** throwing (the AC-24 state C renders). *Serves R33, R34, R36.*

**Check:** `cd server && pnpm arch && pnpm exec vitest run onboarding-packages onboarding-gather`.

### P4 — What we ask for, and what we accept back

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `server/src/prompts/onboarding.system.md`
- `server/src/modules/onboarding/prompt.ts` (new)
- `server/src/modules/onboarding/helpers.ts` (new, pure)
- `server/test/onboarding-prompt.test.ts` (new)
- `server/test/onboarding-grounding.test.ts` (new)

**Contract** — what P5 may assume:
`SECTION_SPEC` (the `{{sections}}` argument), `ONBOARDING_SCHEMA_NAME`, `OnboardingResponse` (the
Zod schema handed to the model), `buildUserMessage(parts): string`, and the pure grounding entry
point
`groundOnboarding(response, ctx): { tour: Onboarding; dropped: OnboardingDropped; extra: { off_chain: number; unknown_env: number } }`,
where `ctx` is `{ verified: Set<string>; chainPaths: Set<string>; rankedPaths: Set<string>;
packages: DiscoveredPackage[]; envSources: { path: string; text: string }[]; chains: string[][] }`.
`groundOnboarding` performs **no I/O**: existence has already been decided by P5 and arrives as
`verified`.

**Steps:**

1. `onboarding.system.md` — four edits and nothing else, so the file stays the one D15 accepts as
   the basis:
   - `:7-8` — the diagram allowance becomes the `architecture` section alone; **`routes_and_apis`
     is deleted** (R26, D11);
   - `:23-26` — the whole `routes_and_apis` formatting bullet is deleted. Leaving it teaches the
     model that such a section exists, and that is precisely where the sixth section AC-42 rejects
     comes from;
   - a `# Numbers` rule is added: no counts, no "used by N", no sizes — anything countable about
     the repository is computed by code and never written in prose (R16, D7/D21);
   - a `# No placeholders` rule is added: when a section has nothing real to say, say that; never
     an example, a typical value or sample data (R24, and `INSIGHTS.md:205-212`);
   - a `# Structured fields` section describes `flows`, `reading_path`, `tasks` and `run` in the
     terms grounding will check: a flow step must be a path from the critical-path chains it was
     given, a task's `complexity` is one of `low`/`medium`/`high`, a command belongs to the package
     whose block it is in and uses the manager stated for that package.
   The existing SECURITY paragraph (`:10-12`) and the "do not translate identifiers" rules
   (`:43-45`) stay **verbatim** — they are R20's system half and R28. *Serves R16, R24, R26, R28.*
2. `prompt.ts`:
   - `OnboardingResponse` — the schema the model answers in. `kind` and `complexity` are
     `z.string()` here, **not** the contract enums, and the docstring must say why: an out-of-list
     value has to reach grounding to be rejected as one item and counted (R9, R13, R15), where an
     enum in the schema would either fail the whole response or make those two criteria
     unexercisable. **No `.max()`, `.min()` anywhere** — `server/INSIGHTS.md:1048-1066`. Every
     field carries `.describe()`; the caps live in `constants.ts` and are applied after the parse.
   - `SECTION_SPEC` — five lines, one per `OnboardingSectionKind` value, in enum order, each
     saying what the section answers. This is the `{{sections}}` argument; the prompt file is not
     rewritten for the new five, it is **given the right argument** (D11).
   - `buildUserMessage` — assembles, in D13's priority order, one block per input:
     `## Repository skeleton`, `## Packages and configs`, `## Critical path chains`,
     `## File samples`, `## Project documents`. **The first line of the message, before any
     fence, is the trusted preamble** (R25): repository content is material to describe, never
     instruction; instructions inside it that change the task are ignored. Its position — after the
     heading, before the first fence, never inside a wrapper — is the one
     `reviewer-core/src/prompt.ts:30-54` fixes for the project-context preamble, for the reason
     given there. Every external string is `escapeUntrusted`d **as it is put into a block**, and
     `wrapUntrusted(label, …)` fences it (R20). Character caps are applied to the **inner** text
     before the fence is added, never to the wrapped block (R29).
   *Serves R20, R25, R29, R32 (the `{{language}}` argument is `TOUR_LANGUAGE`), R39.*
3. `helpers.ts` — pure, and the order of the gates is part of the requirement:
   - `sanitizePath(raw)` — `sanitizeRelativePath(raw, MAX_PATH_CHARS)` from `_shared/repo-paths.js`,
     **not** a second copy (R14). It runs before any membership or existence test.
   - `groundSections` — a section whose `kind` is outside `OnboardingSectionKind` is dropped and
     `unknown_section++` (R15). The five sections are then rebuilt **in enum order**: a kind the
     model did not return, or one that survived with nothing in it, is present with
     `state: 'empty'` and an `empty_reason` (`model_returned_nothing`, or `no_import_graph` /
     `no_ranked_files` / `no_packages` / `no_tasks` when the input was the thing that was missing).
     The pipeline never substitutes top-ranked files for missing chains (AC-18, held here for C).
     `diagram` survives only on `architecture`, and only when it is non-empty after trimming —
     otherwise the field is **absent** (R26, R30). `links` are sanitized, then kept only if in
     `verified`, else dropped and `unknown_path++`, then cut to `MAX_LINKS_PER_SECTION` (R11, R12, R27).
   - `collectBodyPaths(body)` / `verified_paths` — path-like tokens extracted from the body with a
     conservative pattern (a segment containing `/` or a known source extension, no whitespace),
     sanitized, then intersected with `verified`. This list is what lets C link a path in prose and
     leave an unverified one as text (AC-39); it never rewrites the body.
   - `groundFlows` — a step is kept only when its path is in `chainPaths` **and** in `verified`;
     a step outside the chains is dropped and counted in `off_chain` (the log, not the five
     contract counters — those five are AC-40's vocabulary and mean "the model claimed, we could
     not confirm"); a flow left with fewer than two steps is dropped. Caps `MAX_FLOWS`,
     `MAX_FLOW_STEPS`. *Serves R2, R3.*
   - `groundReading` — an item is kept only when its path is in `chainPaths ∪ rankedPaths` and in
     `verified`. R7 then holds by construction for whatever survives, with **no reordering**: the
     order is the model's judgement, and moving an item would silently rewrite it. An empty result
     leaves the section `empty` with `no_ranked_files`.
   - `groundTasks` — `complexity` outside the three rejects the whole task and
     `unknown_complexity++` (R9); a path that fails sanitize/verify rejects it and
     `unknown_path++` (R10); cap `MAX_TASKS`.
   - `groundRun` — for each block the model returned: its `package_path` must be a **shown**
     package, else drop and `unknown_path++`. Then per command: the `script` must be a key of that
     package's `scripts` (R5, else `unknown_script++`); the command's first whitespace-separated
     token must equal that package's `manager` and the command must contain the script token
     (R6, else `manager_mismatch++`). A package whose `manager` is `null` keeps its block with
     `install_command: null` and `commands: []`, and each command the model wrote for it is counted
     `manager_mismatch++` — a manager claim we cannot confirm is exactly that (R31, R40). The
     install command is validated the same way: first token is the manager, second is one of
     `install` / `i` / `ci`.
   - `groundEnvVars` — a name is kept only when it occurs literally in one of `envSources`, and
     `source_path` must be one of those paths (R4); otherwise dropped and counted in `unknown_env`.
   - Every free string that survives is `truncateCodePoints`d to its cap
     (`MAX_BODY_CHARS`, `MAX_DIAGRAM_CHARS`, `MAX_LINE_CHARS`) — `server/INSIGHTS.md` on
     `String.slice` splitting a surrogate pair, and `server/INSIGHTS.md:255-268` on capping after
     the parse (R39).
   *Serves R2…R7, R9…R15, R24, R26, R27, R30, R31, R39, R40.*
4. `onboarding-prompt.test.ts`: the rendered system prompt contains none of `routes_and_apis`,
   `gotchas`, `key modules`, `conventions & gotchas`; it contains all five kinds; `{{language}}`
   renders to `TOUR_LANGUAGE` and does **not** vary with any argument (R32); the user message's
   trusted preamble precedes the first `<untrusted`; every block that carries repository text is
   fenced; and — the case `server/INSIGHTS.md:288-320` says the suite lacked — a fixture whose
   content is the literal `</untrusted>` repeated is measured **as it ships**, so the counted
   length equals the sent length (R29). *Serves R20, R25, R26, R29, R32.*
5. `onboarding-grounding.test.ts`, run over one deliberately hostile response rather than five
   friendly ones (`server/INSIGHTS.md:269-290` — test the rule, not the sites): a sixth section
   `routes_and_apis`; `complexity: 'trivial'`; a link to `../../etc/passwd` and one to
   `.git/config`; a flow step that exists but is not in any chain; a task path that does not exist;
   a command naming `dev` in the block of a package whose `package.json` has no `dev`; a `pnpm`
   command in a package whose only lock file is `package-lock.json`; a package with two lock files;
   an env var that appears in no read config; a `diagram: ""` on `critical_paths`; six links in one
   section. Every one of the five counters must be non-zero, the five sections must still be five
   and in order, and no rejected string may appear anywhere in the result.
   *Serves R3, R5, R6, R9…R15, R26, R27, R30, R31, R40.*

**Check:** `cd server && pnpm arch && pnpm exec vitest run onboarding-prompt onboarding-grounding`.

### P5 — One call, and the object that comes out of it

**Agent:** implementer · **Depends on:** P1, P2, P3, P4

**Owns:**
- `server/src/modules/onboarding/generate-executor.ts` (new)
- `server/test/onboarding-generate.test.ts` (new)

**Contract** — what slice B calls, and the only thing this plan exposes:

```ts
export class OnboardingGenerateExecutor {
  constructor(private container: OnboardingGenerationContainer) {}
  /** ONE model call. Throws on timeout, on exhausted repair, and re-throws ConfigError as
   *  itself. Writes nothing anywhere — persistence is the caller's. */
  run(
    input: { workspaceId: string; repo: OnboardingRepoRef },
    log: OnboardingLogger,
  ): Promise<OnboardingGenerationResult>;
}
```

**No index state crosses this seam, in either direction** — a direct consequence of the
coordinator's ruling of 2026-08-17, and the reason the earlier draft of this plan had an `index`
parameter here. The pipeline does not read it (its container port cannot even express
`getIndexState`) and does not stamp it: slice B gates on the state and stamps `index_state` and
`generated_at` onto `OnboardingDraft` at persist time, which is what makes AC-54 B's by
construction. If B has been planned to pass one in, this signature does not accept it and
`tsc` says so at the call site — loudly, in B's file, which is where the decision lives.

B owns the single-flight, the rate limit and the row. `log` belongs to the request, not to the
instance — `modules/brief/service.ts:93-97` gives the reason.

**Steps:**

1. `gather` through `new OnboardingGatherExecutor(this.container).gather(input.repo)` (P3).
   *Serves R1, R2, R4, R5, R6.*
2. Budget: render the system prompt with
   `container.prompts.render('onboarding.system.md', { sections: SECTION_SPEC, language: TOUR_LANGUAGE })`,
   build one budget candidate per input in D13's order — `repo_map`, `package_configs`,
   `critical_paths`, then **one candidate per sample file**, then `project_docs` — and run
   `selectWithinBudget(candidates, ONBOARDING_TOKEN_BUDGET - count(system), count)` from
   `_shared/budget.js`. The escape is applied when a candidate's text is built, so what the walk
   measures is what ships (R29). Collapse the per-file sample results into one `OnboardingInput`
   row (`included` / `truncated` / `dropped`, `detail: '14 of 20 files'`) and set
   `sample_truncated` when any sample was cut or dropped — that is the number C shows for AC-86.
   `input_tokens_counted = count(system) + count(user)`, read **before** the call; read
   `container.tokenizer.id` **after** counting (it only learns it is broken by failing one) and
   `log.warn` when it is `heuristic`, quoting the brief's line — a bound held by a heuristic is not
   the bound the record claims. *Serves R18, R19, R23, R29.*
3. The call: `resolveFeatureModel(this.container, workspaceId, ONBOARDING_FEATURE)`, then
   `container.llm(choice.provider)`, then **exactly one**
   `completeStructured({ schema: OnboardingResponse, schemaName: ONBOARDING_SCHEMA_NAME,
   messages: [system, user], temperature: 0, maxRetries: ONBOARDING_MAX_RETRIES,
   timeoutMs: ONBOARDING_TIMEOUT_MS, reasoning: false })`, wrapped in
   `withTimeout(…, ONBOARDING_TIMEOUT_MS)` from `platform/resilience.js`. Both clocks, for the
   reason `modules/brief/service.ts:160-166` records: `timeoutMs` bounds one HTTP request, while
   `OpenRouterProvider` — this feature's default path — carries its own 600 000 ms deadline
   (R21). A `ConfigError` is not caught here at all (AC-53 is B's, and it needs the error as
   itself). *Serves R17, R21, R22.*
4. Existence: collect every path the response claims (a pure helper in P4), sanitize each, dedupe,
   cap at `MAX_PATH_PROBES`, and resolve each to a boolean — a path already in
   `sources.knownPaths` needs no probe; anything else is probed with
   `container.git.readFile(repo, path, PATH_PROBE_BYTES)` inside a catch-all, where **any** throw
   means unverified (a directory, a refusal, a missing file). One byte, through the port that
   already resolves symlinks, refuses a target outside the clone and refuses `.git` — which is why
   this plan adds no `exists()` method to duplicate those three checks in two implementations.
   Paths beyond the probe cap are unverified, which drops them; the count goes in the audit.
   *Serves R11, R12, R14.*
5. Ground: `groundOnboarding(result.data, ctx)` (P4), then assemble `OnboardingDraft` —
   `package_scan` from the gather, `inputs` from the budget walk, `dropped` from grounding,
   `sample_files`, `sample_truncated`, `budget`, `input_tokens_counted`, `tokenizer`, and from the
   provider's own result and nowhere else: `attempts`, `tokens_in`, `cost_usd`, `provider`,
   `model` (R13, R23). **No `generated_at` and no `index_state`** — the draft carries no stamp, and
   an implementer who adds one here is re-creating the key collision the ruling removed. Return
   `{ draft, audit }`; write nothing. On any throw, nothing has been returned and nothing has been
   written — R22's second half is a property of this file returning rather than persisting.
6. `onboarding-generate.test.ts`, hermetic, with `MockGitClient`, a stub facade and a fake
   `LLMProvider` injected through the container shape: **exactly one** `completeStructured` call per
   run (assert the call count, the criterion the whole of D3 rests on); the record's `attempts`,
   `tokens_in`, `cost_usd` and `tokenizer` are the fake's values, not recomputed; a `heuristic`
   tokenizer produces the warn line and still generates; a provider that throws `ConfigError`
   propagates it unwrapped; a provider that exhausts the repair throws and the test asserts the
   executor returned nothing; a fabricated task path is absent from the record and
   `dropped.unknown_path` is 1; a run where the fake provider never resolves is bounded by
   `withTimeout` (fake timers). *Serves R17, R21, R22, R23, R12.*

**Check:** `cd server && pnpm arch && pnpm typecheck && pnpm exec vitest run onboarding`.

**Dispatch order:** `P1` and `P2` in parallel first — they share no file and nothing else can
start without them. Then `P3` and `P4` in parallel, both against a landed P1 (P3 also needs P2's
port). Then `P5`. The two points where one package must land before the next is dispatched are
after P1/P2 (the contract, the constants and the port options must exist as written) and after
P3/P4 (P5 imports both entry points by name).

## Tests

Unit only, all hermetic, all in `server/test/`. **No integration test and no e2e in this slice** —
it has no DB, no route and no screen; `*.it.test.ts` and `e2e/` belong to slices B and C, and N8
rules e2e out of the feature entirely.

| File | New / changed | Covers |
|---|---|---|
| `server/test/contracts.test.ts` | changed (P1) | R8, R9, R15 |
| `server/test/git-list-files.test.ts` | new (P2) | R33, R34, R36 |
| `server/test/onboarding-packages.test.ts` | new (P3) | R31, R35, R37, R40 |
| `server/test/onboarding-gather.test.ts` | new (P3) | R33, R34, R36 |
| `server/test/onboarding-prompt.test.ts` | new (P4) | R20, R25, R26, R28, R29, R32 |
| `server/test/onboarding-grounding.test.ts` | new (P4) | R3, R5, R6, R9–R15, R27, R30, R31, R40 |
| `server/test/onboarding-generate.test.ts` | new (P5) | R12, R17, R18, R19, R21, R22, R23 |

One command runs them all:

```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
```

Every new test asserts a **failing** case before it is left green — the two extra turns that caught
a vacuous UTF-16 test and a `vi.mock` that had stopped intercepting (`CLAUDE.md`, "What a session
costs").

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`:

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

The client and `reviewer-core` gates are **not** optional here even though this plan writes no
client feature code: the vendored mirror is a client file, so `client/` is in the diff, and
`reviewer-core` aliases the **server** copy of `vendor/shared`, so a contract or port change
surfaces there and nowhere else until it does. `repo · vendor` is this plan's direct problem —
two files are mirrored, by two different packages (P1 and P2), and type-checking cannot see the
drift because each package compiles against its own copy.

## Risks (from INSIGHTS.md)

| Risk | What this plan does |
|---|---|
| **"A budget measured before an escape is not a budget"** — `server/INSIGHTS.md:288-320`: three spec files of the literal `</untrusted>` counted 4521 tokens and shipped as 6021, 9202 against a budget of 8000, because the escape is not length-preserving and ran after the count. | P4.2 escapes each block **as it is built**, so the walk measures what ships; P4.4 pins it with a fixture whose content is that literal — the fixture the brief's suite lacked (R29). |
| **"Anthropic's structured-output API rejects a Zod schema that states a bound"** — `:1048-1066`: `maxItems` / `minimum` / `maximum` fail on any Anthropic model through OpenRouter. | `OnboardingResponse` carries no bound at all; every cap is a constant applied after the parse (R39), which is also what makes AC-32 and AC-42 rejections observable. |
| **"`TiktokenTokenizer` answers `chars/4` after one failure, for the rest of the process"** — `:1140-1160`: "a budget walk passes, the log says 7 900, and the real input is whatever `chars/4` mis-estimated". | The record carries `tokenizer` beside `input_tokens_counted`, read **after** counting, and a `heuristic` id logs a warning (R18, R23). The spec's own edge-case table already accepts that the budget is not guaranteed in provider tokens in that mode. |
| **"A path compared as a string must be canonicalised before it enters, not at each comparison"** — `:738-755`: a root stored as `docs/` produced a successful scan with zero documents and no error. | Every path is put through `sanitizeRelativePath` once, at the point it enters, and package paths are posix-normalised in the walk (`simple-git.ts` already returns posix). Membership sets are built from normalised strings only (R14). |
| **"An invariant maintained at the call site breaks once per call site"** — `:269-290`: one invariant broke in three places on one feature, and three point fixes each revealed the next. | The grounding suite runs one hostile fixture through the single entry point `groundOnboarding` rather than one friendly case per helper (P4.5). |
| **"Cap after the parse, never in the schema"** — `:255-268`: an allowed path repeated four hundred times passes a membership filter every time. | Caps on every array and every free string, applied in grounding, listed in `constants.ts` (R39). |
| **Root `INSIGHTS.md:205-212`** — invented rows "describe code the PR does not contain, and the rows outlive the screenshot". | R24 in the prompt, and the pipeline's own rule: an input that is missing produces an `empty` section with a reason, never a substitute. |

## Alternatives rejected

- **Ask the port for `.json` with `maxFiles: 12` and filter to `package.json` in the module.** The
  cheapest thing to write and the spec's named trap (AC-91, D24): the slice runs **before** the
  filter and alphabetically, so twelve `tsconfig.json` and `coverage-summary.json` can consume the
  ceiling and leave a repository with five packages showing none. Rejected in favour of teaching
  the port to filter by name, which is what makes the ceiling count packages.
- **Do the name and depth filtering in the module over an unbounded `.json` listing.** Avoids the
  port change but keeps the same defect one step further away: with any finite `maxFiles` the
  alphabetical prefix can still exclude a manifest, and with none, the walk is unbounded over
  attacker-controlled content — which is the one thing every bound on this port exists to prevent.
- **Read `workspaces` from the root `package.json` and `pnpm-workspace.yaml`.** Cheaper and exact
  where a workspace is declared. D24 rejected it, and the reason is worth repeating at the step:
  DevDigest declares no workspace (`AGENTS.md:5`), so the mechanism fails on the very repository
  the feature is demonstrated on.
- **Rewrite each command from the verified manager and the verified script instead of comparing
  what the model wrote.** Guarantees R6 by construction — and destroys AC-40's `manager_mismatch`
  counter, because a rewritten command never disagrees with anything. The spec asks for a count of
  what was rejected, so the pipeline compares and drops.
- **Put `kind` and `complexity` in the model's schema as enums.** Under strict structured output
  this constrains the model, which sounds strictly better; it also makes AC-32 and AC-42 —
  criteria about *rejecting* an out-of-list value one item at a time — unreachable, and it puts a
  constraint into a schema that this repository has already been burned by (`:1048-1066`). The
  vocabulary is stated in the prompt and enforced in code.
- **Build the verified-path set only from what was fed to the model**, the way
  `buildAllowedRefs` does for the brief. Cheaper, and wrong here: the repo **map** is a rendered
  skeleton, so it names paths we never listed, and AC-10 asks the architecture prose to cite them.
  The set would have dropped exactly the citations the section exists for. The pipeline probes the
  clone instead, through the read port, bounded by `MAX_PATH_PROBES`.
- **Add `exists()` to `GitClient`.** Clearer to read; also a second implementation of the symlink,
  outside-clone and `.git` refusals in the adapter and in the mock. A one-byte `readFile` already
  answers the question through the checks that exist.
- **A code gate that rejects prose containing a quantity (R16).** A regex over Ukrainian prose
  either misses the claim or mutilates the paragraph, and there is no failure pair in the spec that
  says which. R16 is enforced by the prompt rule and measured by a counter in the audit log;
  Recommendation 3 is the stronger version, and it needs the measurement first.
- **One model call per section.** D3, with its cost named — the revision condition is the
  `attempts` counter this plan records (R23), not an opinion.

## Verification

Observable, in this order. The last item is one end-to-end run through the real entry point.

1. `cd server && pnpm exec vitest run contracts` — an `OnboardingDraft` with
   `kind: 'routes_and_apis'` or `complexity: 'trivial'` fails to parse, and `OnboardingDraft.shape`
   holds neither `generated_at` nor `index_state`. *R8, R9, R15, R38.*
2. `cd server && pnpm exec vitest run git-list-files` — 40 manifests with `maxFiles: 12` return 12
   manifests and `bounded: true`; a manifest at depth 3, one under `node_modules/` and one under
   `vendor/` are absent. *R33, R34, R36.*
3. `cd server && pnpm exec vitest run onboarding-packages` — the DevDigest layout returns
   root-first with `pnpm` for `server`/`client` and `npm` for `reviewer-core`/`e2e`/`mcp`; two lock
   files give `null`; the order is stable across runs. *R6, R31, R35, R37, R40.*
4. `cd server && pnpm exec vitest run onboarding-prompt` — the rendered prompt contains neither
   `routes_and_apis` nor `gotchas`, contains the five kinds, renders the fixed language, puts the
   trusted line before the first fence, and counts what it ships. *R20, R25, R26, R28, R29, R32.*
5. `cd server && pnpm exec vitest run onboarding-grounding` — over the hostile fixture, all five
   counters are non-zero, exactly five sections come out in enum order, `../../etc/passwd` and
   `.git/config` appear nowhere, the `pnpm` command in an npm package is gone, and no section has
   more than four links. *R3, R5, R9–R15, R27, R30, R31.*
6. `cd server && pnpm exec vitest run onboarding-generate` — exactly one `completeStructured` per
   run; `attempts` / `tokens_in` / `cost_usd` / `tokenizer` come from the provider result and the
   counter; a `ConfigError` arrives unwrapped; an exhausted repair returns nothing. *R17, R18, R19, R21, R22, R23.*
7. `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing; `cd client &&
   pnpm typecheck` is green. *The mirror obligation of R8 and R33.*
8. **End to end, through the real entry point, on a real clone.** With the API running
   (`./scripts/dev.sh`) and a repository imported and indexed, drive
   `OnboardingGenerateExecutor.run` once against that repo — from slice B's route if B has landed,
   otherwise from a throwaway `tsx` script that builds a `Container` and calls it — and read the
   returned draft: five sections in order, every `links[].path` and every `tasks[].path` openable
   in the clone, one block per DevDigest package with `pnpm` for two of them and `npm` for three,
   `package_scan.found === 6`, `dropped` present with five keys, `attempts` and `tokens_in`
   non-zero, `cost_usd` set. Then re-read the server log line: one generation, one model call.
   *R1, R2, R5, R6, R11, R13, R17, R23, R33, R35, R37.*

## Open questions

_None._

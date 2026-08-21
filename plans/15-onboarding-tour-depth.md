# 15 — Onboarding Tour · depth

**Status:** Planned 2026-08-18
**Scope:** server · client
**Modules touched:** `server/src/modules/onboarding`, `server/src/modules/repo-intel`, `server/src/vendor/shared`, `server/src/prompts`, `client/src/vendor/shared`, `client/src/app/repos/[repoId]/onboarding`, `client/messages/en`
**Requirements source:** `specs/SPEC-04-onboarding-tour-depth.md` (approved 2026-08-18, 57 active criteria)
**Execution:** multi-agent

The feature SPEC-04 deepens already works end to end — five sections `ready`, ~1 min 45 s,
~$0.0053, all five drop counters at zero on the last run. Nothing here rebuilds it. Read
[`docs/onboarding-tour.md`](../docs/onboarding-tour.md) for the mechanism before any step;
`plans/12`, `13` and `14` are intent, and the contract has grown past them.

## Requirements as understood

Every `AC` of the spec is below. The thirteen removed numbers (AC-26…AC-38), AC-51 and AC-69
are tombstones, not requirements — they are named under `## Out of scope`.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | Activating a first-task card opens that task's detail window; a task carrying no steps offers no control to open one | `SPEC-04 § AC-1, AC-9` | clear |
| R2 | The window carries an ordered list of steps, one action per step | `SPEC-04 § AC-2` | clear |
| R3 | The window carries what the change will touch in this repository | `SPEC-04 § AC-3` | clear |
| R4 | The window carries a verification line — how you see it is done | `SPEC-04 § AC-4` | clear |
| R5 | The window carries the task's title, path, complexity label, steps, impact and verification, and **no field absent from the tour contract** | `SPEC-04 § AC-68, AC-70` | clear |
| R6 | A path inside a step is a link only when it passed the same existence check as every other tour path; otherwise the step stays plain text and `unknown_path` counts it | `SPEC-04 § AC-5, AC-6` | clear |
| R7 | A command inside a step must be one already grounded for the "How to run" section; otherwise the command is removed from the step and `unknown_script` counts it | `SPEC-04 § AC-7, AC-8` | clear |
| R8 | A path-shaped string inside step prose that is not grounded stays plain text | `SPEC-04 § AC-50` | clear |
| R9 | Every stored task's details come from the one existing model call; opening the window makes no model call | `SPEC-04 § AC-10, AC-11` | clear |
| R10 | The open task is in the URL so re-opening that URL re-opens the same window; a URL naming a task the saved tour does not carry shows the tour with no window and no error | `SPEC-04 § AC-12, AC-57` | clear |
| R11 | While open the window holds keyboard focus, Esc closes it, closing returns focus to the control it was opened from, and its accessible name names the task | `SPEC-04 § AC-13, AC-14, AC-15, AC-71` | clear |
| R12 | Steps, impact and verification carry no quantitative claim about the repository | `SPEC-04 § AC-16` | clear |
| R13 | The number of stored tasks equals the number the page shows without a disclosure | `SPEC-04 § AC-72` | clear |
| R14 | For an index with ≥600 ranked files, at least 20 distinct chains are supplied to the model | `SPEC-04 § AC-17` | clear |
| R15 | Supply does not bound one chain below 5 files | `SPEC-04 § AC-18` | clear |
| R16 | No supplied chain is a prefix of another supplied chain | `SPEC-04 § AC-19` | clear |
| R17 | The record carries the number of chains supplied and the length of the longest one | `SPEC-04 § AC-20` | clear |
| R18 | Every grounded flow is shown, up to the display ceiling, and that ceiling is never below the number of chains supplied | `SPEC-04 § AC-21, AC-22` | clear |
| R19 | A flow step naming a path outside the supplied chains is dropped and counted | `SPEC-04 § AC-23` | clear |
| R20 | The chains block is offered to the budget walk one chain at a time | `SPEC-04 § AC-24` | clear |
| R21 | Wider supply adds no database query and changes the shape of none | `SPEC-04 § AC-25, AC-56` | clear |
| R22 | The input budget is computed from `files_indexed`, lies in 24 000…50 000 inclusive, and grows monotonically with it | `SPEC-04 § AC-58, AC-59, AC-61` | clear |
| R23 | The assembled input fits the **computed** budget, counted with `container.tokenizer` | `SPEC-04 § AC-39` | clear |
| R24 | The record carries the applied budget and the `files_indexed` it was computed from | `SPEC-04 § AC-60` | clear |
| R25 | The model call's clock grows with the computed budget, is ≥300 000 ms at the largest budget and never exceeds 300 000 ms | `SPEC-04 § AC-62, AC-63, AC-64` | clear |
| R26 | A generation fits the clock computed for its budget; one that does not leaves the previously saved tour untouched | `SPEC-04 § AC-44, AC-45` | clear |
| R27 | A generation that missed its clock records the applied budget and the measured duration | `SPEC-04 § AC-65` | ambiguous → see note |
| R28 | The record carries the model call's duration in milliseconds | `SPEC-04 § AC-43` | clear |
| R29 | The record carries the system prompt's token count separately from the blocks' | `SPEC-04 § AC-40` | clear |
| R30 | The record names which elements of a per-item input did not ship, and which documents arrived shortened | `SPEC-04 § AC-54, AC-55` | clear |
| R31 | On the `Holubinka/dev-digest` clone, `file_samples` reports ≥18 of 19 and `project_docs` reports 7 of 7 | `SPEC-04 § AC-41, AC-42` | clear |
| R32 | Every new contract field carries an empty default, so tours saved before this change still parse | `SPEC-04 § AC-46` | clear |
| R33 | Every new single-line model string is cut at the same length bound the existing single-line fields use | `SPEC-04 § AC-47` | clear |
| R34 | No new model string is rendered as HTML, and no new surface offers to execute what it shows | `SPEC-04 § AC-48, AC-49` | clear |
| R35 | The feature adds no API route, and a repo id from another workspace reveals no task, path or step | `SPEC-04 § AC-52, AC-53` | clear |
| R36 | One generation at the largest budget costs no more than $0.02 | `SPEC-04 § AC-66` | clear |
| R37 | The computed budget raises no selection ceiling — not the sample count, not the per-file cap, not the per-document cap | `SPEC-04 § AC-67` | clear |

**Note on R27.** AC-65 says "the failure record" carries the budget and the duration. This feature
writes **no** failure row — AC-45 requires the previous tour to be left untouched, and
`service.ts:176-190` throws without writing. The only record a failed generation leaves is the log
line. R27 is therefore planned as a `log.warn` carrying `budget` and `durationMs`, which is the
same place `service.ts:162-172` already records a refused generation. Recorded here rather than
resolved silently.

## Out of scope

- **AC-26…AC-38, AC-51, AC-69** — withdrawn by the spec on 2026-08-18 (D23, the unit map). They are
  not requirements and their numbers are never reused. In particular **AC-38 does not apply**: the
  mermaid diagram stays, `MAX_DIAGRAM_CHARS` stays live, `OnboardingSection.diagram` stays,
  `client/src/components/mermaid-diagram` and the `mermaid` dependency stay with their consumer.
- **The document truncation defect (N12).** `MAX_DOC_CHARS` = 4 000 with a cut from the end hides
  `scripts/dev.sh` in this repository's own `README.md` (character 4 484). Named by the spec, owned
  by D21, triggered by a later measurement — **not this plan**. R37 forbids touching it here.
- **Anything the budget surplus might buy.** No sample count, file cap or document cap moves (R37).
- **Scrollspy work and `./scripts/dev.sh` support in "How to run"** (N9) — built separately.
- **`mcp/`, `e2e/`, `reviewer-core/`** (N8). No new browser flow, no new tool, no new route (R35).
- **Rendering the newly named omissions on screen.** R30 puts them in the record; D18 accepted, as
  a named debt, that the tour's reader does not see why a section is thin. Adding that to
  `InputStates` is a recommendation below, not a step.
- **A second model call, on click or anywhere else** (N1, R9).

## What already exists

- **Generation:** `server/src/modules/onboarding/` — `constants.ts` (457 lines, every cap with its
  anchor), `generation-types.ts` (the structurally-restated facade port, lines 46-65),
  `gather-executor.ts`, `prompt.ts`, `helpers.ts` (grounding, `groundOnboarding` at :997),
  `generate-executor.ts` (`fitToBudget` at :283, `verifyPaths` at :364, `buildCandidates` at :424,
  `inputRow` at :482).
- **HTTP and persistence:** `types.ts`, `status.ts`, `repository.ts`, `service.ts` (the gate reads
  the index state at :154 and already holds `filesIndexed`), `routes.ts`.
- **Supply:** `server/src/modules/repo-intel/service.ts:702-742` `getCriticalPaths` — seeds from
  `CRITICAL_PATH_ROOTS = 5` (`:745`), walks `BFS_DEPTH = 2` (`constants.ts:59`), drops a chain
  shorter than 2 (`:734`). Both reads are already unbounded in the repository
  (`repository.ts:432-437` `getEdges`, `:471-481` `getRankedPaths(repoId, 100_000)`); the ceiling
  is an in-memory slice **after** both are loaded, which is why R21 is free.
- **Contract:** `OnboardingTask` is four fields, `knowledge.ts:147-153`. `OnboardingDraft`
  (`:400-420`) already carries `budget`, `input_tokens_counted`, `tokenizer`, `tokens_in`,
  `cost_usd`. `OnboardingInput` (`:299-305`) carries `detail: string | null`.
- **Client:** `FirstTasksSection.tsx` draws six cards and hides the rest behind a `<details>`;
  `CriticalPathsSection.tsx` already renders **every** flow it is given, labelled when there is more
  than one — so R18's screen half needs no client change. `CommandRow`, `FileRef`,
  `ComplexityBadge` and `CopyButton` are siblings under `OnboardingTourView/_components/`.
- **No focus-trap helper exists anywhere in `client/src`.** `vendor/ui/kit/Modal.tsx` sets
  `role="dialog" aria-modal="true"` and nothing else — no Esc, no trap, no focus restore, no way to
  pass an accessible name. It is vendored and must not be edited, so R11 is new code.

## Constraints

| Constraint | Mandated by |
|---|---|
| `modules/onboarding/**` may not import `modules/repo-intel/**` — `import type` included, `tsPreCompilationDeps: true` | `server/.dependency-cruiser.cjs` `no-cross-module`; restated at `generation-types.ts:14-28` |
| Two numbers that must agree across that boundary are held together by a **test**, never by an import | `server/test/onboarding-gather.test.ts` (the `REPO_MAP_TOKEN_BUDGET` precedent); `SPEC-04 § Module interactions` |
| Every field added to a contract in `vendor/shared` needs an empty `.default()` — the record is jsonb and is re-parsed on read | `knowledge.ts:378-398`; `onboarding-api.ts:17-24`; `server/INSIGHTS.md` "A jsonb column is untyped input" |
| The server copy of `vendor/shared` is the source of truth; the client copy is mirrored and the drift is invisible to both typechecks | `CLAUDE.md` § Non-default conventions; gate `repo · vendor` |
| No Zod `.max()`, `.min()` or any bound on the response schema — Anthropic's structured-output subset rejects it | `prompt.ts:55-62`; `server/INSIGHTS.md` "Anthropic's structured-output API rejects a Zod schema that states a bound" |
| Absence in the response schema is `null`, never a missing key; the stored contract may use absent | `prompt.ts:64-67` |
| A budget is measured on the block **already fenced and escaped**, and each candidate is measured with `BLOCK_SEPARATOR` | `generate-executor.ts:260-282`; `server/INSIGHTS.md` "A budget measured before an escape is not a budget" |
| The budget walk has ONE cut point: it truncates the first candidate that does not fit and drops every one after it | `modules/_shared/budget.ts:48-64`; `server/INSIGHTS.md` "The last input of a budget walk is all-or-nothing…" |
| A block is shortened by dropping whole fenced items, never by a generic string cut | `prompt.ts:357-383`; `server/INSIGHTS.md` "With fenced inputs, `selectWithinBudget` decides WHICH block is cut" |
| The three-place order — `OnboardingInputId`, `buildInputBlocks`, `buildCandidates` — must stay in agreement, and `project_docs` stays **above** `file_samples` | `knowledge.ts:271-292`; `server/INSIGHTS.md`, 2026-08-18 entry |
| A command is **rejected** when it fails any gate, never truncated and never repaired | `helpers.ts:277-287`; `server/INSIGHTS.md` "A length cap applied to a string that will be EXECUTED has to reject it" |
| `#` and every character outside `[A-Za-z0-9._:@/=+-]` drops a command whole | `helpers.ts:127-138, 250-275`; `server/INSIGHTS.md` "`#` is not a comment in the shell the reader is actually in" |
| `sanitizeRelativePath` runs FIRST on every path, before any membership or existence test | `helpers.ts:50-53` |
| A service takes its repository as a parameter and reaches ports through the container; a route validates and delegates | `onion-architecture` §3.1-3.3 |
| Dependencies point inward: a pure sizing function is Core and may import only constants | `onion-architecture` §1, §2 |
| The client never re-derives a server decision it was handed (`stale` is the precedent) | `docs/onboarding-tour.md` § *What the client reads and never recomputes* |
| Shareable state lives in the URL, not in `useState` | `frontend-architecture` principle 5; D8 SPEC-03 |
| A component used by one route is colocated; promotion needs a second consumer | `frontend-architecture` principles 1-2 |
| `@testing-library/user-event` is not installed — every client test uses `fireEvent` | `client/INSIGHTS.md:1303-1318` |
| Untrusted model text is rendered by React as text; `dangerouslySetInnerHTML` is never used | `security` § A05 (XSS); `SPEC-04 § AC-48` |

## Recommendations

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Show the newly named omissions (R30) in `InputStates` — "file_samples: 18 of 19 · not shipped: `x.ts`" — so the tour's reader, not only whoever opens the record, can tell a thin section from a poor repository | No. D18 accepted the debt deliberately; this reverses it | One component, one message key, one test. No contract change — the arrays are already there |
| 2 | Give `project_docs` a block-level ceiling the way `REPO_MAP_TOKEN_BUDGET` bounds the skeleton. A monorepo at `MAX_PACKAGES` offers 14 documents ≈ 14 000 tokens, 58 % of a floor budget, and nothing bounds the block | No. It is `server/INSIGHTS.md` § Open Questions and wants a measurement on a real monorepo | A constant, a walk change, one measurement |
| 3 | Filter `isJunkPath` out of the reading-path and flow supply the way `getTopFilesByRank` already does for samples — folded into this plan for **chain roots** (P2.2) because 20 roots reach much further down the rank list than 5 did; not folded in anywhere else | Already in | — |
| 4 | Split `helpers.ts` (1 034 lines) by claim kind now that task grounding joins it | No — a refactor during a feature is what the three-round loop in `CLAUDE.md` is about | A file move plus a test-import sweep |

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| P1.1, P1.2, P1.3 | `zod` | New contract fields, `.default()` semantics, `optional()` vs `nullable()` on `OnboardingTaskStep.path` |
| P2.2, P2.3 | `onion-architecture` | The change sits in `repo-intel/service.ts` (Application) and its constants; §1 and the `no-cross-module` rule decide what may not be imported |
| P3.1, P3.2 | `onion-architecture` | Where `sizing.ts` goes (Core: pure, constants only) and why `filesIndexed` arrives as a parameter rather than through a widened port |
| P3.4, P3.5 | `security` | § A05 injection and § *Agentic AI Security* — a step's command is the longest "someone else's text → a human's shell" chain in the product |
| P3.6 | `zod` | The response schema gains fields and may state no bound |
| P4.1, P4.2 | `frontend-architecture` | Where the dialog and the focus-trap hook live, and which folder level owns the URL state |
| P4.2, P4.3 | `react-best-practices` | Effects, refs and event listeners in the dialog; deriving the open task during render rather than copying it into state |
| P4.2, P4.4 | `next-best-practices` | `useSearchParams` / `router.replace` under the App Router, and the `'use client'` boundary |
| P4.3 | `security` | § A05 — the step text and the command are model output over an imported repository |

`fastify-best-practices`, `drizzle-orm-patterns` and `postgresql-table-design` are **not** to be
loaded: R35 adds no route, and R21 forbids a new or changed query. `react-testing-library` is the
implementer's own call; this plan names the suites, not the assertions.

## The shared contract

**Repeated in every package that consumes it.** Each package is executed by an agent starting
cold, and SPEC-03 cost four extra rounds because three planners diverged on exactly these names.
Rename nothing here — not a key, not a member, not the case. `snake_case` for every contract key.

**New on `OnboardingTask`** (`vendor/shared/contracts/knowledge.ts`, both copies):

```ts
export const OnboardingTaskStep = z.object({
  text: z.string(),
  /** Repo-relative, proven to exist. `null` when the step names no file. */
  path: z.string().nullable(),
  /** A command already grounded for this repository. `null` when the step names none. */
  command: z.string().nullable(),
});

export const OnboardingTask = z.object({
  title: z.string(),
  path: z.string(),
  why: z.string(),
  complexity: OnboardingTaskComplexity,
  steps: z.array(OnboardingTaskStep).default([]),
  /** What the change touches in this repository. `''` when the model said nothing. */
  impact: z.string().default(''),
  /** How the reader sees the task is done. `''` when the model said nothing. */
  verification: z.string().default(''),
});
```

**New on `OnboardingDraft`** (same file), each with an empty default:

```ts
  chains_supplied: z.number().int().default(0),   // AC-20
  longest_chain_files: z.number().int().default(0),
  system_tokens: z.number().int().default(0),     // AC-40
  duration_ms: z.number().int().default(0),       // AC-43
```

`budget` already exists and now carries the **computed** value.

**New on `OnboardingInput`** (same file):

```ts
  /** Items of a per-item input that did not ship, by label. AC-54 */
  omitted: z.array(z.string()).default([]),
  /** Documents a per-document ceiling cut before fencing, by path. AC-55 */
  shortened: z.array(z.string()).default([]),
```

**Server-side numbers fixed by this plan** (each stated where it is defined):

| Constant | File | Value | Was |
|---|---|---|---|
| `CRITICAL_PATH_CHAINS` (exported) | `repo-intel/constants.ts` | 20 | `CRITICAL_PATH_ROOTS = 5`, module-private in `service.ts:745` |
| `BFS_DEPTH` | `repo-intel/constants.ts` | 4 | 2 |
| `MAX_FLOWS` | `onboarding/constants.ts` | 20 | 4 |
| `MAX_FLOW_STEPS` | `onboarding/constants.ts` | 6 | 6 — unchanged, anchor restated |
| `MAX_TASKS` | `onboarding/constants.ts` | 6 | 12 |
| `MAX_TASK_STEPS` (new) | `onboarding/constants.ts` | 6 | — |
| `MAX_PATH_PROBES` | `onboarding/constants.ts` | 200 | 120 |
| `ONBOARDING_BUDGET_FLOOR` (new) | `onboarding/constants.ts` | 24 000 | — |
| `ONBOARDING_BUDGET_CEILING` (new) | `onboarding/constants.ts` | 50 000 | — |
| `ONBOARDING_BUDGET_RAMP_FILES` (new) | `onboarding/constants.ts` | 2 000 | — |
| `ONBOARDING_TIMEOUT_FLOOR_MS` (new) | `onboarding/constants.ts` | 180 000 | — |
| `ONBOARDING_TIMEOUT_CEILING_MS` (new) | `onboarding/constants.ts` | 300 000 | — |
| `ONBOARDING_TOKEN_BUDGET`, `ONBOARDING_TIMEOUT_MS` | `onboarding/constants.ts` | **deleted** | 24 000 / 180 000 |

**The two functions**, in `server/src/modules/onboarding/sizing.ts` (new, pure):

```ts
budgetForIndex(filesIndexed) =
  FLOOR + Math.round((CEILING - FLOOR) * Math.min(Math.max(filesIndexed, 0), RAMP) / RAMP)

timeoutForBudget(budget) =
  TIMEOUT_FLOOR + Math.round(
    (TIMEOUT_CEILING - TIMEOUT_FLOOR) * (budget - FLOOR) / (CEILING - FLOOR))
```

`files_indexed` = 656 on this repository → **budget 32 528**, **clock 219 360 ms**. At the floor
both keep today's proven pair (24 000 / 180 000); at the ceiling, 50 000 / 300 000.

**The seam.** `OnboardingGenerateInput` (`onboarding/types.ts`) gains `filesIndexed: number`, and
`OnboardingService.run` passes `index.filesIndexed` from the gate read it already performs
(`service.ts:154`). The generation container port is **not** widened with `getIndexState` — its
docstring (`generation-types.ts:36-43`) says why, and a number handed over is not a port.

## Work packages

Five packages. No two own the same file.

---

### P1 — The contract, both mirrors, the client re-export

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/knowledge.ts`
- `client/src/vendor/shared/contracts/knowledge.ts`
- `client/src/lib/types.ts`
- `server/test/contracts.test.ts`
- `server/test/onboarding-contract.test.ts`

**Contract:** § *The shared contract* above, in full.

**Steps**

1. **Declare `OnboardingTaskStep` and extend `OnboardingTask`** in the server copy, exactly as the
   contract block states (R2, R3, R4, R5, R6, R7, R32). Place `OnboardingTaskStep` immediately
   above `OnboardingTask`. Its `path` and `command` are `.nullable()` and **not** `.optional()`:
   the stored value is always present, and `null` is the honest "this step names none" — the
   distinction the `zod` skill's `object-optional-vs-nullable` rule is about, and the same one
   `OnboardingSection.diagram` makes in the other direction. State no `.max()` anywhere.
   *Check:* `cd server && pnpm typecheck` passes; the three new keys appear once each.
2. **Extend `OnboardingDraft` and `OnboardingInput`** with the seven fields in the contract block
   (R17, R24, R28, R29, R30, R32). Extend the `OnboardingDraft` docstring at `knowledge.ts:392-398`
   in one paragraph: `impact` and `verification` are strings that **do** take an empty default,
   and the rule it appears to break is intact — the docstring refuses a defaulted `title` or `body`
   because that would turn a section that failed to generate into one with nothing to say, whereas a
   task saved before this change genuinely carries neither statement, and `''` is exactly that fact.
   *Check:* `cd server && pnpm typecheck` passes; every added field has a `.default()`.
3. **Extend the `unknown_script` docstring** (`knowledge.ts:260`) to say that it also counts a
   command inside a task step that is not one of this repository's grounded commands (R7) — the
   move `unknown_path`'s docstring (`:246-258`) already made for setup commands. No new counter:
   the five are fixed and two sibling slices read exactly those names.
   *Check:* the docstring names both cases; `OnboardingDropped` still has five keys.
4. **Mirror the file into the client copy and re-export the new type** (R5 — the window cannot draw
   a contract field the client cannot see). Copy the server file
   verbatim, then add `OnboardingTaskStep` to the `@devdigest/shared` re-export list in
   `client/src/lib/types.ts` (it sits with the other onboarding names at :100-122).
   *Check:* `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing;
   `cd client && pnpm typecheck` passes.
5. **Pin the old-document guarantee** in `server/test/onboarding-contract.test.ts` (R32): parse a
   record shaped exactly as one written before this change — a task with only
   `{ title, path, why, complexity }`, a draft with no `chains_supplied`, `longest_chain_files`,
   `system_tokens` or `duration_ms`, an input row with no `omitted` or `shortened` — and assert it
   succeeds with `steps: []`, `impact: ''`, `verification: ''` and `0`/`[]` for the rest. Keep the
   existing `.extend()` collision test; assert it still holds with the new draft fields, since
   `OnboardingRecord` still owns only `generated_at` and `index_state`.
   *Check:* `cd server && pnpm exec vitest run onboarding-contract` is green, and it fails if any
   `.default()` is removed.
6. **Keep `contracts.test.ts` honest** (R32). It enumerates contract shapes; add the new fields to whatever
   assertion covers `OnboardingDraft` and `OnboardingTask` there rather than leaving the file stale.
   *Check:* `cd server && pnpm exec vitest run contracts` is green.

---

### P2 — Chain supply: measure first, then widen

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/modules/repo-intel/service.ts`
- `server/src/modules/repo-intel/constants.ts`
- `server/test/repo-intel-critical-paths.test.ts` (new)

**Contract:** `getCriticalPaths(repoId): Promise<string[][]>` keeps its signature — no options
parameter, no new port. `repo-intel/constants.ts` exports `CRITICAL_PATH_CHAINS = 20` and
`BFS_DEPTH = 4`; P3's test imports both by those names.

**Steps**

1. **Measure the hypothesis before changing anything** (R14). The spec makes it measurable rather
   than assumed: rank rewards being imported, the walk follows importer → imported, so the
   highest-ranked files may be the worst roots and every chain from them dies at `chain.length < 2`.
   Run this against the real index, with no route and no model call — the recipe is
   `server/INSIGHTS.md` §§ "`startPg()` from a scratch script…" and "A scratch script … must be
   `.mts`":
   - get the repo id from `curl -s localhost:3001/repos` (a free GET) — the clone is
     `Holubinka/dev-digest`;
   - write `<scratchpad>/chains.mts` (**`.mts`, and it may import server files only** — reach the
     data through `createDb` from `server/src/db/client.js` and `RepoIntelRepository`, never through
     a query written in the script, because `drizzle-orm` will not resolve from the script's
     directory);
   - run `cd server && DATABASE_URL=postgres://devdigest:devdigest@localhost:5434/devdigest pnpm exec tsx <scratchpad>/chains.mts`;
   - print, for each of three rules over the same `getEdges` + `getRankedPaths(repoId, 100_000)`
     data: **(a)** today's rule (top 5 by rank, depth 2), **(b)** the same rule at 20 roots and
     depth 4, **(c)** the rule step 2 installs — the number of chains of ≥2 files, the length of the
     longest, and how many candidate roots were skipped for having no out-edge.
   *Check:* the three counts are written into the step's own output **and carried into the final
   report**. If (b) is materially below 20 while (c) reaches it, the spec's hypothesis was right and
   this is the number that says so; if (c) is also below 20, **stop and report** — R14 is then a
   supply fact this repository cannot meet and the plan is wrong about it, which is exactly what
   this step exists to find before the code is written.
2. **Replace the seeding rule** in `getCriticalPaths` (`service.ts:702-742`) (R14, R15, R16, R21).
   Keep the two reads and their arguments **byte for byte** — `getEdges(repoId)` and
   `getRankedPaths(repoId, 100_000)` — because R21 is only free while the ceiling is a slice in
   memory after both have loaded. Then, over `ranked` in rank order:
   - skip a candidate root with no entry in the adjacency map (nothing to walk into — this is the
     defect the spec named, and skipping costs one `Map.has`);
   - skip a candidate root `isJunkPath` rejects (`service.ts:792`), the same filter
     `getTopFilesByRank` already applies to samples: with 20 chains the walk reaches far enough down
     the rank list to seed on tests, `.d.ts` files and migrations, and a chain rooted in a test file
     is not a flow that carries the product;
   - walk greedily to the highest-ranked unvisited import, up to `BFS_DEPTH` hops, exactly as today;
   - keep a chain of ≥2 files, dedupe by its joined key as today, and stop at
     `CRITICAL_PATH_CHAINS` chains.
   *Check:* the diff touches no `this.repo.` call site; re-running step 1's script with rule (c)
   reproduces the number recorded there.
3. **Move the two numbers into `constants.ts`** (R14, R15). `CRITICAL_PATH_ROOTS` is deleted; its
   replacement `CRITICAL_PATH_CHAINS = 20` is a ceiling on **chains kept**, not on roots tried, and
   its docstring must say that outright — the old name described a seeding cap and the new rule has
   no fixed number of roots. `BFS_DEPTH` moves 2 → 4, giving `1 + BFS_DEPTH = 5` files, which is
   what AC-18 asks for; leave the note at `constants.ts:36-38` that `MAX_DOWNSTREAM_DEPTH` is
   deliberately not this constant, and correct it to say the two are no longer even equal.
   *Check:* `cd server && pnpm arch` passes; `rg CRITICAL_PATH_ROOTS server/src` returns nothing.
4. **Test the supply properties** in `server/test/repo-intel-critical-paths.test.ts`, over a
   hand-built edge and rank set with no database (the `DownstreamReads` fixture pattern at
   `service.ts:797-800` is the shape to copy) (R14, R15, R16, R21):
   - a graph whose 20 top-ranked files import nothing and whose next 20 do yields **20** chains —
     the regression test for the whole hypothesis, and it fails against today's rule;
   - no returned chain is a prefix of another, on a graph built to tempt it (a root that is also the
     second file of another chain);
   - a chain reaches 5 files when the graph allows one;
   - a junk-path root is not seeded, and a root with no out-edge is not seeded;
   - the fake repository records **exactly two** calls — `getEdges` once, `getRankedPaths` once with
     `100_000` — proving R21 from the module's own side.
   *Check:* `cd server && pnpm exec vitest run repo-intel-critical-paths` is green, and red when
   step 2 is reverted.

---

### P3 — Generation: the budget, the clock, the chains block, the task details

**Agent:** implementer · **Depends on:** P1, P2

**Owns:**
- `server/src/modules/onboarding/constants.ts`
- `server/src/modules/onboarding/sizing.ts` (new)
- `server/src/modules/onboarding/generation-types.ts`
- `server/src/modules/onboarding/prompt.ts`
- `server/src/modules/onboarding/helpers.ts`
- `server/src/modules/onboarding/generate-executor.ts`
- `server/src/modules/onboarding/types.ts`
- `server/src/modules/onboarding/service.ts`
- `server/src/prompts/onboarding.system.md`
- `server/test/onboarding-sizing.test.ts` (new), `onboarding-generate.test.ts`,
  `onboarding-grounding.test.ts`, `onboarding-prompt.test.ts`, `onboarding-service.test.ts`,
  `onboarding.it.test.ts`

**Contract:** § *The shared contract* above, in full — P1's contract fields, P2's two exported
constants, and the seam.

**Steps**

1. **Add the sizing constants and delete the two they replace** (R22, R25). The five new constants
   go in `constants.ts` with the file's own one-constant-one-reason docstring style; each anchor is
   in the spec and must be cited by number, not restated as taste: the floor is
   `SPEC-04 § D11` (24 000 is the only budget this feature has a green run behind, 23 481 measured),
   the ceiling is `§ D11`'s derivation table (≈50 700 is the full request of every input at today's
   caps, so above 50 000 there is nothing to buy), the ramp denominator is `§ D22` (the request
   saturates long before the index reaches `MAX_INDEXED_FILES`), and the clock pair is `§ D12`
   (4,47 ms per input token measured, 50 000 tokens ≈223 500 ms, 300 000 leaves 34 %).
   **`ONBOARDING_TOKEN_BUDGET` and `ONBOARDING_TIMEOUT_MS` are deleted, and what they carried moves
   with them:** the first was the ceiling the assembled input is measured against before the call
   (`generate-executor.ts:292`) and the value stamped on `draft.budget` (`:215`); the second was
   **two** things — the `timeoutMs` handed to `completeStructured` (`:182`) and the `withTimeout`
   bound around it (`:188`) — and both call sites take the computed clock.
   *Check:* by the end of this package, `rg 'ONBOARDING_TOKEN_BUDGET|ONBOARDING_TIMEOUT_MS' server/`
   returns nothing — `server/test/onboarding-generate.test.ts` imports both today and is moved off
   them in step 11, so this step leaves the package red on purpose until then.
2. **Write `sizing.ts`** (R22, R25) — two exported pure functions, exactly the formulas in the
   contract block, importing `constants.ts` and nothing else. It is Core by `onion-architecture` §1:
   no I/O, no clock, no framework. Clamp `filesIndexed` at both ends, `Math.round` the result, and
   say in the docstring why the two functions live in one file — the clock is a function **of the
   budget**, so writing them apart is how they drift.
   *Check:* `cd server && pnpm arch` passes.
3. **Thread `filesIndexed` through the seam** (R22, R24). Add it to `OnboardingGenerateInput`
   (`types.ts:74-77`), to the executor's inline input type (`generate-executor.ts:137`), and pass
   `index.filesIndexed` from `service.ts:182` — the value the gate read at `:154`, which is the same
   object `toIndexState(index)` stamps as `index_state` at `:222`, so R24's two numbers agree by
   construction rather than by a second read. Do **not** add `getIndexState` to
   `OnboardingGenerationContainer`; extend that docstring instead with one line saying the number
   arrives as a parameter and why that keeps the port unable to express indexing.
   *Check:* `cd server && pnpm typecheck` passes; `generation-types.ts` still names three
   `repoIntel` methods.
4. **Use the computed budget and clock, and record what happened** (R23, R25, R26, R27, R28, R29).
   In `generate-executor.ts`: compute `budget = budgetForIndex(input.filesIndexed)` and
   `timeout = timeoutForBudget(budget)` before `fitToBudget`; pass `budget` into `fitToBudget` as a
   parameter rather than reading a constant there; hand `timeout` to both clocks; measure the call
   with a monotonic `Date.now()` pair around `withTimeout` and put it on `draft.duration_ms`; stamp
   `draft.budget = budget` and `draft.system_tokens = count(system)`. Wrap the call so a **thrown**
   timeout still logs — `log.warn({ repoId, budget, durationMs, filesIndexed }, 'onboarding tour: the model call missed its clock')` — and then re-throws unchanged, so `service.ts` still leaves the
   previous tour untouched (R26). Add `budget`, `durationMs` and `filesIndexed` to the existing
   success log line at `:238`.
   *Check:* `input_tokens_counted <= budget` still holds as an equality-grade bound; the timeout
   path writes nothing.
5. **Offer the chains one at a time** (R20, R17, R30). In `prompt.ts`, replace the single
   `critical_paths` block with one block **per chain**: same `## Critical path chains` heading, a
   fence label of `chain-<n>` where `n` is the chain's 1-based ordinal, and a body of
   `<n>. a -> b -> c` so the numbering the model sees is stable across blocks. `buildInputBlocks`
   may now return more than one block carrying `id: 'critical_paths'` — which is what makes
   `buildCandidates` need no special case at all, since it already maps every returned block to its
   own candidate. Add `critical_paths: 'chains'` to `SPLIT_INPUT_NOUNS`
   (`generate-executor.ts:458`) so `detail` reads `20 of 20 chains`. Set
   `draft.chains_supplied = sources.chains.length` and
   `draft.longest_chain_files = max(chain.length)`.
   **Say in the docstring what this costs:** each per-chain block repeats the heading and the fence,
   roughly 20 tokens against a chain's ~50, so 20 chains cost ≈1 400 rather than the ≈1 000 `§ D2`
   estimated. On this repository that leaves ≈1 600 tokens of slack instead of ≈2 000 and all 19
   samples still ship — which is why AC-41 asks for 18 of 19 and not 19.
   *Check:* `inputs[]` still has exactly five rows, in `OnboardingInputId` order; the
   `critical_paths` row reads `N of M chains`.
6. **Name what did not ship** (R30). In `inputRow` (`generate-executor.ts:482-509`), fill
   `omitted` with the labels of the candidates whose status is `dropped` — the sampled path, the
   document path, the chain label — and `shortened` with the paths of the documents whose
   `docShortened` is true. Leave `detail` exactly as it reads today: the string is what the screen
   draws (`InputStates.tsx:71-73`) and a list of six paths inside it is a different design decision
   (Recommendation 1). For an input with a single candidate both arrays stay empty.
   *Check:* a run where a document is shortened and a sample dropped produces `shortened: ['…']`
   and `omitted: ['…']`, and the arrays are empty for `repo_map`.
7. **Ask the model for the task details** (R2, R3, R4, R12). In `prompt.ts`, extend the `tasks`
   member of `OnboardingResponse` with `steps` (`text`, `path` nullable, `command` nullable),
   `impact` and `verification`, each with a `.describe()` — and **no bound of any kind**, because
   `toJsonSchema` renders one and Anthropic's subset rejects it. In
   `server/src/prompts/onboarding.system.md`, extend the `tasks` bullet: each step is one action;
   `path` is a file from the input or `null`; `command` must be a command **you also wrote in
   `run` or `setup_commands` for this repository**, copied character for character, or `null`;
   `impact` says what the change touches; `verification` says how the reader will see it is done.
   Extend the `# Numbers` section to name the three new fields explicitly (R12).
   *Check:* `cd server && pnpm exec vitest run onboarding-prompt` is green, including an assertion
   that the rendered system prompt states the no-quantity rule for the new fields.
8. **Ground the task details** (R6, R7, R8, R33). In `helpers.ts`:
   - add `MAX_TASK_STEPS` to the caps block with its anchor — the spec's own edge case, "one path
     repeated in twenty steps", says grounding by membership is not a bound on the answer
     (`server/INSIGHTS.md`), so the number is this plan's: **6**, the same shape as
     `MAX_COMMANDS_PER_PACKAGE`, and it bounds what a first task can be asked to do in a week;
   - in `groundOnboarding`, **move `groundTasks` to after `groundRun` and `groundSetupCommands`** and
     hand it the set of grounded commands — every `packages[].commands[].command`, every non-null
     `packages[].install_command`, every `setup_commands[].command`. That order is the requirement,
     not a preference: AC-7 defines the allowed set as what "How to run" already grounded, so a task
     grounded first would be checked against an empty set;
   - per step: `text` through `line()` (R33 — the same `MAX_LINE_CHARS` every other single-line field
     uses); `path` through `verifiedPath()`, which on failure returns `null` **and increments
     `unknown_path`** while the step itself is kept as text (R6 — the spec is explicit that "add a
     guard to the error handler" is useful without a clickable path); `command` kept only when the
     grounded set contains it verbatim, else set to `null` and `unknown_script` incremented (R7);
   - `impact` and `verification` through `line()`;
   - `steps.slice(0, MAX_TASK_STEPS)`, and `tasks.slice(0, MAX_TASKS)` with `MAX_TASKS` now 6 (R13);
   - **nothing scans a step's `text` for paths.** The only linkable path is the structured field,
     which is what makes R8 true by construction rather than by a second path vocabulary.
   *Check:* `cd server && pnpm exec vitest run onboarding-grounding` is green, and the three attacks
   below still come out dropped.
9. **Probe the new claims, and raise the ceiling that bounds them** (R6). Add task step paths to
   `collectClaimedPaths` (`helpers.ts:364-385`), immediately after `task.path` and **before** the
   prose tokens — the order in that function is the probe order and its docstring says so. Raise
   `MAX_PATH_PROBES` 120 → 200 and re-anchor its docstring on the supply that now feeds it: the
   chains alone can carry `CRITICAL_PATH_CHAINS × (1 + BFS_DEPTH)` = 100 distinct paths, and a
   ceiling below the claims a grounded answer can legitimately contain turns a real file into
   `unknown_path` — corrupting the exact counters this feature's evidence is read from.
   *Check:* a hostile-response test whose claims exceed the ceiling still stops probing, and the
   `probes` number is on the audit.
10. **Hold the two numbers that cannot import each other** (R18). Set `MAX_FLOWS = 20` and restate
    its docstring: it was anchored one below `CRITICAL_PATH_ROOTS`, and the anchor is now AC-22 —
    the display ceiling may never be below the supply. Leave `MAX_FLOW_STEPS = 6` and correct its
    docstring: the longest chain is now `1 + BFS_DEPTH` = 5 files, so 6 still lets a flow walk a
    whole chain and still bounds one that repeats a single path. In
    `server/test/onboarding-generate.test.ts` add the cross-module assertion — importing
    `CRITICAL_PATH_CHAINS` from `repo-intel/constants.js` and `MAX_FLOWS` from
    `onboarding/constants.js` and asserting `MAX_FLOWS >= CRITICAL_PATH_CHAINS`. A **test** may
    import both; `src` may not, and this is the `REPO_MAP_TOKEN_BUDGET` precedent.
    *Check:* the assertion fails when either number moves alone.
11. **Test the sizing and the record** (R22, R23, R24, R25, R26, R27, R28, R29, R31, R37). New
    `server/test/onboarding-sizing.test.ts`: floor at 0 files, ceiling at and above 2 000,
    **32 528 at 656**, monotonicity across a swept range, the clock at both ends and its
    monotonicity, and that `timeoutForBudget` never returns more than 300 000. In
    `onboarding-generate.test.ts`: the call's `timeoutMs` and the `withTimeout` bound both equal
    `timeoutForBudget(budgetForIndex(filesIndexed))`; `draft.budget`, `draft.system_tokens`,
    `draft.duration_ms`, `draft.chains_supplied` and `draft.longest_chain_files` carry the right
    values; `input_tokens_counted <= budget`; and a test that pins R37 by asserting
    `SAMPLE_FILE_COUNT`, `MAX_FILE_CHARS` and `MAX_DOC_CHARS` are unchanged **and** that no sizing
    function is reachable from the gather — the budget bounds what ships, never what is read. The
    existing timeout test at `:608` keeps its shape and moves to the computed clock.
    *Check:* `cd server && pnpm exec vitest run onboarding` is green.
12. **Extend the integration suite** (R26, R32, R35). In `server/test/onboarding.it.test.ts`: assert
    the existing foreign-repo 404 body carries no `tasks`, no `path` and no step (R35); add a case
    where a stored pre-SPEC-04 document round-trips through `GET` with `steps: []`, `impact: ''`
    and `verification: ''` (R32); keep the "generation failed leaves the previous row" case and add
    that the row is byte-identical after a timeout (R26).
    *Check:* `cd server && pnpm exec vitest run .it.test` is green with Docker up.

---

### P4 — The task detail window

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/_components/FirstTasksSection/**`
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/_components/TaskDetailDialog/**` (new)
- `client/messages/en/onboarding.json`
- `client/src/i18n/onboarding-messages.test.ts`
- `client/src/lib/hooks/onboarding.ts` (one comment, no code — step 6)

**Contract:** P1's contract fields, in full — `OnboardingTask` now carries `steps`, `impact` and
`verification`, and `OnboardingTaskStep` is `{ text, path: string | null, command: string | null }`,
re-exported from `@/lib/types`. Every path in `steps[].path` is already proven to exist and every
`steps[].command` is already grounded; **the client re-checks neither** — it is the `stale`
precedent (`docs/onboarding-tour.md` § *What the client reads and never recomputes*). What the
client still owns is `fileHref`, which asks a different question: whether a proven path is safe
inside a URL.

**Steps**

1. **Place the dialog and decide what owns the URL** (R10). `TaskDetailDialog/` goes **beside**
   `FirstTasksSection/` under `OnboardingTourView/_components/`, not nested inside it: it needs
   `CommandRow`, `FileRef` and `ComplexityBadge`, all siblings there, and a nested folder would
   reach them through `../../../`. It has one consumer, which is `frontend-architecture`
   principle 2's floor, not a reason to promote it further. `FirstTasksSection` owns the URL state,
   because it owns the list the parameter names.
   *Check:* no new `../../../` import and no new aggregating barrel; the folder carries
   `TaskDetailDialog.tsx`, `styles.ts`, `index.ts`, `hooks/useFocusTrap.ts` and its tests.
2. **Write `useFocusTrap`** (R11) at `TaskDetailDialog/hooks/useFocusTrap.ts` — a hook with state
   and no API call, which is what puts it under the owner rather than in `src/lib/hooks/`. It takes
   the container ref and `onClose`, and on mount: records `document.activeElement`, moves focus into
   the container, listens for `keydown` on the container for `Escape` (close) and `Tab` (cycle
   between the first and last focusable descendants, both directions), and on unmount restores focus
   to the recorded element. Nothing here is a `window` listener — a page-level `keydown` would fire
   for a reader typing anywhere on the tour. There is no such hook in this repository today and
   `vendor/ui/kit/Modal.tsx` provides none, so do not reach for one.
   *Check:* the hook calls a hook (it is not a pure function wearing a `use` prefix), and its own
   test drives Tab from the last control back to the first.
3. **Write `TaskDetailDialog`** (R2, R3, R4, R5, R11, R34). Props: `task: OnboardingTask`,
   `repoFullName`, `indexSha`, `onClose` — and **nothing else about the task**, which is what makes
   R5's second half structural: a field absent from the contract cannot be drawn because it is not
   in the props. It renders an overlay plus a
   `role="dialog" aria-modal="true" aria-labelledby="<id of the title heading>"` container whose
   heading is `task.title` (R11 — the accessible name names the task, never the element type);
   `FileRef` for `task.path`; `ComplexityBadge`; `task.why`; an **ordered** `<ol>` of steps, each
   step's `text` as plain React text, its `path` through `FileRef` when non-null, its `command`
   through `CommandRow` when non-null; then `impact` and `verification`, each omitted entirely when
   `''`. No `dangerouslySetInnerHTML`, no markdown renderer, no run control anywhere (R34 —
   `security` § A05, and the page has never had a run control: `CommandRow.tsx:13-16`).
   *Check:* rendering a task whose `impact`, `verification`, `steps[].path` and `steps[].command`
   are all empty or null draws no empty heading and invents nothing.
4. **Open it from the card, and put it in the URL** (R1, R9, R10, R13). In `FirstTasksSection`:
   - the task title becomes a `<button>` carrying `aria-haspopup="dialog"` — the card itself must
     not be the button, because it contains the `FileRef` link and nesting interactive elements is
     invalid. A task with `steps.length === 0` renders the title as the plain `<h3>` it is today,
     with no control at all (R1);
   - **delete the disclosure**: `TASKS_SHOWN`, its `constants.ts`, the `<details>` branch, the
     `more`/`moreGrid` style keys and the `tasksHidden` message key all go, and every task the tour
     carries is drawn. `MAX_TASKS` is now 6 and this is what makes R13 true by construction rather
     than by two numbers agreeing across two packages. **What dies with it, said plainly because
     the file that carried it is being removed:** AC-34 of SPEC-03 required the tasks past the
     sixth to sit behind one control **carrying how many** — never dropped silently. SPEC-04 D15
     reverses that on purpose: six tasks are stored, six are shown, and there is nothing left to
     disclose, so the guarantee is met by there being no hidden task rather than by a counted
     control. A tour saved before this change may still hold twelve; the section draws all of them
     rather than hiding six with no way to say so;
   - the open task is `?task=<encodeURIComponent(task.path)>` read with `useSearchParams`; the open
     task is the **first** task whose `path` equals the decoded value, derived during render and
     never copied into state; no match means no dialog and no error (R10);
   - opening and closing both use `router.replace(..., { scroll: false })`, never `push` — one
     `pushState` per opened task fills the back button with places nobody asked to go, which is the
     rule `OnboardingTourView.tsx:13-16` already states for the section fragment. **Carry the
     current hash across explicitly**: the rail and `Share link` live in `window.location.hash`, and
     a `replace` built from pathname and query alone silently drops it.
   *Check:* `Share link` still copies a URL naming a section, and now also the open task, with no
   change to `shareUrl` — the parameter rides along because it copies `window.location.href`.
5. **Add the message keys** (R5). `task.steps`, `task.impact`, `task.verification`, `task.why`,
   `task.close` — English, like every interface string here, while the tour body stays Ukrainian
   (`docs/onboarding-tour.md` § *Bilingual, on purpose*). Remove `tasksHidden` **and its case in
   `client/src/i18n/onboarding-messages.test.ts:51-54`**, which is the one consumer outside this
   folder and the only thing that would otherwise fail on the deletion. None of the five new keys
   is countable, so nothing is added there.
   *Check:* `rg tasksHidden client/` returns nothing; `cd client && pnpm test` is green.
6. **Correct the one comment outside this folder that names the old clock** (R25).
   `client/src/lib/hooks/onboarding.ts:66-68` says there is deliberately no `AbortSignal` and no
   client-side timeout "because the generation legitimately holds the connection for up to 180 s".
   The decision is unchanged and the number is not: say up to 300 000 ms, and keep the reason —
   a client that gives up first pays for a model call it then throws away, and the cost of that has
   just gone up. Change no code in this file.
   *Check:* `rg '180 s|180s' client/src` returns nothing about this feature.
7. **Test it** (R1, R2, R3, R4, R5, R9, R10, R11, R13, R34) in
   `FirstTasksSection.test.tsx` and `TaskDetailDialog.test.tsx`, with `fireEvent` — `user-event` is
   not installed here (`client/INSIGHTS.md:1303-1318`) — and `vi.mock("next/navigation", …)` for
   `useSearchParams`/`useRouter`, the pattern `ProjectContextView.test.tsx:16` uses:
   - clicking a task's title opens a dialog whose accessible name is that task's title, and the
     dialog is scoped with `within(screen.getByRole("dialog"))` for every inner query — two
     "Close"-like controls on one screen is the ambiguity `client/INSIGHTS.md:1826-1838` records;
   - a task with no steps renders no button;
   - Esc closes it and focus returns to the title button; Tab from the last control lands on the
     first;
   - a step with a null `path` renders its text with no link; a step with a null `command` renders
     no `<code>`; a step with both renders both;
   - `?task=` naming a path no task carries renders the section with no dialog and no error;
   - nine tasks render nine cards and **no** disclosure control;
   - opening the dialog issues nothing (R9): the section and the dialog import no hook from
     `@/lib/hooks/**` and no `fetch`, so the check is structural — assert it with a `vi.mock` of
     `@/lib/hooks/onboarding` whose factory throws if any export is touched, and open a task.
   *Check:* `cd client && pnpm test` and `cd client && pnpm lint` are green.

---

### P5 — The documentation the numbers live in

**Agent:** implementer · **Depends on:** P3, P4

**Owns:** `docs/onboarding-tour.md`

**Contract:** the final numbers, as they shipped — not as this plan predicted them.

**Steps**

1. **Correct every number this change moved** (R14, R18, R22, R25, R13). `docs/` holds how the
   system already works, and this file states the ones that are about to be wrong: "24 000 tokens"
   and "180s timeout" in the pipeline diagram, "one document and one sample at a time" (now also one
   chain), "four flows" in § *Grounding*, the twelve stored tasks implied by § *Package rendering*'s
   neighbourhood, and the `Where to look` row about generation constants. Add two sentences to
   § *Fitting the budget, then one call*: the budget and the clock are now functions of
   `files_indexed`, with the formula and this repository's own pair (656 → 32 528 → 219 360 ms).
   *Check:* `rg '24 000|180 000|180s' docs/onboarding-tour.md` returns nothing stale.
2. **Add the task window to § *Grounding*** (R6, R7): a step's path is grounded exactly as every
   other path, and a step's command must be one the "How to run" section already grounded — the
   fourth item in a list that already has three, and the reason the grounding order in
   `groundOnboarding` is now `run` → `setup` → `tasks`.
   *Check:* the section names the new claim kinds and their counters.

---

**Dispatch order.**

1. **Wave 1 — P1 and P2 in parallel.** They share no file: P1 is the two vendored contracts plus
   two contract tests, P2 is `repo-intel` plus one new test. P2 carries the measurement, so it
   starts first if anything has to be sequenced by a human.
2. **Gate between the waves.** P3 cannot start before P1 has landed (it consumes the contract
   fields) and before P2 has landed (its cross-module test imports `CRITICAL_PATH_CHAINS`). P4
   cannot start before P1.
3. **Wave 2 — P3 and P4 in parallel.** They share no file: P3 is `server/`, P4 is `client/src/app`
   and `client/messages`. P1 already owns both vendored copies and `client/src/lib/types.ts`, so
   neither wave-2 package touches a contract.
4. **P5 last**, after both have landed, because it records what shipped.

## Tests

Unit, everywhere, and integration for the two routes and the row. No e2e (N8), no new flow file.

| Suite | Files | Command |
|---|---|---|
| Contract | `server/test/onboarding-contract.test.ts`, `server/test/contracts.test.ts` | `cd server && pnpm exec vitest run onboarding-contract contracts` |
| Supply | `server/test/repo-intel-critical-paths.test.ts` (new) | `cd server && pnpm exec vitest run repo-intel-critical-paths` |
| Sizing | `server/test/onboarding-sizing.test.ts` (new) | `cd server && pnpm exec vitest run onboarding-sizing` |
| Generation, prompt, grounding, service | `server/test/onboarding-generate.test.ts`, `onboarding-prompt.test.ts`, `onboarding-grounding.test.ts`, `onboarding-service.test.ts` | `cd server && pnpm exec vitest run onboarding` |
| **Integration** — required, not optional | `server/test/onboarding.it.test.ts` | `cd server && pnpm exec vitest run .it.test` |
| Client | `TaskDetailDialog.test.tsx` (new), `TaskDetailDialog/hooks/useFocusTrap.test.ts` (new), `FirstTasksSection.test.tsx` | `cd client && pnpm test` |

**The three attacks stay dropped, and a test asserts each by name.** `groundSetupCommands`,
`groundRun`, `runsScript`, `groundInstall`, `SAFE_COMMAND_TOKEN` and `setupCommandIsAuthorised`
closed four holes and one revert on 2026-08-18, and P3.8 runs beside them. In
`onboarding-grounding.test.ts`, keep or add one case each:
`pnpm install evil-pkg` (dropped, `manager_mismatch`), `pnpm dlx evil-cli dev` (dropped,
`manager_mismatch`), `cp .env.example server/src/index.ts` (dropped, `unknown_path`) — and one
more for the new surface: a task step naming `pnpm dlx evil-cli dev` has its command removed and
`unknown_script` incremented, because the string is not in the grounded set.

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`. Every touched module runs its own.

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

Plus, **required by this plan and deliberately outside Track A** (it needs testcontainers, and
`gates.md` says CI owns it): `cd server && pnpm exec vitest run .it.test`. The routes and the row
are not accepted without it.

`reviewer-core/` is untouched, so its two gates skip. `skip` is not `ok`.

## Risks (from INSIGHTS.md)

| Risk, quoted | What this plan does |
|---|---|
| *"The last input of a budget walk is all-or-nothing unless it is offered item by item"* — and its 2026-08-18 addendum: splitting changes what a starved input **does**, not whether it is starved; that is the ORDER, stated in three places that must agree | P3.5 splits the chains per item (R20) **and** leaves the order untouched. The three places — `OnboardingInputId`, `buildInputBlocks`, `buildCandidates` — are named in `## Constraints` and `project_docs` stays above `file_samples` |
| *"`inputs[].detail` is where a per-item cap becomes observable, and it is easy to leave null"* — compare by CODE POINT, `[...text].length`, never `.length` | P3.6 reuses the existing `docShortened` flag rather than recomputing; nothing new compares string lengths |
| *"A grounding gate only ever fires on what the 4 000-character doc cap left standing"* — `README.md` names `scripts/dev.sh` at character 4 484, past the cut | Out of scope by N12 and R37. Named here so nobody "fixes" it inside this change and so P3.6's `shortened` array is understood as the visibility half of it |
| *"Grounding by membership is not a bound on the answer"* — one allowed path repeated four hundred times passes a membership filter four hundred times | `MAX_TASK_STEPS = 6` in P3.8 exists for exactly this, and the spec's own edge case demands it |
| *"Anthropic's structured-output API rejects a Zod schema that states a bound"* | P3.7 states no bound on the new response fields; every cap is applied after the parse in P3.8 |
| *"A jsonb column is untyped input: parse it on read, or `.default()` never fires"* — a field added without one turns every previously saved tour into "press Generate" | P1.2 gives all seven new fields defaults; P1.5 pins it with an old-shaped document; P3.12 pins it again through the real route |
| *"A budget measured before an escape is not a budget"* — 9 202 tokens shipped against a stated 8 000 | P3.4 changes only the budget's **value**; the measurement path is untouched, and the equality `input_tokens_counted <= budget` stays a test |
| *"With fenced inputs, `selectWithinBudget` decides WHICH block is cut and never how"* | P3.5 adds candidates and touches neither `truncateBlockToBudget` nor the walk |
| *"`#` is not a comment in the shell the reader is actually in"* and *"Checking a command's two ends is not checking the command"* | P3.8 adds no command syntax at all — a step's command must be **verbatim** one already grounded, so the new surface inherits every existing gate and can weaken none |
| *"A test for 'the cap counts matches' is not proved by the red run that motivated it"* | P2.4's first case must be shown red against today's rule, not merely green against the new one |
| *"`@testing-library/user-event` is not installed here — every test uses `fireEvent`"* | P4.6 says `fireEvent` outright |
| *"A confirmation dialog over an editor makes `getByRole('button', { name: 'Cancel' })` ambiguous"* | P4.6 scopes every inner query with `within(screen.getByRole("dialog"))` |
| *"jsdom has no `Element.prototype.scrollIntoView`"* | P4.4 adds no scroll; the existing `?.` call is untouched |
| *"A `fireEvent.click` on a handler that awaits a mutation warns 'not wrapped in act(...)'"* | The dialog awaits nothing — R9 forbids it — so no test needs a `waitFor` for this reason |
| *"A scratch script that exercises server code against a real clone must be `.mts`, not `.ts`"* and *"the script may import server files only"* | Both stated inside P2.1, where the measurement is run |

## Alternatives rejected

- **Widening `OnboardingGenerationContainer` with `getIndexState`** to let the generator read
  `files_indexed` itself. Rejected: that port is deliberately unable to express indexing or to read
  the index state (`generation-types.ts:36-43`), and the value is already in the service's hand at
  the gate. A number passed as a parameter costs one field; a widened port costs the property.
- **Adding an options parameter to `getCriticalPaths(repoId, { chains, depth })`** so onboarding
  chooses its own supply. Rejected: `no-cross-module` means onboarding would restate the widened
  signature in `generation-types.ts` and the two would have to agree across a boundary neither can
  see — the failure mode `REPO_MAP_TOKEN_BUDGET` already had once. The numbers live in `repo-intel`
  and a test holds `MAX_FLOWS` against them.
- **Raising `CRITICAL_PATH_ROOTS` from 5 to 20 and stopping there.** Rejected before it was tried,
  and the spec says why: rank rewards being imported while the walk follows the other direction, so
  twenty roots can be twenty chains of length 1, all discarded. P2.1 measures it rather than
  assuming either outcome.
- **Keying the URL parameter on the task's index** (`?task=3`). Rejected: after a regeneration index
  3 still exists and opens a *different* task with no signal, so AC-57's failure branch would almost
  never fire. Keying on `path` makes "this task is gone" observable, which is what the criterion is
  for. The cost, named: two tasks sharing one path are one link, and the first wins.
- **Naming the omissions inside `detail`** (`"18 of 19 files (omitted: x.ts)"`). Rejected: `detail`
  is drawn on screen (`InputStates.tsx:71-73`), so six paths would land in the interface as a side
  effect of a record change. Structured arrays keep R30 in the record, where D18 put it, and leave
  the screen a separate decision (Recommendation 1).
- **A modal built on `vendor/ui/kit/Modal.tsx`.** Rejected: it is vendored and must not be edited,
  it has no Esc, no focus trap and no focus restore, and it exposes no way to set an accessible name
  — three of R11's four criteria cannot be met through it.
- **Rendering the step text as markdown.** Rejected: it is model prose over an imported repository,
  and a renderer is a second path for a link to appear that grounding never approved (R8, R34).

## Verification

Run in order. The last line is the feature through its real entry point.

1. `cd server && pnpm exec vitest run onboarding-sizing` — the budget is 24 000 at 0 files, 32 528 at
   656, 50 000 at and above 2 000, monotone in between; the clock is 180 000 / 219 360 / 300 000 at
   the same three points and never above 300 000. **R22, R25.**
2. `cd server && pnpm exec vitest run repo-intel-critical-paths` — 20 chains where today's rule
   returns few or none, a 5-file chain, no chain a prefix of another, no junk root, no root without
   an out-edge, and exactly two repository calls. **R14, R15, R16, R21.**
3. `cd server && pnpm exec vitest run onboarding` — the grounded task keeps a step whose path failed
   as plain text with `unknown_path` incremented; a step command outside the grounded set is removed
   with `unknown_script` incremented; the three named attacks stay dropped; `MAX_FLOWS >=
   CRITICAL_PATH_CHAINS`; `input_tokens_counted <= budget`; the selection ceilings are unchanged.
   **R6, R7, R12, R18, R19, R23, R33, R37.**
4. `cd server && pnpm exec vitest run onboarding-contract contracts` — a pre-SPEC-04 document parses
   with `steps: []`, `impact: ''`, `verification: ''` and zeroed counts. **R32.**
5. `cd server && pnpm exec vitest run .it.test` — the foreign-repo 404 reveals no task, path or
   step; a timed-out generation leaves the stored row byte-identical. **R26, R35.**
6. `cd client && pnpm test` — the dialog opens from a title button and not from a task with no
   steps; its accessible name is the task title; Esc closes it and focus returns; Tab cycles;
   `?task=` naming an absent path renders the tour with no dialog and no error; nine tasks draw nine
   cards and no disclosure; no request is made by opening it. **R1, R2, R3, R4, R5, R9, R10, R11,
   R13, R34.**
7. `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing. **R32.**
8. **One real generation, through the button.** With `./scripts/dev.sh` up, open
   `/repos/<id>/onboarding` for `Holubinka/dev-digest` and press *Regenerate*. Then read the stored
   record (`GET /repos/<id>/onboarding`) and check, from the record and the screen:
   - `budget` = 32 528 and `index_state.files_indexed` = 656 — **R24**;
   - `inputs[]` — `file_samples` reads **≥18 of 19**, `project_docs` reads **7 of 7** — **R31**;
   - `inputs[].omitted` and `.shortened` name what did not ship, by path — **R30**;
   - `chains_supplied` ≥ 20 and `longest_chain_files` = 5 — **R17**, and this is also where R14's
     hypothesis is finally answered on real data;
   - the critical-paths section draws every grounded flow — **R18**;
   - `duration_ms` is present and below the computed clock, and `system_tokens` is present and
     smaller than the sum of `inputs[].tokens` — **R26, R28, R29**;
   - `tasks.length` ≤ 6 and the page shows all of them with no "show more" — **R13**;
   - six tasks carry `steps`, `impact` and `verification`; clicking one opens the window; the URL
     gains `?task=`; reloading that URL reopens the same window — **R1, R2, R3, R4, R10**;
   - the five drop counters are read and reported as they came out. They were all zero before this
     change; a non-zero `unknown_script` now is the new surface's most likely failure and is worth a
     line in the report either way;
   - `cost_usd` is recorded. Multiply by 50 000 / 32 528 for the ceiling case and state the number:
     it must be ≤ $0.02 — **R36**. Do **not** generate a second tour to measure it.

## Open questions

_None._

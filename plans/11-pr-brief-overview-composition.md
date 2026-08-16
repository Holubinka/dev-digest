# 11 — PR Brief on Overview: the composition the design asks for

**Status:** Planned 2026-08-16
**Scope:** server · client
**Modules touched:** `server/src/vendor/shared/contracts`, `server/src/db` (schema · migrations · seed), `server/src/modules/brief`, `server/src/modules/reviews`, `client/src/vendor/shared/contracts`, `client/src/lib`, `client/src/app/repos/[repoId]/pulls/[number]`, `client/messages/en`
**Requirements source:** `specs/SPEC-02-pr-why-risk-brief.md` § AC-46…AC-76 (the amendment of 2026-08-16) and the mockup it cites, `specs/assets/SPEC-02-pr-brief-overview.png`
**Execution:** multi-agent
**Predecessor:** `plans/10-pr-why-risk-brief.md` — round one (AC-1…AC-34, AC-41…AC-45) is implemented. This plan is the **delta only**: it re-plans nothing round one already built except where the amendment moves it.
**Reviewed:** cross-model, verdict FIX-FIRST, 2026-08-16. All four findings applied in this revision — the account is `plans/11-pr-brief-overview-composition-cross-model-review.md`.

This plan was written with the mockup open. Where it deliberately departs from the picture, the
departure is named at the step and again under `## Verification`.

## Requirements as understood

`R#` follows the spec's AC numbers in ascending order: R1 = AC-46 … R31 = AC-76. AC-1…AC-45 are
accounted for under `## Out of scope`.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | The Overview card row holds **exactly two** cards — INTENT and BLAST RADIUS. No brief card in the row. | `specs/SPEC-02-pr-why-risk-brief.md § AC-46` | clear |
| R2 | The brief's `risks[]` are shown as a "Risk areas" section **inside** the INTENT area, under the intent and the in/out-of-scope columns. Up to **5** rows are shown; the rest sit behind a disclosure carrying the hidden count. | `§ AC-47`, NFR "Ризиків у секції «Risk areas»" | clear |
| R3 | `review_focus[]` is its own **full-width** section under the card row, with the **full** count in its heading. Up to **10** rows are shown; the rest sit behind a disclosure, so the truncation is never silent. | `§ AC-48`, NFR "Пунктів review focus" | clear |
| R4 | Banner, card row and review-focus section stand under one section heading, "PR Brief". | `§ AC-49` | clear |
| R5 | While the brief is absent or computing, INTENT and BLAST RADIUS stay fully rendered; the brief's own places carry their own progress or empty state without disappearing or resizing their neighbours. | `§ AC-50` | clear |
| R6 | Below the two-column width the areas stack in the order banner → INTENT (with risks) → BLAST RADIUS → REVIEW FOCUS. | `§ AC-51`, NFR "Ширина, за якої розкладка стає одностовпцевою" (1024 px) | clear |
| R7 | Every risk row carries an icon chosen from a **finite** dictionary keyed by `Risk.kind`. | `§ AC-52` | clear |
| R8 | A `Risk.kind` with no dictionary entry gets the default icon — never an empty slot or a shifted row. | `§ AC-53` | clear |
| R9 | A risk row shows level, title and references always; the explanation is behind a disclosure reachable from the keyboard. | `§ AC-54` | clear |
| R10 | The "Risk areas" section is fed by the brief's `risks[]`, **not** by `Intent.risk_areas`. | `§ AC-55`, D18 | clear |
| R11 | A review-focus item shows its reference and its reason on one line, the reason always visible. | `§ AC-56` | clear |
| R12 | The `RiskBrief` schema carries no line-number field, and no displayed number comes from model text. | `§ AC-57` | clear |
| R13 | A `file_ref` / `ref` ending in `:<n>` or `:<n>-<m>` has that suffix cut **before** the membership check, and the number itself is discarded. | `§ AC-58` | clear |
| R14 | A reference admitted to the allowed set **through the blast answer** shows a line number taken from that same blast answer, and from nowhere else. | `§ AC-59` | clear |
| R15 | A reference admitted any other way (changed file, spec path) is shown with no line number — no guess, no `pr_files.patch` read, no placeholder. | `§ AC-60` | clear |
| R16 | When `index_matches_head` is false or `link_sha` is null, **no** brief reference shows a line and none navigates to one. | `§ AC-61` | clear |
| R17 | Every brief reference has one visual form: a mono path with a `:<line>` suffix where the number is known and valid, and without one where it is not. No placeholder. | `§ AC-62` | clear |
| R18 | Activating a reference that carries a line lands on that file **and that line** in Files changed, in **one** URL write. | `§ AC-63`, `§ AC-5` | clear |
| R19 | `Risk.file_refs` and `ReviewFocusItem.ref` keep their shapes; the line lives in a separate structure on the record; a record without it renders without numbers, with no data migration and no error. | `§ AC-64`, D20 | clear |
| R20 | The banner shows review data — verdict, findings and blocker counts, `PR SCORE`, the run's cost and tokens. The brief produces none of the five. | `§ AC-65`, D15, N9 | clear |
| R21 | With no completed review run for the current `head_sha` the banner says the state has not been reviewed, shows `PR SCORE` empty, and shows **neither** a verdict nor zero counters. | `§ AC-66` | clear |
| R22 | The brief writes no number into the `PR SCORE` slot; `risk_level` stays a three-value badge. | `§ AC-67`, D16, D11 | clear |
| R23 | The blocker counter shows the stored `agent_runs.blockers`, never a client-side recount of CRITICAL findings. | `§ AC-68` | clear |
| R24 | A completed run belonging only to a previous `head_sha` contributes neither verdict, nor `PR SCORE`, nor cost to the current state's slots. | `§ AC-69` | clear |
| R25 | Cost and tokens in the banner belong to the review run; the brief's own cost, where shown, has its own place and its own label, and the two are never summed. | `§ AC-70` | clear |
| R26 | The recompute action names the **brief** as its subject whatever prose stands beside it, and starts neither an intent derivation nor a review run. | `§ AC-71` | clear |
| R27 | An empty `review_focus` leaves the full-width section in place, with the count `0` and explicit text. | `§ AC-72` | clear |
| R28 | While no completed run exists for the current `head_sha`, the banner's prose slot carries the brief's `what` and `why`. | `§ AC-73`, D21 | clear |
| R29 | Once a completed run exists for the current `head_sha`, the prose slot shows that run's summary and `what`/`why` leave the screen — while staying in the record and in the route's response. | `§ AC-74`, D21 | clear |
| R30 | When a completed run exists only for a previous `head_sha`, the banner says a review exists for an earlier state of the PR. | `§ AC-75` | clear |
| R31 | The INTENT area shows the intent and the in/out-of-scope columns in **all** states of the prose slot. | `§ AC-76` | clear |
| R32 | The brief's provenance block (which inputs went in, which were truncated, which dropped) keeps a home in the new composition — the foot of the REVIEW FOCUS section — and carries the brief's own cost and token count there, labelled as the brief's. | assumed; `§ AC-33` (round one, must not regress) + `§ AC-70` | **assumed** |
| R33 | The "Risk areas" section renders in **every** INTENT state — including intent loading, intent error and no-intent-derived — because its producer is the brief, not the intent. | assumed; consequence of `§ AC-47` + `§ AC-50` | **assumed** |
| R34 | The seeded demo PR (#482) records the `head_sha` its seeded review describes, so a fresh install shows the banner in its reviewed state rather than in the never-reviewed one. | assumed; `db/seed.ts:110-152` + the mockup | **assumed** |

Three `assumed` rows, and each is a placement or fixture question the amendment did not answer.
They are the rows to overturn first if the human disagrees; nothing else in the plan depends on
them beyond one step each.

## Out of scope

**AC-1…AC-45 are not re-planned here.** They were planned by `plans/10-pr-why-risk-brief.md` and,
apart from AC-35…AC-40, built and verified in round one. Accounted for by number:

- **AC-1** — the "five fields are visible" half stays in force and is carried by R2, R3, R28, R29
  and R31. Its placement half ("one card among the Overview cards") is **superseded** by AC-46…AC-49
  and is therefore in scope, as R1–R4. The spec records the supersession under AC-1 itself.
- **AC-2, AC-3, AC-7, AC-16…AC-24, AC-27…AC-34, AC-41…AC-45** — implemented in round one; this plan
  changes neither their behaviour nor their code paths, except where a step below moves the surface
  they render on (see the table under `## What already exists`).
- **AC-4, AC-5, AC-8…AC-15, AC-25, AC-26** — implemented in round one and **relocated** by this plan.
  They are not re-planned as `R#`; the steps that move them say which one they must keep true.
- **AC-35…AC-40** — Why Timeline. Still deferred (plan 10, P4/P5). Untouched.

Also out of scope, by the spec's own boundaries:

- **N10** — "Prior PRs touching these files". Drawn on the mockup, decided against on 2026-08-16.
  The section is absent, and its absence is the decision.
- **N11** — a line **range** (`ratelimit.ts:12-18` on the mockup). Blast returns one `line`; the
  brief shows one line. Extending `BlastSymbol` belongs to the blast feature.
- **N8** — no MCP tool, no `e2e/specs/*.flow.json`.
- The BLAST RADIUS card's own contents (Tree/Graph switch, endpoint pills, caller tree) — the
  amendment does not touch them.
- `ReviewRunAccordion`'s own blocker count. It computes CRITICAL-and-not-dismissed on the client,
  which AC-68 rejects for the banner. Aligning the accordion is a recommendation, not a step.

## What already exists

- `client/…/_components/OverviewTab/OverviewTab.tsx:87-110` — the tab, the data owner, and the
  three-card row that AC-46 cuts to two.
- `client/…/_components/PrBriefCard/` — round one's card: risk level badge, `what`/`why`, risks,
  review focus, provenance, states, and the pure predicates `isLinkablePath` / `shortSha`. Every
  piece survives; the card as a container does not.
- `client/…/_components/VerdictBanner/VerdictBanner.tsx` — verdict, findings/blocker badge,
  `RunCostBadge` (`variant="detailed"`), `CircularScore` + `verdict.prScore`. Today it renders once
  per run inside `ReviewRunAccordion.tsx:169-185`. It requires a non-null `Verdict` and renders the
  score only when non-null, so it cannot express the never-reviewed state on its own.
- `client/…/_components/IntentCard/IntentCard.tsx:115-131` — the `Intent.risk_areas` chip row that
  D18 replaces, and `IntentCard/constants.ts` `riskChip` — the ordered "free string → icon with an
  explicit fallback" map AC-52/AC-53 describe.
- `client/src/app/globals.css:213-222,277-283` — `.dd-overview-cards`, two `minmax(0,1fr)` tracks,
  one track below 1024 px. Its comment already says "INTENT + BLAST RADIUS"; after R1 that is true again.
- `client/…/_components/SmartDiffViewer/SmartDiffViewer.tsx:86-99` — `openFile` seeding and the
  `pending {path, line}` → `lineDomId` scroll. The line half of R18 already exists here; nothing
  drives it from the URL.
- `client/src/components/diff-viewer/CodeLine/CodeLine.tsx:51` + `helpers.ts:19` — every rendered
  line carries `id={lineDomId(path, newNo)}`, in both viewers.
- `client/…/page.tsx:72-98` — `setParams` (one `router.replace` for several keys) and `openFile`.
- `client/src/lib/github-urls.ts:69-88` — `githubBlobUrl(repo, sha, file, startLine?, endLine?)`
  already builds `#L<n>`.
- `client/src/lib/hooks/reviews.ts:40-57` — `usePrRuns` (`RunSummary[]`, carrying `blockers`,
  `cost_usd`, `tokens_in/out`) and `usePrReviews` (`ReviewRecord[]`), both already fetched by
  `page.tsx:42-48`.
- `server/src/modules/brief/helpers.ts:201-245` — `blastBlock`, which already walks the symbols,
  callers and endpoints the prompt prints and collects their files as `refs`. The `line` on each of
  those three is on `BlastRadiusView` (`contracts/blast.ts:41,54,77`) and is not read.
- `server/src/modules/brief/helpers.ts:548-554,607-666` — `buildAllowedRefs` and `groundBrief`, the
  membership gate R13 modifies.
- `server/src/db/schema/reviews.ts:96-145` — `pr_brief`, keyed `(pr_id, head_sha)`.
- `server/src/db/schema/reviews.ts:20-37` — `reviews`, which records **no** head. Nothing in the
  database says which state of a PR a review describes; `pull_requests.last_reviewed_sha`
  (`pulls.ts:21`, written by `run-executor.ts` via `markReviewed`) says only which state the newest
  completed run saw.
- `server/src/db/seed.ts:110-152` — PR #482 with the seeded review the mockup depicts: verdict
  `request_changes`, score 61, and that exact summary. It has no `run_id` and no `agent_runs` row.

## Constraints

| Constraint | Mandated by |
|---|---|
| `modules/brief` may not import `modules/blast` or `modules/reviews`, **including `import type`** — `tsPreCompilationDeps` is on. Ports come from the composition root. | `server/.dependency-cruiser.cjs`, `server/src/modules/brief/types.ts:17-31` |
| `@devdigest/shared` is vendored twice; the server copy is the source of truth and the two must be byte-identical. | root `CLAUDE.md`, gates.md § repo·vendor |
| Widening a vendored contract touches four files, and only `cd client && pnpm typecheck` sees the fourth (a fixture annotated with the contract type). | `INSIGHTS.md:967-977` |
| A widened contract fails `server/test/contracts.test.ts` at **runtime**, not at typecheck — `tsc` reads no test file. | `INSIGHTS.md:1492-1509` |
| `reviewer-core` compiles against the **server's** vendored copy through tsconfig `paths`; its typecheck is the only place a break shows. | root `CLAUDE.md` |
| Migrations never run on boot. `pnpm db:generate` then `pnpm db:migrate`, by hand. | `server/CLAUDE.md` |
| `pr_files.patch` is not read on the brief path — that single fact is what makes N2/AC-17 checkable rather than arguable. Deriving a line must not create a reason to read it. | `§ D19`, Q-7 |
| Any property a breakpoint changes lives **only** in `app/globals.css`, keyed on a `dd-` class — an inline style beats any stylesheet rule. | `client/CLAUDE.md` |
| No `fetch` in a component; data arrives through `lib/hooks/*` or from the parent. | `client/CLAUDE.md` |
| `src/lib/api.ts` does not validate at runtime, so every lookup keyed by a server string needs `Object.hasOwn` and an explicit fallback; `next-intl` throws on a missing key. | `client/INSIGHTS.md:1059-1076`, `:1142-1166`, `PrBriefCard/constants.ts:44-52` |
| `client/src/vendor/ui/**` is a read-only copy. `CircularScore` takes `score: number`, so the empty `PR SCORE` slot is ours to draw, not its to gain a prop. | root `CLAUDE.md` § Do not touch |
| A cross-tab jump is **one** `setParams`, never one `setParam` per key. | `client/INSIGHTS.md:585-607`, `page.tsx:70-79` |
| `blockers` is `countBlockers(kept, agent.ciFailOn)` on the server and cannot be recomputed on the client. | `client/INSIGHTS.md:512-524` |
| Every model-written string renders as `{value}` — no `Markdown`, no `dangerouslySetInnerHTML`. | `§ AC-8`, `PrBriefCard.tsx:39-42` |
| A count that can be `0` is rendered `{n > 0 && …}` or a ternary, never `{n && …}`. | `react-best-practices` § Conditional Rendering |
| Derived values are computed during render, never mirrored into `useState`. | `react-best-practices` § Derive, Don't Store |
| A URL query value is a string from the address bar: parse, bound and reject it before use. | `security` § A05 / Express note "req.query values are always strings" |
| Line derivation is a pure transform → `modules/brief/helpers.ts`. Nothing new in `routes.ts`; the repository stays Drizzle-only. | `onion-architecture` §2, §3.2 |

## Recommendations

For the human. The steps below are written to the requirements as they stand.

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Make `ReviewRunAccordion` read `RunSummary.blockers` too, so the two banners on the page cannot disagree. Today it counts CRITICAL-and-not-dismissed (`ReviewRunAccordion.tsx:85`), which AC-68 rejects for the overview banner. | No — an added step in P4 if accepted | ~15 lines and one test; the accordion already receives `run` |
| 2 | If several agents completed at the current head, the banner shows the **newest** of them (with its agent badge, as today). An alternative reading is "the worst verdict wins". The spec fixes the state, not the choice among runs of that state. | Only the picker in one component | one line either way |
| 3 | Seed an `agent_runs` row for PR #482 so the demo banner also shows blockers and a run cost, as the mockup does. **Not planned**, and recommended against: it invents a run that never ran, which the no-fabricated-demo-data rule forbids. | Would add a step to P3 | — |
| 4 | Replace `last_reviewed_sha` on `pull_requests` with the per-review `head_sha` this plan adds, once every review carries one. Not now: the PR list derives its status from it and that is a separate feature's behaviour. | No | — |

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| P1 · 1-3, 6-7 | `zod` | extending a vendored record schema; `.extend()`, enum, and the `.catch()` used on parse-on-read |
| P1 · 4-5 | `drizzle-orm-patterns`, `postgresql-table-design` | a jsonb column with a default and a nullable text column on live tables, plus the generated migration |
| P2 · all | `onion-architecture` | which ring the derivation belongs in, and why the port stays read-only |
| P2 · 3 | `security` | a model-written string is cut before a membership check; the cut must not widen what membership admits |
| P3 · all | `onion-architecture` | the write goes through the repository seam, not the route |
| P4 · all | `frontend-architecture` | where each new component and each moved helper goes |
| P4 · 2-6 | `react-best-practices` | derive-don't-store, keys, `{0 && …}`, aria on icon-only controls |
| P4 · 7-8 | `next-best-practices` | App Router search params and one `router.replace` |

## Work packages

### P1 — The contract, the columns, the migration

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/brief.ts`
- `server/src/vendor/shared/contracts/review-api.ts`
- `client/src/vendor/shared/contracts/brief.ts`
- `client/src/vendor/shared/contracts/review-api.ts`
- `server/src/db/schema/reviews.ts`
- `server/src/db/migrations/**` (one new pair + `meta/_journal.json`)
- `client/src/lib/types.ts`
- `server/test/contracts.test.ts`

**Contract** — what P2, P3 and P4 may assume once this lands:

```ts
// contracts/brief.ts — beside RiskBriefInput, in the same file (D1: no second star export)
export const RiskBriefRefLineSource = z.enum(['blast_symbol', 'blast_caller', 'blast_endpoint']);
export type RiskBriefRefLineSource = z.infer<typeof RiskBriefRefLineSource>;

export const RiskBriefRefLine = z.object({
  ref: z.string(),
  line: z.number().int(),
  source: RiskBriefRefLineSource,
});
export type RiskBriefRefLine = z.infer<typeof RiskBriefRefLine>;

// RiskBriefRecord gains exactly one field; RiskBrief (the model's schema) gains nothing.
ref_lines: z.array(RiskBriefRefLine)
```

```ts
// contracts/review-api.ts — ReviewRecord gains exactly one field
head_sha: z.string().nullable()   // null = written before this column existed; NOT "the current state"
```

Tables: `pr_brief.ref_lines jsonb NOT NULL DEFAULT '[]'::jsonb`; `reviews.head_sha text` (nullable).

**Steps:**

1. Add `RiskBriefRefLineSource`, `RiskBriefRefLine` and `RiskBriefRecord.ref_lines` to
   `server/src/vendor/shared/contracts/brief.ts`. Docstring states the three facts D20 fixes: the
   number never enters `RiskBrief` (R12), `Risk.file_refs` and `ReviewFocusItem.ref` do not change
   (R19), and a record whose array is empty is a record without numbers, not a broken one.
   *Serves R12, R14, R19.*
2. Add `head_sha` to `ReviewRecord` in `contracts/review-api.ts`, nullable, with a docstring saying
   what it is not: it is **not** run telemetry, so `client/INSIGHTS.md:497-511` ("join `RunSummary`
   by `run_id` instead of widening `ReviewRecord`") does not apply — cost, tokens and blockers still
   come off the run. Which state a review describes exists nowhere else in the schema.
   *Serves R21, R24, R29, R30.*
3. Mirror both files to `client/src/vendor/shared/contracts/`, then prove it:
   `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing. *Serves R19, R24.*
4. `server/src/db/schema/reviews.ts`: `prBrief` gains
   `refLines: jsonb('ref_lines').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`)` — the shape
   its neighbours `risks` / `reviewFocus` already use, so old rows read as `[]` with no data
   migration (R19). `reviews` gains `headSha: text('head_sha')`, nullable — no default and no
   backfill: a row written before this column has an unknown state, and `''` or the current head
   would both be a claim. *Serves R19, R24.*
5. `cd server && pnpm db:generate`, then read the generated SQL before running it. It must be
   **two `ADD COLUMN` statements and nothing else** — no constraint statement, no
   `<constraint_name>` placeholder. `server/INSIGHTS.md:932-945` records what a primary-key change
   emitted last time on this very table; an add-only migration does not hit it, and checking is how
   you know. Then `pnpm db:migrate`. *Serves R19, R24.*
6. Re-export `RiskBriefRefLine` and `RiskBriefRefLineSource` from `client/src/lib/types.ts`, in the
   existing "PR Why + Risk Brief (10)" block. *Serves R14, R17.*
7. `server/test/contracts.test.ts`: extend the `RiskBriefRecord` fixture with `ref_lines`, add a
   round-trip over one entry of each `source`, a negative case for a `source` outside the enum, and
   a negative case for a non-integer `line`. Add `ReviewRecord` coverage for `head_sha` both null
   and a string. The fixture is a hand-written literal that `tsc` never sees, so it is the runtime
   run that catches this (`INSIGHTS.md:1492-1509`). *Serves R12, R19, R24.*

**Check:** `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
`diff -r server/src/vendor/shared client/src/vendor/shared` silent; `cd client && pnpm typecheck`;
`cd reviewer-core && npm run typecheck`.

### P2 — Server: where a line number comes from, and where a suffix goes

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `server/src/modules/brief/helpers.ts`
- `server/src/modules/brief/types.ts`
- `server/src/modules/brief/service.ts`
- `server/src/modules/brief/repository.ts`
- `server/test/brief-allowed-refs.test.ts`, `brief-grounding.test.ts`, `brief-service.test.ts`,
  `brief.it.test.ts`, and one new `server/test/brief-ref-lines.test.ts`

**Contract this package must hold to** (repeated because you start cold): `RiskBriefRefLine` is
`{ ref, line, source }` with `source` one of `blast_symbol | blast_caller | blast_endpoint`;
`RiskBriefRecord.ref_lines` is an array of them; `pr_brief.ref_lines` is a jsonb column defaulting
to `[]`. `RiskBrief` — the schema the model fills — is unchanged, and `Risk` and `ReviewFocusItem`
are unchanged.

**Steps:**

1. `types.ts`: `BriefBlock` gains `refLines?: RiskBriefRefLine[]`. Document that only the blast
   block ever sets it, for the same reason `refs` exists: what a block **printed** is what it
   licenses. *Serves R14, R15.*
2. `helpers.ts` · `blastBlock`: in the same loop that already adds a file to `refs`, record the
   line — `symbol.file → symbol.line` (`blast_symbol`), `caller.file → caller.line`
   (`blast_caller`), `endpoint.file → endpoint.line` (`blast_endpoint`). Three rules, each of which
   the test in step 6 pins:
   - **the first occurrence of a path wins**, in the order the block prints them, so the number a
     reader sees is the one the first printed fact carried;
   - an **endpoint label** (`POST /pulls/:id/brief`) gets no entry — it is a member of the allowed
     set but it is not a path, and a label with `:45` glued on is not a thing that exists;
   - a symbol past `MAX_BLAST_SYMBOLS`, or a caller past `MAX_BLAST_CALLERS`, contributes no line,
     exactly as it contributes no ref.
   The prompt text does not change: no line number is printed to the model, so the budget and every
   AC-18/AC-20 number stay as they are. *Serves R12, R14.*
3. `helpers.ts`: add `stripLineSuffix(ref: string): string` — anchored at the **end**,
   `/:(\d+)(?:-\d+)?$/`, returning the path with the suffix removed and **discarding** the number.
   Call it in `groundBrief` on every `risk.file_refs` entry and every `review_focus[].ref` **before**
   the membership test, and store the stripped value. Two properties the test must state:
   - stripping never widens membership — the result is tested against the same set, so
     `src/x.ts:12` is admitted only because `src/x.ts` is a member;
   - `dropped_refs` records what the **model** returned (the original string, truncated as today),
     because that array is the evidence of what it said, not of what we made of it.
   De-duplicate `file_refs` and review-focus refs **after** stripping, so `a.ts` and `a.ts:3` are one
   row and one control. *Serves R13, R17.*
4. `helpers.ts`: add `buildRefLines(included: BriefBlock[]): RiskBriefRefLine[]` — the exact mirror
   of `buildAllowedRefs`, walking only the blocks that survived the budget. A blast block the budget
   dropped licenses no reference and must license no number either. *Serves R14, R15.*
5. `service.ts` · `run()`: after `groundBrief`, keep only the entries whose `ref` survived on a risk
   or a focus item, and write `[]` — not the derived list — when
   `index_matches_head === false || link_sha == null`. Comment says why the gate is here as well as
   on the client: a number that is only true at `link_sha` and is stored anyway is an invitation to
   a future reader to show it, and `contracts/blast.ts:92-109` already records what that cost once.
   Pass the result into `upsertBrief` as `refLines`. *Serves R14, R15, R16.*
6. `repository.ts` / `helpers.ts`: `BriefValues.refLines`, the column in the upsert, and
   `toRiskBriefRecord` parsing it as `RiskBriefRefLine.array().catch([]).parse(row.refLines)` — the
   same fault-tolerant read its jsonb neighbours use, which is also what makes a pre-existing row
   render as a row without numbers (R19). *Serves R19.*
7. Tests. `brief-ref-lines.test.ts` (new, hermetic): first-occurrence-wins over a view where one
   path is both a caller and a symbol; no entry for an endpoint label; nothing past the symbol and
   caller caps; empty output for a view with `index_matches_head: false`; empty for
   `link_sha: null`. `brief-allowed-refs.test.ts`: `src/config.ts:12` is admitted as `src/config.ts`
   and `evil.ts:1` still is not. `brief-grounding.test.ts`: the stored ref has no suffix, the
   dropped ref keeps the model's original string, `a.ts` + `a.ts:3` collapse to one. `brief-service.test.ts`:
   a stale index persists `ref_lines: []`. `brief.it.test.ts`: `GET` returns `ref_lines` for a row
   written with them and `[]` for one written without.

**Check:** `cd server && pnpm arch && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`.
The integration file runs under `pnpm exec vitest run .it.test` with Docker up.

### P3 — Server: which state a review belongs to

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `server/src/modules/reviews/repository/review.repo.ts`
- `server/src/modules/reviews/repository.ts`
- `server/src/modules/reviews/run-executor.ts`
- `server/src/modules/reviews/helpers.ts`
- `server/src/db/seed.ts`
- one new `server/test/review-head-sha.test.ts`

**Contract this package must hold to:** `ReviewRecord.head_sha` is `string | null`; the column
`reviews.head_sha` is nullable text with no default. Null means "unknown state", and every reader
must treat it as *not* the current state. Cost, tokens and blockers stay on `RunSummary` and are
joined by `run_id` — this package adds nothing to that path.

**Steps:**

1. `review.repo.ts` · `insertReview`: accept `headSha: string | null` and write it. It is a
   server-controlled value (`pull_requests.head_sha`), so it takes no `stripNul` — say that in the
   comment beside the two fields that do. *Serves R24.*
2. `repository.ts`: widen the `insertReview` seam signature to match. *Serves R24.*
3. `run-executor.ts:492-502`: pass `headSha: pull.headSha`. It is the same value the executor
   already hands `markReviewed` a few lines later, and taking it from the same place is what keeps
   the two consistent. *Serves R24, R29.*
4. `helpers.ts`: `ReviewDto` gains `head_sha: string | null`, and `reviewToDto` passes
   `review.headSha` through. *Serves R21, R24, R30.*
5. `db/seed.ts`: the seeded review for PR #482 gets `headSha: 'a1b2c3d4e5f6'` — the head the seeded
   PR already declares, and the state that review's summary describes. Nothing else is seeded: no
   `agent_runs` row, no cost, no blocker count. A run that never ran is not a fixture, and the
   banner showing no cost badge on a fresh install is the truth about the seed. *Serves R34.*
6. `review-head-sha.test.ts` (new, hermetic): `reviewToDto` carries the sha through and carries
   `null` through as `null`; the executor's persist step passes the pull's head to the repository
   seam (assert on a fake repository, the pattern `brief-service.test.ts` uses).

**Check:** `cd server && pnpm arch && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`.

### P4 — Client: the composition

**Agent:** implementer · **Depends on:** P1 (types compile). Its data is real once P2 and P3 land;
its tests do not wait for them — every fixture in this package is written by hand.

**Owns:**
- `client/…/pulls/[number]/_components/OverviewTab/**`
- `client/…/pulls/[number]/_components/PrBriefBanner/**` (new)
- `client/…/pulls/[number]/_components/RiskAreas/**` (new)
- `client/…/pulls/[number]/_components/ReviewFocusSection/**` (new)
- `client/…/pulls/[number]/_components/PrBriefCard/**` (deleted)
- `client/…/pulls/[number]/_components/IntentCard/**`
- `client/…/pulls/[number]/_components/DiffTab/**`, `SmartDiffViewer/**`
- `client/…/pulls/[number]/page.tsx`, `page.test.tsx`
- `client/src/lib/github-urls.ts`
- `client/messages/en/brief.json`
- `client/src/app/globals.css`

**Contract this package must hold to:** `RiskBriefRecord` now carries
`ref_lines: { ref: string; line: number; source: 'blast_symbol'|'blast_caller'|'blast_endpoint' }[]`,
already filtered by the server to references that survived grounding and already emptied when the
index does not match the head. `ReviewRecord` now carries `head_sha: string | null`, where `null`
means the state is unknown and therefore **not** the current one. `RunSummary.blockers` is the only
blocker number. `RiskBrief` gained nothing, so `Risk` and `ReviewFocusItem` are unchanged.

**Steps:**

1. **Move the shared predicate, then delete the card.** `isLinkablePath` moves from
   `PrBriefCard/helpers.ts` to `client/src/lib/github-urls.ts`, beside `hasDotSegment` it already
   imports — a security predicate gets one home and two consumers, never a copy
   (`client/INSIGHTS.md:484-496`). `riskTone` moves to `RiskAreas/constants.ts`, `statusKey` and
   `shortSha` to `ReviewFocusSection/constants.ts` / `RiskAreas/helpers.ts`. Then delete
   `PrBriefCard/` including its test.

   **Before deleting, list what that folder is the sole holder of, and confirm each item is written
   out in the step that re-homes it — in words, not as a pointer back at the file being removed.**
   Three are known and are spelled out below: the reference gates (step 4), the four brief states
   plus the "no model configured" copy (step 6), the provenance block (step 5). "As `PrBriefCard`
   did" stops being an instruction the moment `PrBriefCard` is gone, and the test that would have
   caught the omission is deleted in the same commit. *Serves R1.*
2. **`RiskAreas`** (new, presentational). Props: `risks`, `riskLevel`, `refLines`, `linkSha`,
   `indexMatchesHead`, `repoFullName`, `intentFreshness`, plus the brief's loading / empty / failure
   state. Renders: the section heading with the `risk_level` badge (AC-4's word, not colour alone),
   the stale-index note when `index_matches_head` is false (AC-26 — the note sits on the **section**,
   which is the other half of R16), the intent-freshness note (AC-25), the explicit "no risks" text
   beside the level when the list is empty (AC-11), and one row per risk: icon, severity badge,
   title, references always visible, explanation inside a native `<details>/<summary>` (R9). Five
   rows visible, the rest behind one more disclosure carrying the hidden count — the server caps
   risks at 12 (`brief/constants.ts:158`) and the NFR shows 5. The icon dictionary is
   `IntentCard/constants.ts`'s `riskChip` moved here and keyed on `Risk.kind`: ordered regex rules,
   first match wins, `Object.hasOwn`-free by construction, explicit fallback icon (R7, R8). A
   reference renders through one `BriefRef` component (step 4). *Serves R2, R7, R8, R9, R10, R33.*
3. **`IntentCard`** gains one prop, `riskAreas?: React.ReactNode`, rendered at the foot of **all
   four** of its state branches, and loses its own `intent.risk_areas` chip row (D18: two sections
   with one name, one checked and one not, is the thing being removed). The card learns nothing
   about the brief — the slot is filled by `OverviewTab`, which owns the data. Update
   `IntentCard.test.tsx`: the risk-area chip assertions become slot assertions, and one new case
   proves the slot renders while `intent == null`. *Serves R2, R10, R31, R33.*
4. **`BriefRef`** — one component, colocated in `RiskAreas/` and imported by `ReviewFocusSection/`,
   for the single visual form R17 demands: a mono string, plus `:<line>` and nothing else. No
   placeholder, ever. Every gate below is stated here in full because the file that held them
   (`PrBriefCard/PrBriefCard.tsx`, `FileRef` and `FocusRow`) is deleted in step 1 — there is nothing
   left to read them off.

   **The `:<line>` suffix is shown only when all three hold:** `indexMatchesHead === true`,
   `linkSha != null`, and `ref_lines` carries an entry whose `ref` equals this reference exactly
   (R16, R17). Otherwise the reference renders with no suffix and no hint that one was ever expected.

   **A risk reference becomes a `github.com` link only when all three hold:** `linkSha != null`,
   `repoFullName != null`, and `isLinkablePath(path)`. Otherwise it is plain mono text.
   - `linkSha != null` is **AC-27**, and it is not the same test as the suffix gate above: a null
     `link_sha` means there is no commit at which this path is true, so the link is not built at all
     — never against `head_sha`. `INSIGHTS.md:418-441` is what that mistake looked like: the link
     opened, the file existed, the line existed, and it was a comment.
   - `isLinkablePath` is **AC-15**, and it is a different question from grounding: membership says
     the model was shown this string, not that the string is safe in a URL. Dot segments, control
     characters and schemes are refused there.
   - Plain text means a `<span className="mono">`, never a `MonoLink` without an `href` — that
     renders a `<button>` with nothing behind it.
   - When the suffix is not shown, `line` is **not** passed to `githubBlobUrl` either. The text and
     the target say the same thing or the reference is wrong in one of them.

   **A review-focus reference becomes a control only when** the path is one of this PR's changed
   files **and** `isLinkablePath(path)`; otherwise plain text, never a dead control (**AC-6**). An
   endpoint label (`kind: 'endpoint'`) fails the changed-file test on its own. The control calls
   `onOpenFile(path, line)`, with `line` omitted whenever the suffix gate above did not pass.
   *Serves R14, R15, R16, R17, R18; keeps AC-6, AC-15 and AC-27.*
5. **`ReviewFocusSection`** (new, full width). Heading "Review focus — read these first" with a
   count badge of the **full** list length, rendered `{n > 0 ? … : …}` — never `{n && …}`, which
   prints a literal `0`. When the list is empty the section stays put with the count `0` and an
   explicit sentence (R27). Each row: `BriefRef` then the reason, on one line.

   **Ten rows are shown; the rest sit behind one disclosure carrying the hidden count** — the same
   shape the risk rows get in step 2, at the NFR's own number (R3). Two things this must not become:
   the **reason** stays visible on every shown row and never moves behind a disclosure (**R11** — a
   section called "read these first" whose reasons need a click has cancelled itself); and the count
   badge keeps reporting the **full** list length, which is what makes the truncation loud.

   The server caps `review_focus` at 10 today (`brief/constants.ts:161`), so the overflow branch is
   unreachable through the API right now. Build it anyway and test it with a hand-written fixture of
   twelve: the cap is a server constant one commit away from changing, and the alternative is a
   full-width block whose length is bounded by something no reader of this component can see.

   At its foot, the provenance block round one built — the input list with its statuses, and beside
   it the **brief's** cost and tokens under a label naming the brief, so the two costs on this
   screen can never read as one number (R25, R32). *Serves R3, R11, R25, R27, R32.*
6. **`PrBriefBanner`** (new, full width, above the card row). Props: the brief, the review chosen for
   the current head (or null), that review's `RunSummary` (or null), whether any other review exists,
   and the recompute action with its pending flag. Two states, and no third:
   - **a completed review for this head** (`review.head_sha === headSha`, verdict non-null, newest
     by the rule below): render the existing `VerdictBanner` unchanged, with `summary` from the review,
     `blockers` from `run.blockers` — never a recount — and cost/tokens from the run. `what`/`why`
     do not render (R29); they stay in the record and in the route's answer.
     `blockers` is `null` when there is no run row behind the review, in which case the badge shows
     the findings count alone rather than a zero (R23).
   - **no completed review for this head**: our own banner — the brief's `what` and `why` as the
     prose (R28), the words that this state has not been reviewed, a `PR SCORE` slot holding the
     label and an em dash (the `PRRow.tsx:61-65` precedent for a never-reviewed PR), **no** verdict
     and **no** zero counters (R21), and, when a review exists for some other state, one line saying
     so (R30).
   **Which review, when several completed at this head.** The API orders reviews newest-first —
   `reviewsForPull` is `orderBy(desc(t.reviews.createdAt))` (`review.repo.ts:83`) — but the banner
   must not rest on an order it does not state. Sort the candidates explicitly by `created_at`
   descending, tie-broken by `id` ascending, and take the first. Two agents can finish in the same
   `now()`, and an incidental order would show a different one of them between two loads with no
   test failing. One comparator, in `PrBriefBanner/helpers.ts`, tested directly on a pair that ties.

   In both states the banner carries the recompute action, labelled with the brief as its subject
   and given an `aria-label` that says so too (R26) — it is disabled by its own in-flight mutation
   and by nothing else (`client/INSIGHTS.md:316-331`). The brief's failure and the
   "no model configured" copy round one wrote move here as well (AC-3, AC-42): this is the block
   that owns the brief's state now. *Serves R20, R21, R22, R23, R24, R26, R28, R29, R30.*
7. **`OverviewTab`** becomes the composition and stays the data owner. It gains `reviews` and
   `prRuns` as props from `page.tsx` (which already fetches both) and joins them
   `new Map(prRuns.map(r => [r.run_id, r]))` — the join belongs in the parent, not in a widened
   contract (`client/INSIGHTS.md:497-511`). It renders, in this DOM order: one `SectionLabel`
   "PR Brief" (R4), `PrBriefBanner`, the existing `<div className="dd-overview-cards">` with
   `IntentCard` (its `riskAreas` slot filled) and `BlastRadiusCard` — **two** children now (R1) —
   then `ReviewFocusSection`, then the PR description. The automatic-compute effect and the
   `useBriefComputeAttempted` guard are untouched. Because the brief's places are the banner's prose
   slot, the risks section and the focus section, a missing brief leaves INTENT and BLAST RADIUS
   fully rendered and unresized (R5). *Serves R1, R4, R5, R6, R20…R32.*
8. **The jump gains a line.** `page.tsx`: `openFile(path, line?)` writes `{ tab, file, line }` in
   **one** `setParams`; a null line clears the key. Reading back, `?line=` is a string someone can
   type — so match the **whole** string against `/^[1-9][0-9]{0,6}$/` and only then `Number(...)`.
   Anything else is ignored and the jump degrades to the file. `Number.parseInt` is the wrong tool
   here and is not to be used: it reads `12abc` as `12`, `1e3` as `1`, ` 12` as `12`, and it has no
   upper bound — the pattern above rejects all four and caps the value at 9 999 999, which is more
   lines than any file in a diff this app can render. One helper, in `page.tsx`'s own module, so
   there is one definition of "a usable line number". Pass it to `DiffTab` as `targetLine`, which forwards `openLine` to
   `SmartDiffViewer`; the viewer seeds its existing `pending {path, line}` from it at mount, next to
   the `openFile` seed, so the scroll lands on `lineDomId(path, line)`. In the plain viewer branch
   `DiffTab`'s own effect scrolls to `lineDomId` when the element exists and falls back to the file
   card. Key the effects on the viewer that is on screen as well as on the target — a jump keyed only
   on its target scrolls inside the tree that is about to be replaced
   (`client/INSIGHTS.md:401-422`, and `DiffTab.tsx:82-90` already does this for the file). *Serves R18.*
9. **i18n** (`client/messages/en/brief.json`). Change `riskBrief.reviewFocus` from
   "Where to look first" to **"Review focus — read these first"**: the design's own words are the
   requirement, and `client/AGENTS.md` names this exact pair as the example. Add
   `riskBrief.sectionTitle` ("PR Brief"), `riskBrief.riskAreas` ("Risk areas"),
   `riskBrief.reviewFocusEmpty`, `riskBrief.notReviewed`, `riskBrief.reviewedEarlierState`,
   `riskBrief.briefCost`, `riskBrief.moreRisks`, `riskBrief.moreFocus` and `riskBrief.openLine`.
   The two `more*` keys carry the hidden count of their disclosure (steps 2 and 5). `intent.riskAreas` and
   `block.risks` fall out of use and stay as scaffolding, which `client/CLAUDE.md` permits — do not
   delete them and do not point the new section at them. *Serves R3, R4, R21, R25, R27, R30.*
10. **CSS.** Expect `globals.css` to need **nothing**: the banner and the focus section are siblings
    of `.dd-overview-cards`, not children, so the natural DOM order already gives R6's stacking and
    the existing 1024 px rule already collapses the grid. If a full-width block ends up inside the
    grid, it needs `grid-column: 1 / -1` in `globals.css` and **not** in a `styles.ts` — an inline
    style beats the media query and the layout silently stops responding. Update the comment above
    `.dd-overview-cards` only if it stops being true. *Serves R6.*
11. **Tests.** `OverviewTab.test.tsx`: exactly two children in the card row; the section heading; a
    brief-less state that still renders INTENT and BLAST in full; the focus section present with `0`.
    `PrBriefBanner.test.tsx`: the two states; blockers from the run and not from the findings; a
    review whose `head_sha` differs contributes no verdict, no score and no cost but does produce the
    earlier-state line; `head_sha: null` behaves as "not this state"; `what`/`why` disappear when a
    review for this head appears; the action's accessible name names the brief; and the comparator
    picks the same review from two candidates sharing a `head_sha` **and** a `created_at`, whichever
    order they arrive in — assert on the helper directly, since a component test cannot tell a
    deterministic pick from a lucky one.
    `RiskAreas.test.tsx`: icon per kind; an unknown kind still renders an icon; the explanation is
    inside a `<details>` — assert what the row **contains**, never that it is visible or hidden, as
    jsdom does not hide closed content (`client/INSIGHTS.md:890-906`); a stale index shows no `:line`
    anywhere even when `ref_lines` is populated; **`link_sha: null` renders every reference as text
    with no anchor and no `href` built against the head (AC-27)**; a path carrying a dot segment or a
    control character renders as text (AC-15); six risks show five rows and a disclosure carrying `1`.
    Those three cases are the ones `PrBriefCard.test.tsx` held, and they die with it in step 1 unless
    they are written here.
    `ReviewFocusSection.test.tsx`: the count badge shows the full length; empty list keeps the
    section; a ref with a line calls `onOpenFile` with both, and a ref without one calls it with the
    path alone; **twelve items show ten rows plus a disclosure carrying `2`, while the badge still
    reads `12`**; the reason of every shown row is present without opening anything.
    `page.test.tsx`: one `router.replace` carrying `tab`, `file` and `line`; and `?line=` values
    `12abc`, `1e3`, `" 12"`, `0`, `-1` and `99999999` are each ignored, with the jump still landing on
    the file. `DiffTab.test.tsx` / `SmartDiffViewer.test.tsx`: the line target scrolls to
    `lineDomId(path, line)`.

**Check:** `cd client && pnpm lint && pnpm typecheck && pnpm test`.

### Dispatch order

**P1 alone first, and it must land before anything else is dispatched** — every other package
compiles against the contract it writes, and two agents editing `contracts/brief.ts` is the failure
the split exists to prevent. Then **P2, P3 and P4 in parallel**: their file sets do not intersect.
P4's tests pass on hand-written fixtures, so it does not wait for P2 or P3; the screen only tells
the truth once all three have landed, which is why `## Verification` runs at the end and not per
package.

## Tests

Unit only in the gates; both integration files below are named because this feature already has them
and they are where a schema change surfaces.

| Suite | Files | Command |
|---|---|---|
| server unit | `test/contracts.test.ts`, `brief-ref-lines.test.ts` (new), `brief-allowed-refs.test.ts`, `brief-grounding.test.ts`, `brief-service.test.ts`, `review-head-sha.test.ts` (new) | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| server integration | `test/brief.it.test.ts` (a stored `ref_lines` round trip), `test/reviews.it.test.ts` (`head_sha` on the reviews payload) | `cd server && pnpm exec vitest run .it.test` — **in scope**, run once after P2 and P3 land, with Docker up |
| client unit | the six files in P4 · 11 | `cd client && pnpm test` |
| e2e | none. N8 stands. | — |

## Gates

Copied from `.claude/skills/pr-self-review/gates.md`:

```sh
cd server && pnpm arch
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd client && pnpm lint
cd client && pnpm typecheck
cd client && pnpm test
cd reviewer-core && npm run typecheck
cd reviewer-core && npm test
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

`reviewer-core` writes no code here and is in the list anyway: it aliases the **server's** vendored
copy through tsconfig `paths`, so a contract break shows up in its typecheck and in no build.

## Risks (from INSIGHTS.md)

| Recorded | What it costs here | What this plan does |
|---|---|---|
| `INSIGHTS.md:967-977` — widening a vendored contract touches four files, and only `client/pnpm typecheck` finds the fourth | `ref_lines` and `head_sha` both widen a contract a client fixture is annotated with | P1 · 3 mirrors and diffs; the check list runs **both** typechecks, not just the server's |
| `INSIGHTS.md:1492-1509` — a widened contract fails a **test**, not the typecheck | `server/test/contracts.test.ts` pins hand-written literals for `RiskBriefRecord` | P1 · 7 updates the fixture in the same package that widens the schema |
| `server/INSIGHTS.md:932-945` — `drizzle-kit generate` emitted an unrunnable migration on `pr_brief` | the same table gains a column here | P1 · 5 requires reading the SQL and refusing anything that is not two `ADD COLUMN`s |
| `server/INSIGHTS.md:1133-1154` — parse-on-read turns a field a stored document lacks into a 422 | `toRiskBriefRecord` parses jsonb on read, and every existing `pr_brief` row lacks `ref_lines` | the column is `NOT NULL DEFAULT '[]'`, so the row already reads as `[]`; the parse still uses `.catch([])` (P2 · 6) |
| `client/INSIGHTS.md:512-524` — `blockers` is the agent's own gate threshold and cannot be derived on the client | AC-68 is exactly this mistake, and the code next door still makes it | P4 · 6 takes it from `RunSummary`; Recommendation 1 offers to fix the neighbour |
| `client/INSIGHTS.md:497-511` — join run telemetry by `run_id`, do not widen `ReviewRecord` | this plan widens `ReviewRecord` | it widens it with the one fact that is **not** run telemetry and exists nowhere else; cost, tokens and blockers still come off the join (P1 · 2, P4 · 7) |
| `client/INSIGHTS.md:890-906` — jsdom flips `<details>` but does not hide closed content | R9's disclosure would get a test that cannot fail | P4 · 11 asserts contents, never visibility |
| `client/INSIGHTS.md:401-422` — a jump effect keyed only on its target scrolls inside a tree about to be replaced | the line jump lands in whichever viewer is mounted first | P4 · 8 keys on the viewer as well, as the file jump already does |
| `client/INSIGHTS.md:1059-1076`, `:1142-1166` — an unexpected string took the findings page down; `in` walks the prototype chain | `Risk.kind` is `z.string()` from a model, and the client validates nothing | R8's dictionary is ordered rules with an explicit fallback, the `riskChip` shape that already survives this |
| `client/INSIGHTS.md:316-331` — a retry disabled by the state it recovers from | the recompute action now sits in a block whose other content belongs to the review | P4 · 6 keeps `disabled={computing}` and nothing else |
| `client/INSIGHTS.md:332-352` — a contract field typed on both sides and rendered nowhere | `ref_lines` could ship and never appear | P4 · 4 renders it and P4 · 11 asserts a suffix appears and disappears |
| `client/INSIGHTS.md:1503-1539` — green typecheck and green tests do not mean the client builds | the composition adds files and a deleted folder | `## Verification` ends in a real run of the real app, not in a test summary |

## Alternatives rejected

- **Deriving "is this review current" from `pull_requests.last_reviewed_sha`** (exposed on
  `PrDetail`) instead of a per-review `head_sha`. Cheaper — one field, two route lines, no migration
  — and it uses the field `pulls/status.ts:140` already trusts for the PR list. Rejected because it
  is a PR-level scalar: delete the newest run (a button the UI has) and the flag keeps pointing at
  the head while the newest surviving review belongs to an older state, so the banner would present a
  previous state's verdict as current — the one thing AC-69 exists to forbid.
- **Adding `head_sha` to `agent_runs` instead of to `reviews`.** Equally exact for runs, but the
  seeded review the mockup depicts has no run row at all, and a review persisted without a run would
  stay unattributable forever. The state belongs to the review.
- **Letting the model return line numbers and grounding them against the blast answer.** It reads
  like AC-13 one floor down, and it is not: grounding a *line* needs the diff, `groundFindings` has
  hunks and this path has none by construction (D10, D19). The number is derived by code or it does
  not exist.
- **Reading `pr_files.patch` after the call to recover a line for a changed file.** Rejected by the
  human in Q-7, and the reason is the plan's too: "no patch on this path" is checkable by one grep
  today, and "read, but only afterwards, and only for a number" replaces that fact with a judgement
  nobody re-checks.
- **Printing line numbers into the prompt so the model can cite them.** Costs budget, invites the
  model to echo them, and AC-57 discards them anyway.
- **Giving `VerdictBanner` a nullable verdict and an empty-score mode.** It is shared with
  `ReviewRunAccordion`, where those states cannot occur; the never-reviewed banner is its own
  component and the shared one stays as it is.
- **Keeping `PrBriefCard` as a container and moving only its contents.** A component that renders
  every field in the wrong container has not implemented the design (`client/AGENTS.md`), and the
  card is the container the design removes.
- **Putting the full-width blocks inside `.dd-overview-cards` with `grid-column: 1 / -1`.** Works,
  but it makes the grid own three kinds of child and puts a layout property one inline style away
  from silently winning. Siblings need no CSS at all.

## Verification

Run against a real app — `./scripts/dev.sh`, a seeded workspace, PR #482 — not against a test
summary. Each line names what it proves.

1. **Cold state, no review.** Open Overview on a PR whose head has no completed review: one "PR Brief"
   heading (R4), a banner carrying the brief's `what`/`why` (R28), "not reviewed" with an em-dash
   `PR SCORE` and no verdict and no zero counters (R21, R22), two cards in the row (R1), risks inside
   INTENT (R2), a full-width review-focus section with a count (R3). *Proves R1-R4, R21, R22, R28.*
2. **Brief absent.** With no brief row for the head, INTENT and BLAST render in full and keep their
   widths while the brief's three places show their own progress/empty states. *Proves R5, R33.*
3. **Run a review on that head, reload.** The prose slot switches to the run's summary, `what`/`why`
   leave the screen, and `curl localhost:3001/pulls/<id>/brief` still returns them. Verdict, score,
   cost and tokens appear; the blocker count equals `agent_runs.blockers` for that run
   (`psql … select blockers from agent_runs order by ran_at desc limit 1`). *Proves R20, R23, R29.*
4. **Push a commit, refresh the PR.** The banner returns to the not-reviewed state, says a review
   exists for an earlier state, and shows none of the old run's numbers. *Proves R24, R30.*
5. **Risk rows.** Each row has an icon; a risk whose `kind` is unknown still has one; level, title
   and references are visible collapsed; the explanation opens with the keyboard alone. *Proves R7,
   R8, R9, R10.*
6. **Line numbers, index fresh.** With `index_matches_head` true, a reference that came from blast
   shows `path:line` and one that came only from the changed-file list shows `path` — no `:?`, no
   dash. Activating the first lands on that file **and** that line in Files changed, and the address
   bar gained `tab`, `file` and `line` in one history entry. *Proves R14, R15, R17, R18.*
7. **Line numbers, index stale.** Against a PR whose index does not match the head: no `:line`
   anywhere, no line navigation, and the stale-index note on the section. Then against an
   unindexed repository (`link_sha` null): every reference is plain text and the page contains no
   `github.com/.../blob/` href for a brief reference at all — a link built against the head is the
   failure AC-27 names, and it looks exactly like a working link. *Proves R16, and keeps AC-27.*
8. **A record written before this change** (`psql … update pr_brief set ref_lines='[]'` on an old row,
   or simply an untouched one) renders as a brief without numbers, with no error in the console.
   *Proves R19.*
9. **Empty focus list** — force `review_focus: []` — leaves the section in place with `0` and a
   sentence. *Proves R27.*
10. **The recompute action** names the brief while the review's summary is in the slot, and pressing
    it produces exactly one `POST /pulls/:id/brief` in the server log and no run and no intent
    derivation. *Proves R26.*
11. **Narrow the window below 1024 px.** One column, in the order banner → INTENT (with risks) →
    BLAST → REVIEW FOCUS, no sideways scroll. *Proves R6.*
12. **`cd client && pnpm build`** — a green typecheck and green tests are not evidence that this app
    builds (`client/INSIGHTS.md:1503-1539`).

### 13. Walk the screen against the mockup, element by element

**Required, and it is what this whole round exists for.** Open
`specs/assets/SPEC-02-pr-brief-overview.png` as an image — do not read a description of it — put
the running app beside it, and answer **matches / differs / absent** for each item below.
`client/AGENTS.md` § *A design is an acceptance criterion* is the procedure; the rule that matters
most is the last one: **a difference is reported, not silently resolved either way** — building past
the design and improving it are the same failure.

- **Placement and hierarchy:** the `PR BRIEF` heading over everything; the banner full width; two
  cards below it, INTENT left and BLAST RADIUS right; `REVIEW FOCUS` full width under both.
- **Inside INTENT:** the quoted intent, the `IN SCOPE` / `OUT OF SCOPE` columns, then `RISK AREAS`
  as rows — icon, title, mono reference, chevron — and not as chips.
- **Inside the banner:** verdict word and icon, the `6 findings · 2 blockers` badge, the summary
  paragraph, the refresh control, the radial `61` with `PR SCORE` beneath it, the
  `$0.014  8.2K→1.3K` line.
- **Every label in the design's own words:** `PR BRIEF`, `RISK AREAS`,
  `REVIEW FOCUS — READ THESE FIRST`, `PR SCORE`, `IN SCOPE`, `OUT OF SCOPE`.
- **The shape of each value:** `PR SCORE` is a gauge with a number; `risk_level` is a word in a
  badge; the focus count is a badge; a reference is mono text.
- **What each element does:** which references are links, which open in-app, what the chevrons expand.
- **What the design shows that the contract cannot express** — report it, do not build it.

Six differences are **expected and deliberate**; record them as such and report anything else:

| On the mockup | In the app | Why |
|---|---|---|
| `src/middleware/ratelimit.ts:12-18` — a range | one line, or no suffix at all | N11 / Q-8: blast returns one `line`. And a reference not admitted through blast has no number (R15) |
| every reference carries a line | some carry none | R15, and every reference loses its number when the index is stale (R16) |
| `8.2K→1.3K` | `8k→1.3k` | Q-10: the existing formatter, used by four surfaces, is kept |
| `Prior PRs touching these files 3` | absent | N10, a decision of 2026-08-16, not an omission |
| `$0.014  8.2K→1.3K` on the seeded demo | no cost badge | the seeded review has no `agent_runs` row, and inventing one is forbidden |
| `6 findings · 2 blockers` on the seeded demo | the findings count alone | same: with no run row there is no stored blocker count, and `0 blockers` would be a claim (R23) |

## Open questions

_None._

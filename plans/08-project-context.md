# 08 — Project Context

**Status:** Planned 2026-08-13
**Scope:** repo-wide | server · reviewer-core · client · vendored `shared` contract · DB schema
**Modules touched:** `server/src/modules/context` (new), `reviews/run-executor`, `platform/container`,
`platform/trace-builder`, `adapters/git`, `db/schema/context`, both `vendor/shared` copies,
`client/` Project Context page + agent/skill Context tabs + run-trace drawer + `vendor/ui/nav.ts`
**Requirements source:** `specs/SPEC-01-project-context.md` (approved 2026-08-13; 48 criteria after
the amendments of the same day to AC-1, AC-22, AC-31 and the new AC-48)
**Execution:** single-agent — the steps below are sequential and each stage compiles only after the
one before it. Contract first, port second, engine third, module fourth, run path fifth, client last.

## Requirements as understood

The spec's 48 acceptance criteria cross over as `R1`–`R47`, `R49` and `R51`, in spec order.
`R48` and `R50` are mine, not the spec's, and are marked `assumed`: a human confirming this plan
is being asked to confirm them.

**Four questions this plan raised were answered on 2026-08-13** and the answers are folded in
below, not left as options: AC-31 stops at the first document that does not fit (R37); a fourth
document kind `other` is real and gets its own badge (R1); AC-22 names the per-prompt cost and the
rule, never a product against an imagined PR (R27); and the Settings screen exposes both new keys
(R51, the spec's new AC-48). `spec-creator` is amending the spec for the three that are spec-level.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | Page lists the scanned `.md` docs with repo-relative path, root folder and kind — `specs` / `docs` / `insights`, plus **`other`** for a configured root whose folder name is none of the three, with its own badge | `§ AC-1` | clear |
| R2 | Footer shows only scan output: file count and last-scanned time | `§ AC-2` | clear |
| R3 | Rescan re-scans the clone and updates the count and the time | `§ AC-3` | clear |
| R4 | A failed rescan leaves the previous result untouched and shows the failed attempt beside the previous success time | `§ AC-42` | clear |
| R5 | No clone / clone in flight → a "clone preparing" state with a retry, never an empty list | `§ AC-4` | clear |
| R6 | Configured roots yield no `.md` → empty state naming the roots searched | `§ AC-5` | clear |
| R7 | Selecting a doc renders its content as markdown in the right pane | `§ AC-6` | clear |
| R8 | Embedded HTML or script in a doc renders as text, never executes | `§ AC-7` | clear |
| R9 | "Used by N agents" per doc — enabled workspace agents whose effective set holds that doc **of this repo**, directly or via an enabled bound skill | `§ AC-8` | clear |
| R10 | The page stays read-only: no create, upload, rename or edit | `§ AC-9` | clear |
| R11 | `Project Context` in the WORKSPACE nav group, `g`+`d`, and a command-palette entry | `§ AC-43` | clear |
| R12 | Agent Context tab lists the active repo's docs, attached ones checked in saved order, badge "N of M attached" where N counts **own** attachments only | `§ AC-10` | clear |
| R13 | Filter field narrows to docs whose path contains the text | `§ AC-11` | clear |
| R14 | Drag-reorder persists as the order of these docs in the assembled `## Project context` | `§ AC-12` | clear |
| R15 | Saving stores the ordered list of **paths**, not text, and returns it in that order | `§ AC-13` | clear |
| R16 | A path failing the repo-relative rules → `400`, nothing saved | `§ AC-14` | clear |
| R17 | A repeated path saves one entry, at the first occurrence's position | `§ AC-15` | clear |
| R18 | An agent, skill or repo from another workspace → refuse, save nothing | `§ AC-16` | clear |
| R19 | Skill Context tab shows "Project context to use", "N attached", and the inheritance sentence | `§ AC-17` | clear |
| R20 | Skill editor shows a SERIALIZES AS block: `## Project context` + the ordered paths | `§ AC-18` | clear |
| R21 | Switching the active repository shows that repository's attachment set | `§ AC-44` | clear |
| R22 | Read-only "inherited from skills" group in the agent Context tab — no checkbox, no handle, source skill named per row, own counter | `§ AC-45` | clear |
| R23 | A doc attached to both the agent and its enabled skill: own attachment wins, the inherited row is marked already-attached, counted once in the token total | `§ AC-46` | clear |
| R24 | Footer "≈ N tokens" recomputed on every change, over the **whole effective set after dedupe** | `§ AC-19` | clear |
| R25 | The editor estimate comes from the same counter the server measures the budget with | `§ AC-20` | clear |
| R26 | Over budget → a warning naming the overage; saving stays enabled | `§ AC-21` | clear |
| R27 | Non-`single-pass` strategy → the editor states the **per-prompt** figure and the rule that under `map-reduce` the block is charged once per changed file. It names no product: the editor knows no pull request, so any multiplier would be a number about a PR that does not exist | `§ AC-22` | clear (answered 2026-08-13; `spec-creator` is rewriting AC-22 to this) |
| R28 | Inherited docs alone pushing the set over budget → the same warning in the agent editor | `§ AC-47` | clear |
| R29 | At run start, read the effective set from the default-branch clone and pass it as `## Project context` in set order | `§ AC-23` | clear |
| R30 | Effective set = agent's own docs in saved order, then each enabled bound skill's docs in binding order, deduped by path, first wins | `§ AC-24` | clear |
| R31 | Empty effective set → prompt assembled without the section, byte-identical to today | `§ AC-25` | clear |
| R32 | Each doc carries its repo-relative path **inside** the untrusted wrapper, beside its content | `§ AC-26` | clear |
| R33 | One trusted preamble line between the `## Project context` heading and the first `<untrusted …>`; `INJECTION_GUARD` unchanged | `§ AC-27` | clear |
| R34 | A file missing from the clone → skipped, run continues, status `missing` | `§ AC-28` | clear |
| R35 | A refused read (outside the clone root, `.git/`, symlink out) → skipped, status `refused` | `§ AC-29` | clear |
| R36 | Decoded content containing `U+0000` → skipped, status `binary` | `§ AC-30` | clear |
| R37 | A doc that does not fit the remaining budget → excluded, status `dropped`. **Stop at the first doc that does not fit**; it and every doc after it are recorded `dropped` — one explainable cut point, and what D5's "takes documents in set order until the budget is exhausted" describes | `§ AC-31` | clear (was ambiguous; confirmed 2026-08-13) |
| R38 | The first doc alone over budget → included truncated by code point, status `truncated` | `§ AC-32` | clear |
| R39 | Run repo ≠ the repo the attachments are bound to → no section, a reason in the run log, no same-named file substituted | `§ AC-33` | clear |
| R40 | Assembling the section makes zero extra model calls and zero network requests | `§ AC-34` | clear |
| R41 | A whole-set read failure → continue without the section, error in the run log, run not failed | `§ AC-35` | clear |
| R42 | `specs_read` carries the included paths in block order | `§ AC-36` | clear |
| R43 | The trace carries, per doc of the effective set, its path, token estimate and status | `§ AC-37` | clear |
| R44 | The Prompt-assembly block is labelled "Project context — attached specs (untrusted)" | `§ AC-38` | clear |
| R45 | Expanding it shows the full section text sent, wrappers and trusted line included | `§ AC-39` | clear |
| R46 | The AC-40 scenario: an invariant doc attached, a violating PR — full doc text in the trace block, its path in `specs_read` | `§ AC-40` | clear |
| R47 | That same run returns a finding whose text names the attached doc's path | `§ AC-41` | clear (model-dependent by the spec's own admission — `## Edge cases`, last row) |
| R48 | The **first** scan of a repo is enqueued lazily, on the first read of its doc list when a clone exists and no scan row does. Nothing else auto-scans; the clone job is not touched | assumed | **assumed** |
| R49 | Roots and budget are workspace settings keys `context_scan_roots` (default `["specs","docs","insights"]`) and `context_token_budget` (default `16000`), typed in `SettingsKnown` and written through the existing `PUT /settings` | `§ AC-48` + `§ Non-functional requirements` | clear |
| R50 | Per-doc token counts are computed at scan time over the **same rendered string** the run assembles, so the editor figure and the run figure agree for an unchanged clone | assumed, derived from `§ AC-20` | **assumed** |
| R51 | The workspace Settings screen exposes both keys, showing the spec's defaults when the workspace has never set them | `§ AC-48` | clear |

## Out of scope

**Every one of the spec's 48 `AC`s is an `R#` above. None was dropped.** What follows is scope
this plan refuses, not criteria it lost.

- The spec's own non-goals **N1–N6**, verbatim boundaries: no content-based auto-selection, no
  indexing/chunking/embeddings/pgvector/coverage ring, no create/upload/rename/edit controls, no
  reading from the PR head branch, no format but `.md`, no change to the grounding gate.
- **`IndexStatus` (`contracts/platform.ts:286-292`) is not used, not extended and not renamed.** Its
  `parsing`/`embedding` statuses and `chunks_indexed` describe N2, and the name is already taken
  three times with three shapes. `ContextScanState` carries R5 instead.
- **`POST /repos/:id/context/reindex`** — the path the existing `useReindexContext` stub calls — is
  not implemented. The hook is renamed and repointed (step 20); the reindex vocabulary belongs to
  the excluded feature.
- **No auto-scan on clone completion.** `modules/repos/service.ts` is not touched — it would need
  `modules/context`'s job kind, a `no-cross-module` edge (its existing `repo-intel` import of that
  shape is already in the arch baseline, and the baseline only shrinks).
- **No MCP tool and no `e2e/specs/*.flow.json`.** Neither is named by any criterion.
- **No cleanup of attachments whose file vanished.** The spec's `## Edge cases` requires the
  opposite: the row stays and shows `missing`.

## What already exists

| Path | What it gives us |
|---|---|
| `reviewer-core/src/prompt.ts:56,157-159,204,249` | `PromptParts.specs`, the `wrapUntrusted('spec-N', …)` join, the `## Project context` section, and its `describe(…, 'clone', …)` log line — the socket, wired and empty |
| `reviewer-core/src/review/run.ts:61` | `ReviewInput.specs?: string[]` — unchanged by this plan |
| `reviewer-core/src/prompt.ts:16-28,30-34` | `INJECTION_GUARD` (untouched, R33) and `wrapUntrusted`, which escapes a planted `</untrusted>` |
| `server/src/modules/reviews/run-executor.ts:254-285` | `gatherPromptContext` — the per-agent enrichment point, beside `buildSkillBodies` |
| `…/run-executor.ts:339-342` | the "resolved to nothing → byte-identical prompt" convention as conditional spreads (R31) |
| `…/run-executor.ts:462-501, 675-699` | the **two** places a `RunTrace` is built: `traceFromOutcome` (`specs_read: []`) and `traceFromBuffer` (`specs: null`) |
| `server/src/platform/trace-builder.ts:19-57` | `BuildTraceInput` + `buildRunTrace`, the third writer, which `RunTraceSchema.parse`s |
| `server/src/vendor/shared/adapters.ts:237-249` | `GitClient.readFile(repo, path, maxBytes)` — the bounded read, its cap a required argument |
| `server/src/adapters/git/simple-git.ts:129-185` | both-sides `realpath`, the `root + sep` containment test, the `.git/` segment refusal (the PAT lives in `.git/config`), and `open` + fixed buffer |
| `server/src/modules/intent/helpers.ts:49-71` | `sanitizeRepoPath` — the exact string gate R16 needs, currently inside the `intent` slice |
| `server/src/modules/intent/service.ts:161-190` | reading `.md` out of a clone through `container.git`, never `node:fs` |
| `server/src/modules/repo-intel/pipeline/walk.ts:73-122` | the walk this scan copies: never follow a symlink, skip excluded dirs, `stat` for size, posix relative paths, sorted |
| `server/src/modules/agents/service.ts:151-197` | replace-the-whole-ordered-set (`setSkills`) and `assertSkillsInWorkspace` — the precedents for R15/R17/R18 |
| `server/src/db/schema/agents.ts:64-82` | `agent_skills` with `order` (R30) and `agent_skills_skill_idx`, the "the PK's leading column is the wrong one for the reverse read" precedent R9 needs |
| `server/src/modules/_shared/feature-models.ts:26-34` | `SettingsReader`, the structural container slice that reads a workspace setting (R49) |
| `server/src/adapters/tokenizer/index.ts` | `container.tokenizer.count` — the one counter R25 binds the editor and the run to |
| `server/src/platform/jobs.ts:40-42` | concurrency 3, timeout 120 s, 2 retries — exactly the spec's rescan NFR, no new runner needed |
| `server/src/modules/repo-intel/routes.ts:30` | a module registering its own job handler from its `routes.ts` (R3) |
| `server/src/vendor/shared/contracts/platform.ts:278-284` | `SpecFile` — the never-served shape step 1a widens, byte-identical in the client copy |
| `client/src/lib/hooks/core.ts:160-175` | `useContextFiles` / `useReindexContext` — written against paths that 404 today, with a comment saying they are safe once the API exists |
| `client/.../AgentEditor/_components/SkillsTab/SkillsTab.tsx` · `lib/hooks/agents.ts:111-118` | checkbox binding, drag handle **and arrow keys**, filter input, "N of M" badge, one replace-the-ordered-array request — AC-10…AC-12's interaction, already built |
| `client/.../AgentEditor/constants.ts:11-14` · `AgentEditor.tsx:22-24` · `SkillDetail/constants.ts:15-20` | the two tab registries and the render branch a Context tab plugs into |
| `client/.../RunTraceDrawer/TraceBody.tsx:94-96` · `PromptBlock.tsx:24,42` · `constants.ts:21` | the `## Project context` block is already rendered, expandable, copyable and size-badged — under a stale label |
| `client/src/components/app-shell/helpers.ts:30` · `messages/en/shell.json:17` | `activeKeyFor()` already returns `"context"` for a `/context` path, and `nav.context` = "Project Context" already exists |
| `client/src/vendor/ui/nav.ts:21-36` · `:58-68` | `NAV` (three dynamic consumers) and `SHORTCUTS` (hand-maintained, rendered by `ShortcutsHelp.tsx:4`, **not** derived from `NAV`) |
| `client/src/lib/tokens.ts:9-11` | `approxTokens` — `ceil(length/4)`, right for a size badge, wrong for a budget decision |

**Nothing exists** for: the scan, any of the four tables, the attachment routes, the clone-walk
port method, the trusted preamble, the per-doc trace list, the Project Context page or route
segment, a Context tab in either editor, or a SERIALIZES AS pattern anywhere in the repo.
`client/messages/en/context.json` exists with eight keys, **no consumer**, and copy that
contradicts the approved spec — step 21 deals with it.

## Constraints

| Rule | Source |
|---|---|
| `vendor/shared` is two physical copies; the server copy is the source of truth, `reviewer-core` aliases it, and `diff -r` is the only thing that sees drift | root `AGENTS.md`; `gates.md` → `repo · vendor` |
| `vitest.config.ts` repeats the tsconfig `paths`; a path added to one and not the other breaks tests while typecheck passes | `server/AGENTS.md` "Conventions" |
| Fastify modules are registered by hand in `server/src/modules/index.ts` — no filesystem autoload | `server/src/modules/index.ts:16-28` |
| `server/` and `client/` use **pnpm**; `reviewer-core/` uses **npm** | root `AGENTS.md`; `gates.md` |
| No Drizzle outside `repository.ts`; no `container.db` in a route; a service takes its repository as a **parameter typed as an interface**, not as the class | `onion-architecture` §3.2-3.3; `server/INSIGHTS.md:316-329` |
| A service the container constructs must **not** import `Container` — declare the slice structurally in the module's `types.ts` | `server/INSIGHTS.md:181-200`; `.dependency-cruiser.cjs` `no-circular` |
| `modules/context` may not import any other `modules/<slice>/`, `import type` included (`tsPreCompilationDeps: true`) | `.dependency-cruiser.cjs` `no-cross-module`; `modules/blast/types.ts:1-21` |
| An adapter may not import `modules/**` — a constant an adapter needs lives beside the adapter | `.dependency-cruiser.cjs` `no-adapter-to-module`; `onion-architecture` §5 |
| A service may not touch `node:fs`; clone access goes through `GitClient` | `.dependency-cruiser.cjs` `no-fs-in-service` |
| `reviewer-core` keeps two runtime deps, `openai` and `zod`; anything else arrives as a parameter | `reviewer-core/AGENTS.md`; `onion-architecture` §3.8 |
| `vendor/shared/**` may import only zod and itself | `.dependency-cruiser.cjs` `contracts-stay-pure` |
| Truncate by **code point** (`[...text].slice`), and truncate **before** `wrapUntrusted`, never after | `server/INSIGHTS.md:166-180, 246-258` |
| Every new port method needs an implementation in `adapters/mocks.ts` | `onion-architecture` §3.4 |
| Secrets never reach `AppConfig` or `process.env`; the clone's `.git/` holds the PAT and stays unreadable | `onion-architecture` §3.7; `simple-git.ts:150-159` |
| `*.it.test.ts` = testcontainers Postgres; everything else must be hermetic | `server/AGENTS.md` "Tests" |
| Client: no `fetch` in a component — data arrives through a hook in `src/lib/hooks/*` | `client/AGENTS.md`; `frontend-architecture` step 4 |
| Never render untrusted markdown through `dangerouslySetInnerHTML` unsanitised; reject a non-`http(s)` `href`/`src` | `security` A05 |
| **Nothing new may be called `IndexStatus`** — the name already denotes three different shapes | `contracts/platform.ts:286`; `repo-intel/types.ts:25`; `contracts/blast.ts:30` |

## Recommendations

For the human, not the implementer. The steps are written to the requirements as they stand.

**Three of the four recommendations in the first draft were answered on 2026-08-13 and are now
requirements, not proposals:** AC-22 states the rule rather than a product (R27), AC-31 is settled
as stop-at-first (R37), and the Settings panel is in scope as AC-48 (R51). One stands.

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Enqueue the first scan from the clone job rather than lazily on first read (R48), so the page is warm before anyone opens it | Yes — replaces the lazy trigger in step 15 | A `no-cross-module` edge that would have to be baselined; the baseline only shrinks, so this is a real cost |

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| 1, 2, 3, 4 | `zod` | Four contract edits across both vendored copies — snake_case objects, enums, `z.infer` exports, `.default()` on a field added to an already-persisted document |
| 6 | `postgresql-table-design` · `drizzle-orm-patterns` | Four new tables, their composite PKs, and the **reverse-direction** indexes R9's "used by" query rides; the migration is additive-only, so one `db:generate` run |
| 7, 8 | `security` | A new clone-walk entry point over attacker-controlled repo content — roots, symlinks, `.git/`, size and count bounds |
| 9 | `zod` | Only if the preamble constant needs a contract change; it should not |
| 10-18 | `onion-architecture` | Ring placement of the whole new slice: the structural container port, the repository seam typed as an interface, pure helpers, the composition-root wiring |
| 13, 14 | `drizzle-orm-patterns` | The replace-the-set write, the effective-set read, and the "used by N agents" aggregate |
| 16 | `fastify-best-practices` · `security` | Route `schema` declaration, per-route `rateLimit` on the rescan, tenancy resolved before any write (A01), array-length bound (A08) |
| 19 | `onion-architecture` | `run-executor.ts` is an `*-executor` — the same ring rules as a service, `no-fs-in-service` included |
| 20-29 | `frontend-architecture` · `next-best-practices` | Page and component placement, `'use client'` on the leaf, hooks in `src/lib/hooks/`, URL vs local state for the selected document, and where a Settings control belongs |
| 24, 25 | `react-best-practices` | Derived-during-render token totals — no query data copied into `useState` |
| 22, 23 | `security` | AC-7 stored-XSS: markdown from an imported public repo, rendered on the page and in the trace |
| 22, 24 (tests) | `react-testing-library` | Component tests; `fireEvent`, not `user-event` (not installed) |

## Steps

The order is binding: every stage typechecks only once the one before it has landed.

### Stage 1 — contracts and schema

**1a. Extend `SpecFile`, do not shadow it** — `server/src/vendor/shared/contracts/platform.ts:277-292`,
under the existing `// ---- Project Context ----` comment. The spec is explicit that `SpecFile` and
`useContextFiles` "are the extension point, not a reason to open a parallel contract"
(`§ Module interactions`), and the inventory confirms nothing consumes `SpecFile` today beyond a
type re-export at `client/src/lib/types.ts:30-31`. So widen it in place and add the three enums
beside it, so `platform.ts` never has to import the new file:

```
ContextDocKind   = z.enum(['specs','docs','insights','other'])
ContextScanState = z.enum(['no_clone','scanning','scanned','failed'])
ContextDocStatus = z.enum(['included','truncated','dropped','missing','refused','binary'])
SpecFile         = { path, content: nullish, size: nullish, updated_at: nullish,   // unchanged
                     root, kind: ContextDocKind, tokens, used_by_agents }          // added
```

**`ContextDocKind` has four values, and the fourth is a requirement, not a fallback.** A document
found under a configured root whose folder name is not `specs`, `docs` or `insights` is kind
`other` and gets its own badge (R1, amended AC-1). Anywhere this enum is restated — the Drizzle
column's `{ enum: [...] }`, the badge map on the page, any test fixture table — it carries all
four; three values plus a default is the version that silently mislabels every custom root.

**`IndexStatus` at `:286-292` is not touched, not reused, and nothing new is named `IndexStatus`.**
That name is already taken three times with three different shapes — here, `repo-intel/types.ts:25`
(`full|partial|degraded|failed`) and `BlastIndexStatus` (`contracts/blast.ts:30`) — and this one's
`parsing`/`embedding`/`chunks_indexed` vocabulary belongs to the feature N2 excludes.
`ContextScanState` is the fourth shape and carries a fourth name on purpose.

**1b. `server/src/vendor/shared/contracts/context.ts` (new)** — the composite shapes, importing the
enums and `SpecFile` from `./platform.js` (one direction only; a cycle between two contract files
would be a `no-circular` error, not a style problem):

```
ContextDocsPage     = { state: ContextScanState, roots: string[], budget_tokens,
                        file_count, bounded, scanned_at: nullable, last_error: nullable,
                        last_error_at: nullable, documents: SpecFile[] }
AttachedContextDoc  = { path, position, tokens: nullable, missing: boolean }
InheritedContextDoc = { path, tokens: nullable, skill_id, skill_name, also_attached: boolean }
AgentContextDocs    = { repo_id, attached: AttachedContextDoc[], inherited: InheritedContextDoc[] }
SkillContextDocs    = { repo_id, attached: AttachedContextDoc[] }
SetContextDocsBody  = { repo_id: z.string().uuid(), paths: z.array(z.string()).max(50) }
```

`documents` reuses `SpecFile` with `content` left null; the single-document read returns the same
`SpecFile` with `content` populated, so there is one document shape, not two. `tokens` is nullable
on an *attachment* because a saved path may not be in the current scan (spec `## Edge cases`:
attachments show saved paths without sizes or tokens while the clone is in flight); `missing` is
that same fact stated positively. Add `export * from './contracts/context.js';` to
`server/src/vendor/shared/index.ts` plus one line in its header inventory. *Serves R1, R2, R5, R6,
R9, R12, R15, R22, R43.* *Check:* `cd server && pnpm typecheck`.

**2. `server/src/vendor/shared/contracts/trace.ts` — the per-doc run list.** Add

```
RunProjectContextDoc = { path, tokens: z.number().int(), status: ContextDocStatus }
```

imported from `./context.js` (contract-to-contract is allowed by `contracts-stay-pure`), and one
field on `RunTrace`: `project_context: z.array(RunProjectContextDoc).default([])`. **`.default([])`
is load-bearing** — `run_traces` is full of documents written before this field existed and
`RunTrace` is `parse`d on read as well as write. Note that `z.infer` still makes the field
*required on the output type*, so all three trace writers stop compiling until step 19 fills them;
that is the intended forcing function. *Serves R43.*

**3. `server/src/vendor/shared/adapters.ts` — the walk, and a typed refusal.** Two additions:

```ts
export interface ClonedFile { path: string; size_bytes: number; modified_at: string }
export type CloneReadRefusal = 'outside_clone' | 'git_dir' | 'not_found';
export class CloneReadError extends Error { constructor(readonly reason: CloneReadRefusal, message: string) … }
```

and one method on `GitClient`:

```ts
listFiles(repo: RepoRef, opts: {
  roots: string[]; extensions: string[]; maxFiles: number; maxFileBytes: number;
}): Promise<{ files: ClonedFile[]; bounded: boolean }>;
```

`CloneReadError` is what makes R34 and R35 distinguishable: matching on an `Error` message to tell
"not in the clone" from "refused to leave the clone" is a status the next refactor silently
inverts. The class imports nothing, so `contracts-stay-pure` holds. *Serves R1, R34, R35.*

**4. `SettingsKnown` in `contracts/platform.ts:91-99`** gains
`context_scan_roots: z.array(z.string()).default(['specs','docs','insights'])` and
`context_token_budget: z.number().int().positive().default(16000)`. Typed keys in the existing bag —
no new endpoint. Step 29 puts the Settings screen's two controls on top of them.
*Serves R6, R26, R49, R51.*

**5. Mirror steps 1-4 to the client.** Copy `contracts/context.ts` verbatim to
`client/src/vendor/shared/contracts/context.ts`, apply the identical edits to the client's
`contracts/trace.ts`, `contracts/platform.ts` (its `SpecFile` sits at the same `:278-292` and is
byte-identical today), `adapters.ts` and `index.ts`, and add the new page/editor types to the
existing re-export at `client/src/lib/types.ts:30-31` — types only, never schemas
(`client/AGENTS.md`). **This is a step, not a footnote:** each package compiles against its own
copy, so typecheck is blind to one-sided drift and the `repo · vendor` gate is the only detector.
*Check:* `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing.

**6. Four tables in `server/src/db/schema/context.ts`.** All additive, so a single
`pnpm db:generate` run — the two-run add-then-drop dance in `server/AGENTS.md` does not apply.

- `repo_docs` — `id uuid pk`, `workspaceId`, `repoId` (FK cascade), `path text`, `root text`,
  `kind text`, `sizeBytes integer`, `tokens integer`, `modifiedAt timestamptz`,
  `scannedAt timestamptz`. `uniqueIndex(repoId, path)`; plus **`index(repoId)`** — Postgres does
  not index an FK column for you.
- `repo_doc_scans` — `repoId uuid pk` (FK cascade), `roots jsonb`, `fileCount integer`,
  `bounded boolean`, `scannedAt timestamptz nullable`, `lastError text nullable`,
  `lastErrorAt timestamptz nullable`. One row per repo; the nullable pair is exactly R4 — the
  failure is recorded *beside* the last success, never over it.
- `agent_context_docs` — `agentId` (FK cascade), `repoId` (FK cascade), `path text`,
  `position integer`; `primaryKey(agentId, repoId, path)` plus
  **`index('agent_context_docs_repo_path_idx').on(repoId, path)`**. The second index is not
  optional: the PK leads with `agentId` and R9's query reads in the opposite direction, which is
  the same mistake `agent_skills_skill_idx` was added to fix (`db/schema/agents.ts:77-80`).
- `skill_context_docs` — the same four columns with `skillId`, the same PK shape, the same
  `(repoId, path)` index.

`text` not `varchar(n)`, `timestamptz` not `timestamp`. Add all four to the `schema` object and
the import list in `server/src/db/schema.ts`, and their `$inferSelect` row types to
`server/src/db/rows.ts` beside the others. *Then:* `pnpm db:generate && pnpm db:migrate`.
*Serves R1, R2, R4, R9, R15, R21, R30.*

### Stage 2 — the clone port

**7. `SimpleGitClient` — `listFiles`, and `CloneReadError` from `readFile`.**
`listFiles` resolves each root with `realpath(join(cloneRoot, root))` and skips it when it escapes
`root + sep` or resolves into `.git` — the same both-sides check `readFile` already makes, applied
to a directory. It then walks copying `repo-intel/pipeline/walk.ts:73-122`: never descend a
symlink (`entry.isSymbolicLink()` → `continue`), skip excluded directory names, match the
extension case-insensitively (`.MD` counts — spec `## Edge cases`), `stat` for size and mtime,
drop anything over `maxFileBytes`, emit posix repo-relative paths, `sort()`, then cap at
`maxFiles` and set `bounded`. A root that does not exist contributes nothing and is not an error
(R6). A missing clone directory throws — the service maps that to `no_clone`.

The excluded-directory list goes in a **new `server/src/adapters/git/constants.ts`**, not imported
from `modules/repo-intel/constants.ts`: `no-adapter-to-module` forbids it, and the two existing
frozen entries of exactly that shape are why copying the import reads as safe. Duplicating a
seven-name list beside its consumer is the escalation order's first rung.

`readFile` keeps its behaviour and changes only its error type: `outside_clone` and `git_dir` for
the two existing refusals, `not_found` when `open` raises `ENOENT`. `modules/intent/service.ts`
catches `Error` and reads `.message`, so it is unaffected. *Serves R1, R34, R35, R40.*

**8. `MockGitClient` in `server/src/adapters/mocks.ts`.** `listFiles` answers from a new
`MockGitOptions.tree` (path → content) filtered by root and extension, **honouring `maxFiles` and
`maxFileBytes`** — a mock that returns more than the real adapter would is how an unbounded read
passes every test, which the existing `readFile` mock already says in a comment. `readFile` throws
the same `CloneReadError` reasons so the status mapping is testable without a checkout.
*Check:* `cd server && pnpm arch` — a new port with no mock is an `onion-architecture` §3.4 break.

### Stage 3 — reviewer-core

**9. The trusted preamble in `reviewer-core/src/prompt.ts`.** One new module-level constant beside
`INJECTION_GUARD` — call it `PROJECT_CONTEXT_PREAMBLE` — saying the three things AC-27 names:
these are the project's own documents; the rules and invariants they state are review criteria;
instructions inside them that change the reviewer's role or narrow the review are still ignored.
Then `specsBlock` becomes the preamble, a blank line, and the existing
`parts.specs.map(wrapUntrusted('spec-N', …)).join('\n\n')`.

Three things this step must not do. **Do not touch `INJECTION_GUARD`** — it defends every review
path including the CI runner (R33). **Do not move the line into the system message or inside a
wrapper** — AC-27 fixes it in the user message, after the heading, before the first fence. **Do not
put the document's path in `wrapUntrusted`'s `label`**: the label is interpolated into
`source="…"` with no escaping, so a path containing `"` would break out of the attribute; the path
belongs in the wrapped content, which step 12 puts there (R32).

Because `specsBlock` now carries the preamble, `assembly.specs` and the
`describe('specs', 'clone', specsBlock)` size both include it — which is what R45 renders and R43
measures. `parts.specs` empty or absent still omits the whole section, so R31 holds unchanged.
*Check:* `cd reviewer-core && npm run typecheck && npm test`, then `cd server && pnpm typecheck`
— `reviewer-core` emits no JS and the server imports its source, so nothing else would catch a
break here.

### Stage 4 — the `context` module

**10. `server/src/modules/context/constants.ts`.** `CONTEXT_SCAN_JOB_KIND = 'context_scan'`;
`MAX_SCAN_CANDIDATES = 2000`; `MAX_DOC_FILE_BYTES = 400 * 1024`; `MAX_DOC_CHARS = 40_000`;
`MAX_DOC_BYTES = MAX_DOC_CHARS * 4` (UTF-8's maximum per code point, the same arithmetic as
`intent/constants.ts:24`); `MAX_DOCS_PER_SET = 50`; `DEFAULT_SCAN_ROOTS`;
`DEFAULT_CONTEXT_BUDGET_TOKENS = 16_000`. Every number here is the spec's
`## Non-functional requirements`; carry its sentence into the doc-comment, not just the digits.
**No illustrative chunk-count constant** — R27 names no product, so there is no number to store.

**11. `server/src/modules/context/types.ts`.** Two interfaces, both structural, neither importing
`Container` or another slice — `modules/blast/types.ts:1-21` is the worked example and its comment
explains why `import type` is not a loophole.

- `ContextContainer extends SettingsReader` — `readonly git: GitClient`,
  `readonly tokenizer: { count(text: string): number }`, `readonly jobs: { enqueue(…) }`.
- `ContextReads` / `ContextWrites` — the repository seam, declared as an **interface** listing the
  methods the service calls. Not the repository class: a class with `private db` cannot be
  satisfied by an object literal, so a fake needs a lying cast, and that — not the constructor
  default — is why three services in this repo have no hermetic tests
  (`server/INSIGHTS.md:316-329`).

Also declare `ProjectContextResolver`, the port `platform/container.ts` will expose to the review
path, and its result type:

```ts
export interface ProjectContextResult {
  blocks: string[];                    // one rendered doc each, path inside, in block order
  docs: { path: string; tokens: number; status: ContextDocStatus }[];
  includedPaths: string[];             // specs_read, block order
  note: string | undefined;            // the run-log line for R39 / R41
}
export interface ProjectContextResolver {
  resolveForRun(input: { workspaceId: string; agentId: string; repoId: string;
                         repo: { owner: string; name: string } }): Promise<ProjectContextResult>;
}
```

**12. `server/src/modules/context/helpers.ts` — pure, calls nothing.**

- `kindForRoot(root)` → `ContextDocKind`, first path segment lowercased, `other` when unmatched.
- `renderDoc(path, text)` → `` `### ${path}\n\n${text}` ``. **One function, two callers** — the
  scanner counts tokens over its output and the run resolver builds blocks from it, which is the
  whole of R50 and what makes R25 true rather than approximately true.
- `effectiveSet(own, bySkill)` → ordered `{ path, source }[]`: own attachments by `position`, then
  each enabled skill's attachments by `(agent_skills.order, position)`, deduped by path with the
  first occurrence winning (R30, R23).
- `selectWithinBudget(docs, budget, count)` → `{ blocks, results }`. `count` is a **parameter**,
  so this file needs no tokenizer and is unit-testable with `s => s.length`. Walk in order; the
  first doc that does not fit **stops the walk**, and it and every doc after it are `dropped`
  (R37 — settled, not a guess: a later smaller document does **not** get to jump the queue). If
  the *first* doc alone exceeds the budget, include it truncated and mark it `truncated` (R38).
- `truncateToBudget(text, budget, count)` → binary search over **code points**
  (`[...text].slice(0, n).join('')`), at most 12 `count` calls, mirroring the repo-map budget
  search. `String.slice` splits a surrogate pair (`server/INSIGHTS.md:246-258`).
- `toDocDto(row, usedBy)` — a `*Row` never leaves this module (`onion-architecture` §3.5).

**13. `server/src/modules/context/repository.ts`.** `constructor(private db: Db) {}`, no
`Container`. Reads: the repo row (`workspaceId`, `owner`, `name`, `clonePath`, `defaultBranch`)
scoped by workspace; the scan state; docs for a repo with the "used by N agents" count; one
agent's attachments for a repo **and its attachment count across all repos** (R39 needs to tell
"nothing attached" from "attached, to a different repo" in one round trip); one skill's
attachments; the agent's enabled bound skills with their `order` and their attachments for the
repo; workspace-membership checks for an agent id, a skill id and a repo id (R18).

The "used by" count is one aggregate over `agents` left-joined to `agent_context_docs` and to
`agent_skills → skills → skill_context_docs`, filtered on `agents.enabled` and
`skills.enabled`, counting **distinct agent ids** per `(repo_id, path)`. Two modules already count
`agent_skills` in opposite directions and both needed the same two joins
(`server/INSIGHTS.md:266`) — read that entry before writing this one. State the `ORDER BY`
explicitly on every list read: an aggregate without one reshuffles for no visible reason
(`server/INSIGHTS.md:69-80`).

Writes: replace-the-whole-set for an agent and for a skill, inside one transaction (delete for
`(owner, repoId)` then insert with `position` = array index), and the scan's replace-all plus the
scan-state upsert.

**14. `server/src/modules/context/scan-executor.ts` — the background scan.** Named as an executor
so the arch rules that bind a service bind it too. `run({ workspaceId, repoId })`:

1. read the repo row; no `clonePath` → record `no_clone` and stop;
2. `container.git.listFiles(repo, { roots, extensions: ['.md'], maxFiles: MAX_SCAN_CANDIDATES, maxFileBytes: MAX_DOC_FILE_BYTES })`;
3. per file, `readFile(repo, path, MAX_DOC_BYTES)` → truncate to `MAX_DOC_CHARS` →
   `container.tokenizer.count(renderDoc(path, text))`;
4. replace the repo's `repo_docs` rows and write `repo_doc_scans` with `fileCount`, `bounded`,
   `scannedAt = now`, `lastError = null`;
5. on any throw: write **only** `lastError` / `lastErrorAt`, leave the docs and `scannedAt`
   untouched, then rethrow so `JobRunner` records the job failed and retries. That untouched-ness
   is R4, and it is why the failure path writes a different set of columns rather than a status.

The whole handler runs under `JobRunner`'s existing 120 s / 2 retries / concurrency 3
(`platform/jobs.ts:40-42`) — the spec's numbers, already configured. **Watch the tokenizer cost:**
2000 documents × up to 40 000 code points is the worst case inside that timeout. Measure it once
on a real repo before assuming it fits; if it does not, the honest fix is a lower
`MAX_SCAN_CANDIDATES`, not a cheaper counter — a different counter breaks R25.

**15. `server/src/modules/context/service.ts`.** `constructor(container: ContextContainer, repo: ContextReads & ContextWrites = new ContextRepository(container.db))` — the defaulted parameter keeps call sites unchanged and is the seam the tests use (`onion-architecture` §3.3).

- `docsPage(workspaceId, repoId)` → `ContextDocsPage`. No clone path → `state: 'no_clone'` (R5).
  Clone present and **no scan row** → enqueue `CONTEXT_SCAN_JOB_KIND` and return
  `state: 'scanning'` with an empty list (R48). Otherwise return the persisted rows, the roots, the
  budget, and the scan state — `failed` when `lastErrorAt` is newer than `scannedAt`, carrying both
  (R4). It never walks the disk (the p95 < 300 ms NFR).
- `rescan(workspaceId, repoId)` → enqueue, return `{ status: 'scanning' }` (R3).
- `docContent(workspaceId, repoId, rawPath)` → sanitize the path, **require a `repo_docs` row for
  it**, then `readFile` bounded and truncate. Requiring the row is deny-by-default (`security`
  A01): the reader serves scanned documents, not arbitrary clone paths.
- `agentDocs` / `setAgentDocs` / `skillDocs` / `setSkillDocs`. The setters: assert the agent/skill
  **and the repo** belong to the caller's workspace before any write (R18 — a link table's foreign
  key proves existence, not tenancy, `server/INSIGHTS.md:214`), `sanitizeRepoPath` every entry and
  reject the **whole** request on the first failure (R16), dedupe keeping first position (R17),
  then replace the set. `agentDocs` also returns the inherited group with `also_attached` computed
  (R22, R23).
- `resolveForRun(...)` — the `ProjectContextResolver` implementation (R29-R41). Build the effective
  set; empty → `{ blocks: [], docs: [], includedPaths: [], note: undefined }`, and the run
  executor's conditional spread then omits the section byte-identically (R31). Non-empty but the
  agent has attachments only for **other** repos → the same empty result with a `note` naming the
  run's repo and the bound repo (R39). Read each doc through the port; map `CloneReadError.reason`
  `not_found` → `missing` (R34) and `outside_clone` / `git_dir` → `refused` (R35); a decoded body
  containing `U+0000` → `binary` (R36); otherwise `renderDoc` and hand the list to
  `selectWithinBudget` (R37, R38). Wrap the whole thing so a port failure returns an empty result
  with a `note` rather than throwing (R41). **No LLM, no network, no `node:fs`** (R40).

**16. `server/src/modules/context/routes.ts`.** A default Fastify plugin,
`app.withTypeProvider<ZodTypeProvider>()`, copying `modules/intent/routes.ts`. Every route declares
`schema` — never a hand-rolled `Schema.parse(req.body)` (`server/README.md`) — and resolves tenancy
with `getContext` before anything else.

```
GET  /repos/:id/context/docs                → ContextDocsPage
GET  /repos/:id/context/docs/content?path=  → ContextDocContent   (404 not_found, 400 invalid path)
POST /repos/:id/context/rescan              → { status: 'scanning' }   rateLimit { max: 6, timeWindow: '1 minute' }
GET  /agents/:id/context-docs?repo_id=      → AgentContextDocs
PUT  /agents/:id/context-docs               → AgentContextDocs   body SetContextDocsBody
GET  /skills/:id/context-docs?repo_id=      → SkillContextDocs
PUT  /skills/:id/context-docs               → SkillContextDocs   body SetContextDocsBody
```

The rate limit is on the rescan alone: it is the only one that starts a job (`security` A06). The
`.max(50)` on `paths` rejects an oversized body outright rather than truncating it silently — the
spec's `## Untrusted inputs` asks for exactly that. This file also calls
`service.registerScanJobHandler()` once at registration, the way `repo-intel/routes.ts:30` does.
Registering `/agents/...` and `/skills/...` paths from this module is deliberate and has precedent
(`intent` owns `/pulls/:id/intent`); it is what keeps the slice from importing `modules/agents`.

**17. Register the module.** One import and one entry in `server/src/modules/index.ts`.

**18. Wire the container.** `platform/container.ts` gains a `projectContext: ProjectContextResolver`
getter that constructs `ContextService` with `new ContextRepository(this.db)` — the composition
root names the concrete types, which is what keeps `Db` off `ContextContainer` — plus
`ContainerOverrides.projectContext` so a review test injects a canned resolver and reaches no
clone. Follow `intentService` (`container.ts:202-208`) exactly.
*Check:* `cd server && pnpm arch` reports no `no-circular` and no `no-cross-module` edge from
`modules/context/`.

### Stage 5 — the run path

**19. `server/src/modules/reviews/run-executor.ts`.** `modules/reviews` may not import
`modules/context`, so the resolver arrives as `container.projectContext` with no import statement
at all — the route `intentService` and `repoIntel` already take.

- `PromptContext` (`:52-58`) gains `projectContext: ProjectContextResult`.
- `gatherPromptContext` resolves it beside `buildSkillBodies` (`:282`) — this is **per agent**, not
  per batch, because the effective set is the agent's own attachments plus its own skills. Emit
  one run-log line: how many documents went, their token total, and any `note` (R39, R41 — "never
  go silent").
- `callEngine` adds `...(context.projectContext.blocks.length > 0 ? { specs: context.projectContext.blocks } : {})`.
  A conditional spread, not `specs: undefined` — the file's own comment at `:339-342` explains why,
  and R31 is that comment's promise.
- `persistSuccess` takes `context` as a parameter and passes it to `traceFromOutcome`, which sets
  `specs_read: context.projectContext.includedPaths` (`:496`, R42) and
  `project_context: context.projectContext.docs` (R43).
- `traceFromBuffer` (`:675-699`) and `platform/trace-builder.ts` (`BuildTraceInput` +
  `emptyPromptAssembly`) get `project_context: []`. Step 2's `z.infer` makes all three fail to
  compile until they do; do not silence one with a cast.

*Check:* `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` and `pnpm arch`.

### Stage 6 — client

The client surface was inventoried directly on 2026-08-13; every `path:line` below was read, not
inferred. All of it dates to the initial squashed commit `587c46a` and has never been touched — it
is course scaffolding that never got a server, not a half-finished recent change. Two rules follow
from that: **extend what exists rather than defining the same concept twice**
(`frontend-architecture` principle 6), and **do not preserve scaffolding that contradicts the
approved spec** just because it is there.

**20. Hooks — rewrite the two stubs in `client/src/lib/hooks/core.ts:160-175`.** `useContextFiles`
(`GET /repos/:id/context`) and `useReindexContext` (`POST /repos/:id/context/reindex`) were written
against a server that never shipped; their comment says they are "safe to call once API exposes
it", and today they 404. **The server does not adopt those two paths.** `useContextFiles` is
rewritten in place to `GET /repos/:id/context/docs` returning `ContextDocsPage` — the name and the
call site survive, which is the spec's "extension point" instruction honoured. `useReindexContext`
is **renamed** to `useRescanContextDocs` and pointed at `POST /repos/:id/context/rescan`: "reindex"
is the vocabulary of the chunk-and-embed feature N2 excludes, and keeping it would make the empty
half of `IndexStatus` look implemented.

Add, in a new `client/src/lib/hooks/context.ts` beside them: one document's content, agent docs
(read + set), skill docs (read + set). Mirror the save semantics of `useSetAgentSkills`
(`client/src/lib/hooks/agents.ts:111-118`) — one request replacing the whole ordered array. Query
keys carry the repo id so R21's repo switch refetches instead of rendering the previous repo's
set. No aggregating barrel (`client/INSIGHTS.md:317`).

**21. `client/messages/en/context.json` — rewrite, do not extend.** Eight keys exist, no
`useTranslations` call anywhere in `client/src` reads them, and two of them contradict the approved
spec: `mode.preview` / `mode.edit` and `editor.save` / `editor.saving` describe in-UI editing that
N3 and D4 exclude, and `empty.body` names a single hard-coded `.devdigest/specs/` root where the
spec has workspace-configurable roots. Delete those four keys, rewrite `empty.body` to interpolate
the roots the server returned, and add the keys steps 22-24 need. Because nothing reads the file
today, this is free to do and silently wrong to skip.

**22. The Project Context page — new, under `app/repos/[repoId]/context/`.** No `*ProjectContext*`
file and no `/context` route segment exists anywhere. Two panes: the document list (path, root, kind
badge — **four kinds, `other` included** (R1) — and "Used by N agents", R9) and the rendered
document (R7). Footer shows **only** the
file count and the last-scanned time (R2), plus the failed-attempt marker beside the previous
success time when `state === 'failed'` (R4). Rescan control (R3).

Branch the four states before rendering the list, in this order, none masking another — `no_clone`
→ the clone-preparing state with a retry (R5); `scanning`; `failed`; `scanned` with an empty
`documents` → the empty state naming `roots` (R6). Write down what a **disabled** query renders
before fixing that order: a disabled TanStack v5 query reports `isLoading === false`
(`client/INSIGHTS.md:490-517`). No create, upload, rename or edit control anywhere on the page
(R10). The selected document goes in the **URL**, not `useState` — it is shareable
(`frontend-architecture` principle 5).

**23. Markdown rendering (R8) — use `client/src/vendor/ui/primitives/Markdown.tsx`.** The primitive
exists: `ReactMarkdown` with `remarkPlugins={[remarkGfm]}` (`:10-11`), over `react-markdown` `^9.0.3`
and `remark-gfm` `^4.0.0` already in `client/package.json`. No new dependency, and nothing to choose.

**AC-7 is satisfied by what is already installed, and by one thing staying uninstalled.**
`react-markdown` v9 escapes embedded raw HTML unless `rehype-raw` is added, and `rehype-raw` is not
a dependency of this project. So the instruction is negative and specific: **do not add `rehype-raw`,
and do not open a `dangerouslySetInnerHTML` path** — either one turns a document from an imported
public repo into stored XSS (`security` A05). Anyone who reaches for one to make a table or an
alignment work has re-opened the hole this criterion exists to close.

The **link-protocol restriction is not covered by the primitive** and is real work: check what
`Markdown.tsx` renders for a link and an image, and reject any `href`/`src` whose protocol is not
`http:` or `https:` — `javascript:` above all. Prefer doing it at the call site (a `components`
override passed by the page) so the primitive is untouched. **If it genuinely has to happen inside
`Markdown.tsx`, that is a deliberate edit to a vendored file** — the same class of decision as the
`vendor/ui/nav.ts` rows in step 28, and the same cost: a UI-kit update overwrites it. Make that
call explicitly and say so in the commit; do not slide into it mid-implementation.

**24. Agent editor → Context tab — copy `SkillsTab`.** `AgentEditor/_components/SkillsTab/SkillsTab.tsx`
already implements exactly the interaction AC-10…AC-12 describe: a checkbox as the binding, a drag
handle **plus arrow keys** for order, a filter input, an "N of M" badge, and one
replace-the-whole-ordered-array request. Follow it rather than inventing a second interaction, and
keep the arrow-key affordance — it is the keyboard path for R14. Register the tab in
`AgentEditor/constants.ts:11-14` (`TABS = config, skills` → plus `context`) and add its branch at
`AgentEditor.tsx:22-24`.

What differs from `SkillsTab`: the badge's N counts **own** attachments only (R12), the set is
scoped by the active repository and swaps wholesale when it changes (R21, with unsaved toggles of
the previous repo dropped), and below the editable list sits a **read-only "inherited from skills"
group** — no checkbox, no drag handle, the source skill named on each row, its own counter (R22),
and a row already attached to the agent marked as such (R23).

**25. The budget footer (R24-R28).** "≈ N tokens" derived **during render** from the two arrays the
server sent, never copied into `useState` (`react-best-practices`). Sum own + inherited after
deduping by path, so a doc attached in both places counts once (R23, R24).

**`approxTokens` (`client/src/lib/tokens.ts:9-11`) must not be used here.** It is
`ceil(length / 4)`, it is correct where it already runs — the size badge on `PromptBlock.tsx:42`
and `SkillBodyEditor.tsx:44` — and it is the wrong number to make a budget decision against. AC-20
requires the editor's figure to be the server's counter, so the footer sums the `tokens` field the
server sent and calls nothing local (R25). Over `budget_tokens` → a warning naming the overage,
save still enabled (R26); it measures the effective set, so inherited documents alone can trip it
(R28).

When the agent's strategy is not `single-pass`, state **the per-prompt figure and the rule** — the
block is assembled again for every chunk, so under `map-reduce` it is charged once per changed
file (R27). **Do not multiply it by anything.** The editor is open on an agent, not on a pull
request; any file count it could reach for would be a number about a PR that does not exist, and a
concrete total is read as a measurement rather than an illustration. The rule is what the reader
needs to size the cost of the PR in front of them later.

**26. Skill editor → Context tab.** Register in `SkillDetail/constants.ts:15-20`
(`TABS = config, preview, stats, versions` → plus `context`). A "Project context to use" section,
an "N attached" badge, the sentence saying every agent using this skill inherits these documents
(R19), and a SERIALIZES AS block showing `## Project context` and the saved paths in order (R20).
**No SERIALIZES AS pattern exists anywhere in this repo** — zero grep hits across `client/src`,
`server/src` and `reviewer-core/src` — so it is new work, not a component to reuse. The document
list itself reuses step 24's editable list; only the inherited group is absent.

**27. Run-trace drawer — mostly relabelling.** `TraceBody.tsx:94-96` already renders a `PromptBlock`
for `trace.prompt_assembly.specs` with `t('trace.prompt.specs')` and `PROMPT_COLORS.specs`
(`RunTraceDrawer/constants.ts:21`), and `PromptBlock.tsx:24,42` already gives expand, copy,
fullscreen and a size badge. So R45 is largely existing behaviour once step 9 puts the trusted line
into `prompt_assembly.specs` — **verify it end to end, do not assume it.** The work is:
change `client/messages/en/runs.json:52` from "Project context (dynamic)" to "Project context —
attached specs (untrusted)" (R44); render the new `project_context` array as path + tokens + status
rows (R43); and render `specs_read` in Configuration (R42). `client/INSIGHTS.md:868-880` is exactly
this trap — a field added to the trace contract, typed on both sides, rendered nowhere.

**28. Navigation (R11) — two files, not one.** Add the row to `client/src/vendor/ui/nav.ts:21-36`
in the WORKSPACE group with `key: 'context'` and `gKey: 'd'`. `p`, `s`, `a`, `c` and `,` are taken
and `c` is the easy collision. Three consumers pick the row up for free — `Sidebar.tsx:3`,
`useGlobalShortcuts.ts:45` and `useShellCommands.ts:21-29` all read `NAV` dynamically — and two
stubs already run ahead of it: `nav.context` = "Project Context" exists at
`client/messages/en/shell.json:17`, and `activeKeyFor()` at
`client/src/components/app-shell/helpers.ts:30` already branches
`if (pathname.includes("/context")) return "context"`. Using `key: 'context'` is what lights both up.

**The second file is the trap.** `SHORTCUTS` at `nav.ts:58-68` is a **hand-maintained array that is
not derived from `NAV.items[].gKey`**, and `ShortcutsHelp.tsx:4` renders it in the `?` modal. Add
the row to `NAV` alone and `g d` works while never appearing in the help. Add it to both.

Editing a `vendor/ui/` file is deliberate (spec D11): there is no server twin, so `shared-sync`
does not cover it and there is no mirror to keep — the only cost is that a UI-kit update will one
day overwrite the two rows.

**29. Settings screen — the two new keys (R49, R51).** The workspace Settings screen gains a
control for `context_scan_roots` (an ordered list of repo-relative folder names) and one for
`context_token_budget` (a positive integer). Both are already typed in `SettingsKnown` by step 4
and already round-trip through `GET`/`PUT /settings`, so this is presentation only — no new
endpoint, no new contract.

Two things the panel must get right. **When the workspace has never set a key, show the spec's
default as the value in effect** — `["specs","docs","insights"]` and `16000` — rather than an
empty field, because an empty field reads as "nothing is configured" for a feature that is in
fact scanning three folders. And **label the budget in the same units the editor footer and the
run trace use**, tokens per assembled prompt, so the number a user types is visibly the number
the over-budget warning (R26) measures against.

Changing the roots invalidates every repo's scan: the persisted `repo_docs` rows were produced
under the old roots, and nothing re-derives them. State that beside the control and leave rescan
as the user's action (R3) — a settings write must not fan out background jobs across every repo
in the workspace.

## Tests

Every new test must be **proven to fail before it is left green** — the root `AGENTS.md` names
this as the one thing not to economise on, and this plan's `selectWithinBudget` and status mapping
are precisely the shape that passes vacuously.

| File | Kind | Asserts |
|---|---|---|
| `server/test/context-helpers.test.ts` (new) | unit, pure | `effectiveSet` order and dedupe with a doc in both agent and skill (R23, R30); `selectWithinBudget` — a doc that does not fit stops the walk and everything after it is `dropped` **even when a later one would have fitted**, which is the assertion that pins R37's settled reading rather than restating the code; a first doc over budget comes back `truncated` and non-empty (R38); an exactly-fitting doc is `included`; `truncateToBudget` over a string of astral characters returns **no lone surrogate** and lands under budget; `renderDoc` output is what the token count is taken over (R50); `kindForRoot` returns `other` for a configured root named neither `specs`, `docs` nor `insights` (R1) |
| `server/test/context-service.test.ts` (new) | unit, fake `ContextContainer` + object-literal repository (no cast) | the six statuses map from the port's behaviour — `CloneReadError('not_found')` → `missing`, `'outside_clone'` and `'git_dir'` → `refused`, a `U+0000` body → `binary` (R34-R36); attachments bound to another repo yield an empty result **with a note** and no substituted file (R39); a thrown port yields an empty result and a note, never a throw (R41); **zero `llm` calls on every path** (R40); a path failing `sanitizeRepoPath` rejects the whole set and writes nothing (R16); a repeated path saves once at the first position (R17); a cross-workspace agent id refuses (R18) |
| `server/test/context-scan.test.ts` (new) | unit, `MockGitClient` with a fake tree | the scan persists count + time; a throw mid-scan leaves the previous rows and `scannedAt` untouched and writes only `lastError`/`lastErrorAt` (R4); `.MD` is found (case-insensitive); a file over `MAX_DOC_FILE_BYTES` is skipped; over `MAX_SCAN_CANDIDATES` sets `bounded` |
| `server/test/context.it.test.ts` (new) | integration, testcontainers, `app.inject()` | the seven routes end to end on a seeded workspace; `PUT` then `GET` returns the paths **in the saved order** (R15); "used by N agents" counts an agent reaching a doc through an enabled skill and **not** through a disabled one (R9); a repo from another workspace 404s. Copy the harness from `server/test/intent.it.test.ts:1-40` — `startPg`, `dockerAvailable`, and `MockSecretsProvider({})` so no route can reach a live provider |
| `server/test/reviews-*.it.test.ts` (extend) | integration | a run with attachments writes `specs_read` in block order and a `project_context` array (R42, R43); a run with none produces `prompt_assembly.specs === null` (R31) |
| `reviewer-core/test/prompt.test.ts` (extend) | unit | with `specs`, the user message contains `## Project context`, then the preamble line, then the first `<untrusted`, **in that order** (R33); `INJECTION_GUARD`'s text in the system message is unchanged (assert against the literal); without `specs`, the assembled user message is byte-identical to the pre-change output (R31); a spec body containing `</untrusted>` is still escaped |
| `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx` (new) | component, jsdom | the token footer sums own + inherited **after dedupe** (R23, R24) and calls no local estimator; inherited docs alone trip the over-budget warning while save stays enabled (R26, R28); a non-`single-pass` agent shows the per-chunk sentence (R27); inherited rows have no checkbox and no drag handle (R22). `fireEvent`, not `userEvent` |
| `client/src/app/repos/[repoId]/context/…/ProjectContextPage.test.tsx` (new) | component, jsdom | the four states render distinctly and none masks another (R4-R6); a document containing `<img src=x onerror=…>` renders as **text** and a `javascript:` link is not an anchor href (R8) |
| `client/…/nav.test.tsx` or an assertion in an existing shell test | component, jsdom | the WORKSPACE row and the `?`-modal shortcut list **both** carry `g d` — the one check that catches `NAV` updated without `SHORTCUTS` (step 28) |
| `client/…/settings/…` (extend the existing Settings test) | component, jsdom | with no stored value, both controls render the spec's defaults as the value in effect, not empty fields (R51); a saved budget round-trips through `PUT /settings` |

```sh
cd server        && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server        && pnpm exec vitest run .it.test        # integration IS in scope for this plan
cd reviewer-core && npm test
cd client        && pnpm test
```

**e2e is not in scope.** No `e2e/specs/*.flow.json` file is added or changed.

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`:

```sh
cd server && pnpm arch          # depcruise src --config --ignore-known
cd server && pnpm typecheck     # tsc --noEmit -p tsconfig.json
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd client && pnpm lint          # eslint .
cd client && pnpm typecheck     # tsc --noEmit
cd client && pnpm test          # vitest run
cd reviewer-core && npm run typecheck   # tsc --noEmit
cd reviewer-core && npm test            # vitest run --passWithNoTests
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

All four packages are in the diff, so nothing here is a `skip`. Then `/pr-self-review`: once when
the feature is complete, once after the fixes, done.

## Risks (from INSIGHTS.md)

- **`server/INSIGHTS.md:181-200` — a service the container constructs must not import `Container`.**
  `ContextService` is built by the container getter in step 18, so step 11's structural
  `ContextContainer` is not a style choice; `RepoIntelService` has exactly this cycle and it is
  baselined, which is why copying it reads as safe.
- **`server/INSIGHTS.md:316-329` — a repository seam typed as the class cannot be faked without a
  lying cast.** Three services in this repo have no hermetic tests for that reason alone. Step 11
  types the seam as an interface, which is what makes `context-service.test.ts` possible.
- **`server/INSIGHTS.md:330-349` — a cap applied on one path of a two-path method lets the
  contract lie on the other.** `resolveForRun` has an early return for the empty set, one for the
  wrong repo, one for a port failure, and the normal path. Grep the method for `return` and read
  each against the contract, not against the branch being edited.
- **`server/INSIGHTS.md:166-180` — truncate before `wrapUntrusted`, never after.** The server
  truncates in step 15 and `reviewer-core` wraps in step 9. Reversing that order eventually cuts
  the closing fence off and hands everything after it to attacker-controlled text.
- **`server/INSIGHTS.md:246-258` — `String.slice` corrupts astral characters.** Both truncations
  here (`MAX_DOC_CHARS` and `truncateToBudget`) cut by code point.
- **`server/INSIGHTS.md:69-80` — an aggregate without a stated `ORDER BY` reshuffles.** Every list
  read in step 13 states one; the attachment reads order by `position`, which is the feature.
- **`server/INSIGHTS.md:39-57` — a frozen dependency-cruiser edge silences that edge entirely.**
  Do not run `pnpm arch:baseline` for anything this branch introduces, and note that the two
  adapter→`repo-intel/constants` entries already in the baseline are why step 7 duplicates the
  excluded-directory list instead of importing it.
- **`server/INSIGHTS.md:214-232` — a link table's foreign key proves existence, not tenancy.**
  Written about `agent_skills`; `agent_context_docs` and `skill_context_docs` are the same shape
  and R18 is the same check.
- **`client/INSIGHTS.md:868-880` — a field added to the trace contract, typed on both sides, and
  rendered nowhere.** Step 26 exists because of that entry; the acceptance criterion is the
  rendering, not the type.
- **`client/INSIGHTS.md:490-517` — a disabled TanStack v5 query reports `isLoading === false`.**
  Step 21's state order must be written against it, not around it.
- **Root `INSIGHTS.md` — a document citing code by line number rots silently.** Every `path:line`
  above was read on 2026-08-13; re-verify one that looks wrong rather than working around it.

## Alternatives rejected

- **Storing document text in the feature's own tables.** The spec is explicit that only paths,
  order and the repo binding persist. Text in a table is a second source of truth that goes stale
  the moment `refresh()` re-clones, and the token count already gives the editor what it needs.
- **Scanning the disk on every list request.** The p95 < 300 ms NFR rules it out, and a walk on a
  read path turns a page load into unbounded I/O over attacker-supplied directory trees.
- **Reusing `IndexStatus` for the scan state.** Its `parsing` / `embedding` / `chunks_indexed`
  vocabulary describes the indexing feature the spec puts out of scope (N2); serving it here would
  make the empty half of that contract look implemented.
- **Putting the document path in `wrapUntrusted`'s `label`.** The label lands inside
  `source="…"` unescaped, so a path containing a quote breaks the attribute — and AC-26 asks for
  the path *inside* the wrapper regardless.
- **Weakening `INJECTION_GUARD` to make room for the section.** Spec D9: the guard defends every
  review path including the CI runner, so an exception in it costs every path. A trusted line
  outside the fence costs only this section.
- **A `context` service reaching `modules/agents` for skills and tenancy.** `no-cross-module`
  forbids it and a barrel does not help. The slice queries the tables it needs through its own
  repository, which is also what makes the "used by" aggregate one query instead of three calls.
- **One polymorphic `context_docs` table with an `owner_type` discriminator.** Two tables keep the
  foreign keys real, so deleting an agent or a skill cascades without a trigger.
- **Enqueuing the first scan from the clone job.** Cheaper for the user, but it needs
  `modules/repos` to name this slice's job kind — a `no-cross-module` edge that would have to be
  frozen, and the baseline only shrinks. Recorded as recommendation 4.
- **Adopting the stub hooks' paths — `GET /repos/:id/context` and `POST /repos/:id/context/reindex`.**
  The first is a needless narrowing once `/context/rescan` and `/context/docs/content` sit beside
  it; the second names the chunk-and-embed feature N2 excludes. The hooks are rewritten instead,
  which costs one edit to a file with no other consumer.
- **A parallel `ContextDoc` contract beside `SpecFile`.** The spec names `SpecFile` the extension
  point, and two shapes for one document is how the vendored copies start to drift in meaning
  rather than in bytes.
- **Building a second reorderable list for attachments.** `SkillsTab` already has the checkbox,
  the drag handle, the arrow keys and the filter; a second implementation would lose the keyboard
  path first, as it is the part nobody demos.

## Verification

Observable, in this order, ending in one real run through the real entry point.

1. `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing. — *R43, R49 and the whole of stage 1*
2. `cd server && pnpm arch` exits 0 and the baseline did not grow. — *stage 4's ring placement*
3. `./scripts/dev.sh`; open Project Context for a repo whose clone is still in flight → the
   clone-preparing state with a retry, not an empty list. — *R5*
4. Once cloned, the list shows every `.md` under `specs/`, `docs/`, `insights/` with path, root,
   kind and a "Used by N agents" badge; the footer shows the count and the scan time and nothing
   else; no create/upload/rename/edit control is present. — *R1, R2, R9, R10*
5. Open Settings with the workspace having never set either key → both controls show the spec's
   defaults as the value in effect. Add a root named `handbook` holding one `.md`, rescan → that
   document appears with an `other` badge. Point the roots at a directory with no `.md` and reload
   → the empty state names that root. Break the clone path and press rescan → the count and time
   are unchanged and the failed attempt is shown beside them. — *R51, R49, R1, R6, R3, R4*
6. Open a document containing `<img src=x onerror=alert(1)>` and a `javascript:` link → both are
   visible as text, no dialog, no anchor. — *R8, R7*
7. Press `g` then `d` from anywhere, search "Project Context" in the command palette, and open the
   `?` shortcuts modal → all three know the row, and the sidebar item is active on the page. — *R11*
8. In an agent's Context tab: filter, check three documents, drag one to the top, save, reload →
   the same order comes back. Switch the active repository → a different set. — *R12-R15, R21*
9. Attach one document to a skill bound to that agent, one of them a document the agent already
   has → the inherited group shows both read-only with the skill's name, the shared row is marked
   already-attached, and the footer's number does not double. Set the budget below the total →
   the warning names the overage and save stays enabled; with the agent's own set alone under
   budget, the warning still fires. — *R19, R20, R22-R26, R28*
10. Set the agent's strategy to `map-reduce` → the footer states the per-prompt figure and the
    once-per-changed-file rule, and names **no** total. — *R27*
11. `curl -X PUT …/agents/:id/context-docs` with `["../../etc/passwd"]`, then with 51 paths, then
    with another workspace's agent id → `400`, `400`, refusal, and `GET` shows the set unchanged. — *R16-R18*
12. Run a review on a PR in that repo. The trace's Prompt assembly carries a block titled
    "Project context — attached specs (untrusted)"; expanding it shows `## Project context`, then
    the trusted line, then one `<untrusted source="spec-0">` per document with its repo-relative
    path inside beside its text, in the saved order and deduped. `Specs read` lists the same paths
    in the same order, and the per-document list shows a token count and a status for each. — *R29, R30, R32, R33, R36, R42-R45*
13. Delete one attached file from the clone and re-run → that document shows `missing`, the run
    finishes `done`, and the others still went. Lower the budget in Settings so the **second** of
    three documents does not fit, ordering a small one third, and re-run → documents two **and
    three** are `dropped` and the block is within budget, confirming the walk stops rather than
    skipping ahead. Lower it under the first document alone → a `truncated` row and a non-empty
    block. — *R34, R37, R38*
14. Run the same agent against a PR in a **different** repository → no `## Project context`
    section, a line in the run log saying why, and no same-named file from that repository. — *R39*
15. Compare the run's LLM call count against a run with no attachments → identical, and
    `prompt_assembly.specs` on the second is `null` with a user message byte-identical to the
    pre-change shape. — *R31, R40*
16. **The end-to-end scenario the spec names.** Attach a document stating "module `api/` must not
    import `db/` directly", run against a PR that violates it → the trace shows that document's
    full text in the block and its path in `specs_read`, and the review returns a finding whose
    text names the document's path. Step 16's second half is the model-dependent one; if the first
    half holds and the finding does not, the fix is the wording of the section's trusted line, not
    `INJECTION_GUARD` (spec `## Edge cases`, last row). — *R46, R47*

## Open questions

Five questions from the first draft were answered on 2026-08-13 and are folded into the
requirements and steps above: AC-31 (R37), the `other` kind (R1), AC-22 (R27), the Settings panel
(R51, AC-48), and the markdown renderer — the client already ships `react-markdown` `^9.0.3` behind
`vendor/ui/primitives/Markdown.tsx`, so step 23 names it and there is no dependency to choose.
`client/messages/en/context.json` is rewritten rather than preserved (step 21) — also settled.
**One remains, and it is not for a human to guess.**

1. **The scan's tokenizer cost is unmeasured — for the implementer, by measurement.** 2000
   documents × 40 000 code points through `js-tiktoken` inside a 120 s job is the worst case, and
   nobody has run it. Measure it on a real repo before assuming it fits. If it does not, the
   answer is a lower `MAX_SCAN_CANDIDATES`, not a cheaper counter — a second counter breaks AC-20,
   which is the one requirement binding the editor's number to the run's.

# 09 — Project Context: the page rebuilt, preview in the attach tabs, and writing documents

**Status:** Planned 2026-08-14
**Scope:** server · client
**Modules touched:** `server/src/modules/context`, `server/src/adapters/git`, `server/src/vendor/shared`, `client/src/app/repos/[repoId]/context`, `client/src/components/context-docs`, `client/src/components/context-doc-view` (new), both editor `ContextTab` folders
**Requirements source:** `specs/SPEC-01-project-context.md` (amended 2026-08-14) — `AC-49`…`AC-71`, the three criteria the amendment rewrote in place (`AC-1`, `AC-8`, `AC-9`), one defect against `AC-10`, and two rows of `## Non-functional requirements`
**Execution:** multi-agent

`AC-1`…`AC-48` shipped under [`08-project-context.md`](08-project-context.md). That plan is history: read its
`## Constraints` and `## Out of scope` if you need the reasoning behind what is already there, but do not
re-plan or edit it. Three of its criteria were **rewritten in place** by the amendment and are therefore live
again here — `AC-1`, `AC-8`, `AC-9` — and one, `AC-10`, was never fully built.

## Requirements as understood

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | The document list is grouped by scan root: the group header names the root **once** and carries that group's kind badge; a row shows only the path relative to its group's root | `specs/SPEC-01-project-context.md § AC-1`, `§ D13` | clear (was conflicting with design screen 1; confirmed 2026-08-14) |
| R2 | "Used by N agents" lives in the right panel's header, for the **selected** document, not on the list row | `§ AC-8` | clear |
| R3 | The page offers no rename and no delete | `§ AC-9` | clear |
| R4 | Every row of the Context tab (agent and skill) carries its own kind badge — `specs` / `docs` / `insights` / `other` | `§ AC-10`; the dispatch prompt names it as a **defect**: `grep -rn "kind" client/src/components/context-docs/` returns nothing | clear |
| R5 | The right panel's header carries the document name, a `Preview \| Edit` toggle defaulting to `Preview`, and the badge from R2 | `§ AC-49` | clear |
| R6 | Exactly four controls sit above the list — new document, new folder, upload `.md`, rescan — and that is the **only** rescan on the page | `§ AC-50` | clear |
| R7 | Nested configured roots (`docs` and `docs/adr`) put a document in exactly one group — the longest match | `§ AC-51` | clear |
| R8 | A document below its group's root shows the sub-path (`adr/0001.md`), not the bare filename | `§ AC-52` | clear |
| R9 | A preview control on a Context-tab row renders that document's markdown without leaving the tab and without changing the attachment set or its order | `§ AC-53` | clear |
| R10 | The preview control is on **every** row — unattached rows and inherited rows included — with an accessible name that names the document | `§ AC-54` | clear |
| R11 | A document that cannot be read shows the reason instead of the content, in the run's own three words: `missing` / `refused` / `binary` | `§ AC-55` | clear |
| R12 | All three surfaces — the page's reading pane, the tab preview, the `Preview` mode — render through **one** untrusted renderer: embedded HTML as text, non-`http(s)` links and images not clickable | `§ AC-56` | clear |
| R13 | "New document" creates a file under `.devdigest/` in this repo's clone and it appears in the list without a manual rescan | `§ AC-57` | clear |
| R14 | "Upload" puts a `.md` under `.devdigest/` under the same path rules and size bounds as a created document | `§ AC-58` | clear |
| R15 | A newly created folder holds no `.md`, so the list cannot show it — the system says so instead of returning an unchanged list | `§ AC-59` | clear |
| R16 | `Edit` + save writes the new text to the clone file of **any** scanned document, and `Preview` then shows the saved text | `§ AC-60`, `§ D15` | clear |
| R17 | `.devdigest` is a scan root of every repository whatever the workspace configured | `§ AC-61`, `§ D14` | clear |
| R18 | A created, uploaded or edited document is an ordinary scan result: kind, tokens from the same counter, "used by N agents", attachable | `§ AC-62` | clear |
| R19 | The next run of an agent attached to an edited document sends the **new** text in `## Project context` | `§ AC-63` | clear |
| R20 | A saved edit that pushes the effective set over budget raises the same over-budget warning, with the attachment set unchanged | `§ AC-64` | clear |
| R21 | A document created or uploaded under `.devdigest/` survives `refresh` and `resync` with the same content | `§ AC-65`, `§ D4` | clear |
| R22 | A created or uploaded document is marked **local to this machine**, in the list and in the right panel, in words that say three things: not in the repository; invisible to another person or clone; gone if the repository has to be cloned again | `§ AC-66` | clear |
| R23 | A write whose path breaks the rules — not under `.devdigest/` for create and upload, not under any scanned root for a save, absolute, `..`, not `.md`, control character, over length, or resolving through a symlink out of the clone or into `.git/` — or which exceeds the size bound, is refused whole: nothing partial and no empty file on disk | `§ AC-67`, `§ Untrusted inputs` | clear |
| R24 | A create or an upload onto an existing path answers "already exists" and does not overwrite | `§ AC-68` | clear |
| R25 | With no clone yet, the create / upload / save controls are unavailable with the same "preparing the clone" explanation as `AC-4`, not a write error | `§ AC-69` | clear |
| R26 | Saving an edit to a document outside `.devdigest/` shows, **before the write**, a warning naming the mechanism — the next resync runs `git reset --hard origin/<default>` and returns the file to the branch, erasing the edit with no trace and no question — and writes only after explicit confirmation | `§ AC-70`, `§ D15` | clear |
| R27 | A document whose disk content no longer matches the edit saved here says so: the shown text came from the branch and the edit made here is gone | `§ AC-71` | clear |
| R28 | `sync()`'s comment — *"safe here because we never commit to or run code from the clone"* — stops being true the moment this ships, and is corrected in the same change | `§ Module interactions` ("Припущення, яке ця фіча робить хибним"); the dispatch prompt | clear |
| R29 | At most 30 create / upload / save requests a minute | `§ Non-functional requirements` ("Частота записів") | assumed |
| R30 | A written document obeys the read bounds: 40 000 code points, and 400 KB as the file bound above which the scan would not show it anyway | `§ Non-functional requirements` ("Обсяг створеного…") | clear |

**30 rows: 29 `clear`, 0 `conflicting`, 1 `assumed`.**

**R1 was the one place the design and the spec disagreed, and the human settled it for the spec on 2026-08-14 —
what follows is a recorded decision, not a conflict left for the implementer to weigh.** Design screen 1 heads the
list `.devdigest/specs/`, one level deeper than the configured root. `AC-1` and `D13` say the header is the root
and the row is the path relative to it, and `AC-52` spells the consequence out (`adr/0001.md` under root `docs`).
Under `AC-61` the root is `.devdigest`, so the header reads `.devdigest` and the row reads `specs/public-api.md`.
Do not build the design's deeper header.

**R29 is `assumed` in one respect only.** The NFR says "per workspace"; `@fastify/rate-limit` is registered
globally in `app.ts:106` with its default keying and is **disabled entirely under `NODE_ENV=test`**. The plan
applies `{ max: 30, timeWindow: '1 minute' }` per route with that default keying, which for a local-first
single-workspace install is the same population. A workspace-keyed limiter is not in scope.

## Out of scope

**AC coverage: 71 criteria in the spec; 27 became R1–R27 above; 44 are named here.**

- **`AC-2`…`AC-7` and `AC-11`…`AC-48` are built, reviewed and unchanged by the amendment.** Do not re-implement
  them. Four of them are **regression checks** for the page rebuild rather than new work, and `## Verification`
  names them: `AC-2` (the footer keeps saying "N documents · last scanned …"), `AC-4` / `AC-5` (the clone-preparing
  and empty states survive), `AC-6` / `AC-7` (the reading pane still renders markdown with embedded HTML as text).
- The spec's non-goals **N1, N2, N4, N5, N6** stand: no auto-selection, no indexing / chunking / embeddings /
  coverage ring (the "78 COVERAGE" ring and the "12 files · 1,240 chunks" footer on design screen 1 are **not**
  this feature), no reading from the PR head, no format but `.md`, no change to the grounding gate. **N3 is
  narrowed, not lifted:** create, folder, upload and edit are in; **rename and delete are still out** (R3).
- **`reviewer-core` is not touched.** No criterion in this increment changes prompt assembly; `R19` works because
  the run reads the file off disk at start.
- **No commit, no push, no branch, no stash of a written document.** `D4` rejected it. The file is the whole
  mechanism (R21).
- **No backup or edit history.** `## Non-functional requirements` is explicit: `Edit` overwrites, and for
  `.devdigest/` nobody keeps the previous version.
- **No attachment cleanup** when a file vanishes, and no auto-scan on clone completion — both refused by plan 08
  for reasons that still hold.
- **No MCP tool and no `e2e/specs/*.flow.json`.** Neither is named by any criterion.
- **`docs/project-context.md` is not updated here.** It documents the shipped system and belongs to `doc-writer`,
  dispatched after this lands.

## What already exists

| Path | What it gives us |
|---|---|
| `server/src/modules/context/{routes,service,helpers,repository,scan-executor,settings,constants,types}.ts` | The whole read side: seven routes, the scan job, the budget walk, `sanitizeDocPath`, `normalizeRoot`, `kindForRoot`, the four scan states |
| `server/src/modules/context/scan-executor.ts:104-112` | `rootFor` — longest-match root selection, already the answer R7 needs, currently a private function |
| `server/src/adapters/git/simple-git.ts:135-204` | `readFile`: both-sides `realpath`, `root + sep` containment, exact-segment `.git` refusal, `open` + fixed buffer. **The shape R23's write path copies** |
| `server/src/adapters/git/simple-git.ts:83-93` | `sync()` = `fetch --depth 50` + `reset --hard origin/<branch>`, and the comment R28 corrects |
| `server/src/adapters/git/simple-git.ts:259-300` | `walkDocs` — never descends a symlink, skips `EXCLUDED_WALK_DIRS` (`.devdigest` is not in that list, so the folder is walked) |
| `server/src/adapters/mocks.ts:248-347` | `MockGitClient` with `opts.tree`, `opts.refuse`, `opts.noClone` — the seam every service test uses |
| `server/src/db/schema/context.ts:151-250` | `repo_docs`, `repo_doc_scans`, `agent_context_docs`, `skill_context_docs` |
| `server/src/modules/context/repository.ts:308-344` | `replaceDocs` — the one-transaction "rows and count agree" write, and the `onConflictDoUpdate` pattern |
| `server/src/modules/skills/routes.ts:147-152` · `server/src/app.ts:99-101` | `@fastify/multipart` is registered (`files: 1, fields: 0, parts: 2`, 2 MB) and `req.file()` is already used once |
| `server/src/platform/errors.ts` | `AppError(code, message, status)` and the `{ error: { code, message } }` envelope the client reads as `ApiError.code` |
| `client/src/app/repos/[repoId]/context/_components/ProjectContextView/` | The page: four scan states, `DocRow` (`:181-207`, the triple `docs`), `Footer`, the `?doc=` URL selection |
| `client/src/app/repos/[repoId]/context/_components/DocumentReader/` · `…/ProjectContextView/helpers.ts` | The untrusted renderer and `isSafeUrl` / `KIND_COLOR` — R12's one renderer, in a folder only one route can reach |
| `client/src/components/context-docs/{ContextDocList,InheritedGroup,BudgetFooter,helpers}.tsx` | The shared attach list: checkbox, drag + arrow reorder, filter, token footer. No kind badge and no preview (R4, R9) |
| `client/src/lib/hooks/context.ts` · `core.ts:160-196` | `useContextDoc`, `useAgentContextDocs`, `useSetAgentContextDocs`, `useContextDocs`, `useRescanContextDocs` and their invalidations |
| `client/src/vendor/ui/kit/Modal.tsx` · `…/TextInput` · `…/Textarea` · `…/Checkbox` | `role="dialog"`, title, footer — and `CreateSkillFromConventionsModal` is the working precedent for a create dialog |
| `client/src/lib/repo-context.tsx:57` | `useActiveRepo().activeRepo.default_branch` — the branch name R26's warning must print |

**Nothing exists** for: any write through `GitClient`, the `.devdigest` invariant, the record of what DevDigest
saved, a kind badge or preview control in the attach tabs, a grouped list, an editor, or a shared renderer folder.

## Constraints

| Rule | Source |
|---|---|
| Every external call goes behind a port, and a port is not finished until `adapters/mocks.ts` implements it | `onion-architecture` §3.4 |
| A service may not touch `node:fs`; the clone is reached through `GitClient` only | `.dependency-cruiser.cjs` `no-fs-in-service`; `onion-architecture` §5 |
| `modules/context` may not import another `modules/<slice>/`, `import type` included; an adapter may not import `modules/**` | `.dependency-cruiser.cjs` `no-cross-module`, `no-adapter-to-module` |
| No Drizzle outside `repository.ts`; the service takes its repository as an interface parameter | `onion-architecture` §3.2-3.3; `modules/context/types.ts:107` |
| `vendor/shared/**` imports only zod and itself; it is **two physical copies** and only `diff -r` sees drift | `.dependency-cruiser.cjs` `contracts-stay-pure`; root `AGENTS.md`; `gates.md` → `repo · vendor` |
| A route declares `schema.body` / `schema.querystring`; it never hand-rolls `Schema.parse(req.body)` | `server/README.md`; `fastify-best-practices` (schema-first) |
| A route that changes state carries its own `config.rateLimit`; the global limiter is off under test | `server/src/modules/context/routes.ts:68-72`; `server/src/app.ts:104-107` |
| An uploaded file is untrusted: allowlist the extension case-insensitively, never trust the client filename as a path, strip it to a basename, bound the size **before** allocating | `security` § File Upload Security, A08 |
| A path check on the string cannot see a symlink; the zone check is repeated **after** resolution, in the adapter | `security` A05 (path traversal); `simple-git.ts:135-173`; spec `§ Untrusted inputs` |
| Truncate by **code point** (`[...text]`), never by `String.slice` | `server/INSIGHTS.md`; `modules/context/helpers.ts:23-26` |
| Postgres does not index a foreign-key column for you; `TIMESTAMPTZ` and `TEXT`, never `timestamp` or `varchar(n)` | `postgresql-table-design` § Core Rules, § Data Types |
| An `ON CONFLICT` target needs a matching unique index | `drizzle-orm-patterns` § Upsert-Friendly Design |
| `vitest.config.ts` repeats the tsconfig `paths` — add an alias to one only and tests break while typecheck passes | `server/AGENTS.md`; `client/AGENTS.md` |
| `server/` and `client/` use **pnpm**; `reviewer-core/` and `e2e/` use **npm** | root `AGENTS.md`; `gates.md` |
| Client: no `fetch` in a component — data arrives through a hook in `src/lib/hooks/*`; `'use client'` on the leaf | `client/AGENTS.md`; `frontend-architecture` steps 4-5 |
| Promotion to `src/components/` needs a second consumer in a different route — and R12 supplies exactly that | `frontend-architecture` principles 1-2 |
| Never render untrusted markdown through `dangerouslySetInnerHTML`; never add `rehype-raw`; refuse a non-`http(s)` `href`/`src` | `security` A05 (stored XSS); `DocumentReader.tsx:1-17` |
| A responsive property lives **only** in the `globals.css` media-query block, keyed on a `dd-` class | `client/AGENTS.md` |
| `@testing-library/user-event` is not installed — component tests use `fireEvent` | `client/INSIGHTS.md` |

## Recommendations

For the human. The steps below are written to the requirements as they stand, not to these.

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Make R26's confirmation server-enforced: add `confirm_tracked: true` to the save body and refuse a save outside `.devdigest/` without it | Yes — one contract field, one service branch, one test | Small. It buys an enforcement point the UI cannot skip; against it, the warning is a UI act and the server cannot render one, so the field only records that a dialog was shown |
| 2 | Show the root beside the filename on the Context-tab rows (`security-baseline.md  specs/`) as design screens 2 and 3 do | Yes — one line in `ContextDocList`, and R4 already puts the badge there | Small, but it is design detail no criterion asks for, and P4 stays smaller without it |
| 3 | Let an upload target a folder created under `.devdigest/`, not only `.devdigest/` itself | Yes — a second multipart field, which the global `fields: 0` limit currently forbids | Medium: `app.ts`'s multipart config is shared with skill import |

## Skills the implementer must invoke

| Package · step | Skill | Why |
|---|---|---|
| P1 · 1-3 | `zod` | Four contract shapes across both vendored copies, and two optional booleans added to a shape already on the wire |
| P1 · 4-5 | `security` | A write entry point over attacker-controlled repo content: traversal, symlinks, `.git/`, size before allocation, upload filename |
| P1 · 6 | `postgresql-table-design` · `drizzle-orm-patterns` | One new table, its composite PK, the column added to `repo_docs`, and the upsert's conflict target |
| P1 · 7-10 | `onion-architecture` | Ring placement of the write use cases, the port method, the repository seam, and `no-fs-in-service` |
| P1 · 11 | `fastify-best-practices` · `security` | Route `schema` declaration, per-route `rateLimit`, multipart handling, tenancy resolved before any write (A01) |
| P2 · 1-2 | `frontend-architecture` · `security` | Promotion of a component to `src/components/`, and the stored-XSS rules that make it the only renderer |
| P3 · 1-8 | `frontend-architecture` · `react-best-practices` | Where the editor draft, the dialogs and the grouping helpers live; derived-during-render totals; no query data copied into `useState` |
| P3 · 8 · P4 · 5 | `react-testing-library` | Component tests with `fireEvent` — `user-event` is not installed |
| P4 · 1-4 | `frontend-architecture` | A preview surface shared by two routes belongs beside the list both already import |

## Work packages

Four packages, two waves. Wave 1 is **P1 ∥ P2**; wave 2 is **P3 ∥ P4**. Nothing in wave 2 may start before both
of wave 1 have landed, because both wave-2 packages compile against what wave 1 publishes.

The working tree already carries ~80 uncommitted files from the previous increment. **Do not reformat, move or
"tidy" a file your package does not own** — git will not mediate that collision for you.

---

### P1 — the server write path, the contracts and the durability record

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/platform.ts`, `…/contracts/context.ts`, `…/adapters.ts`, `…/index.ts`
- `client/src/vendor/shared/**` (the mirror of exactly those files — **and nothing else in `client/`**)
- `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts`
- `server/src/db/schema/context.ts`, `server/src/db/migrations/**`
- `server/src/modules/context/**`
- `server/test/context-*.ts`, `server/test/git-write-containment.test.ts`, `server/test/context.it.test.ts`

**Contract — what P2, P3 and P4 may assume once this lands:**

- `SpecFile` gains two **optional** booleans, absent meaning `false`:
  `local` (created or uploaded in DevDigest) and `stale` (the disk no longer holds the text DevDigest saved).
  Optional rather than required so a client fixture written before this increment keeps typechecking — the
  shape already carries `content`, `size` and `updated_at` the same way.
- `GET /repos/:id/context/docs` — unchanged shape. `roots` **always** contains `.devdigest`.
- `GET /repos/:id/context/docs/content?path=…` — unchanged on success (`200`, a `SpecFile` with `content`).
  A read that cannot produce content now answers with the run's own vocabulary in the error envelope:
  `404 { code: "doc_missing" }`, `403 { code: "doc_refused" }`, `415 { code: "doc_binary" }`.
  `400 { code: "invalid_path" }` is unchanged.
- Four write routes, each `rateLimit { max: 30, timeWindow: '1 minute' }`:

  | Method · path | Body | Success | Errors |
  |---|---|---|---|
  | `POST /repos/:id/context/docs` | `{ path, content }` JSON | `201` `SpecFile` (`local: true`) | `400 invalid_path`, `400 too_large`, `409 already_exists`, `409 clone_not_ready` |
  | `POST /repos/:id/context/docs/upload` | multipart, one file part | `201` `SpecFile` (`local: true`) | as above, plus `400 invalid_path` for a non-`.md` name and `400 binary_content` |
  | `POST /repos/:id/context/folders` | `{ path }` JSON | `201` `{ path }` | `400 invalid_path`, `409 already_exists`, `409 clone_not_ready` |
  | `PUT /repos/:id/context/docs/content` | `{ path, content }` JSON | `200` `SpecFile` | `400 invalid_path`, `400 too_large`, `404 not_found`, `409 clone_not_ready` |

- `path` on create and on folder creation must be under `.devdigest/`; `path` on save must be under a scanned
  root and must already have a scanned row. Everything else is `400 invalid_path`.
- Every write response is a full `SpecFile`: `kind`, `tokens` (the same counter the run measures the budget
  with), `size`, `used_by_agents`, `local`, `stale`. The client never has to guess or refetch to render the row.
- A written document is in `GET …/docs` on the next read with **no rescan**.

**Steps**

1. **`SpecFile` gains `local` and `stale`** (`contracts/platform.ts`, both copies). `z.boolean().optional()`,
   each with a comment saying what absent means. Serves R18, R22, R27.
2. **New write contracts** (`contracts/context.ts`, both copies): `CreateContextDocBody` (`path` 1-512, `content`
   string), `CreateContextFolderBody` (`path`), `SaveContextDocBody` (`path`, `content`), `ContextFolderCreated`
   (`{ path }`). No import of module constants — `contracts-stay-pure` allows zod and itself only, so the numeric
   bounds are literals with a comment pointing at `modules/context/constants.ts`. Update the name list in
   `vendor/shared/index.ts`'s header comment. Serves R13-R16.
3. **The port learns to write** (`vendor/shared/adapters.ts`, both copies): `CloneWriteRefusal =
   'outside_clone' | 'git_dir' | 'symlink' | 'exists' | 'too_large'`, `CloneWriteError` beside `CloneReadError`
   (same shape, reason as data), and on `GitClient`:
   `writeFile(repo, path, content, opts: { maxBytes: number; overwrite: boolean }): Promise<{ size_bytes: number; modified_at: string }>`
   and `makeDir(repo, path): Promise<void>`. Returning size and mtime is what lets the service persist the row
   without a second stat. Then `diff -r server/src/vendor/shared client/src/vendor/shared` — **clean before you
   go on**, because nothing else sees this drift. Serves R23.
4. **Implement both in `simple-git.ts`.** Resolve the clone root with `realpath`, then walk the path segment by
   segment from the root: `lstat` each existing component and **refuse (`symlink`) if any of them is a symbolic
   link** — the same stance `walkDocs` already takes, and the only thing that stops
   `.devdigest/x.md → ../../.git/config`. Refuse a first segment of `.git` after resolution as well as on the
   string. Check `Buffer.byteLength(content, 'utf8') > opts.maxBytes` **before opening anything** (`too_large`).
   Create with `open(target, 'wx')` so an existing file fails atomically (`exists`), and unlink on a failed
   write; overwrite by writing a sibling temp file and `rename`ing it, so an interrupted save never truncates the
   original. `makeDir` runs the same walk, then `mkdir(..., { recursive: true })`.
   **In the same step, correct the `sync()` comment** at `:85-86`: `reset --hard` is safe for untracked files
   under `.devdigest/` and destroys an edit to a tracked one, which is what `AC-70` warns about. Serves R23, R24, R28.
5. **`MockGitClient` implements both** (`adapters/mocks.ts`): `writeFile` writes into `opts.tree` (initialise it
   when absent) so a later `listFiles` and `readFile` see the document, honours `overwrite: false` by throwing
   `CloneWriteError('exists')`, honours a new `opts.refuseWrite?: Record<string, CloneWriteRefusal>`, and honours
   `maxBytes`. `makeDir` records the directory. A mock that accepts more than the adapter would is how an
   unbounded write passes every test. Serves R23.
6. **Schema and migration** (`db/schema/context.ts`): `repo_doc_edits` — `repoId` uuid FK `repos` cascade,
   `path` text, `createdHere` boolean not null default false, `contentHash` text not null, `savedAt` timestamptz
   not null default now, `primaryKey(repoId, path)`. Repo-keyed and not workspace-keyed, like `repo_doc_scans`:
   tenancy is proved by the repo lookup. The PK is also the `ON CONFLICT` target for the upsert in step 9, and no
   further index is needed — every read starts from `(repo_id, path)`. Add `contentHash text` (nullable — a row
   is replaced wholesale by the next scan) to `repo_docs`. One `pnpm db:generate` run, additive only: the
   generator asks about renames on a TTY and cannot be answered from a pipe when a migration both adds and drops.
   Then `pnpm db:migrate`. Serves R22, R27.
7. **Constants and pure helpers** (`modules/context/{constants,helpers}.ts`): `DEVDIGEST_ROOT = '.devdigest'`;
   `contentHash(text)` = sha256 hex (`node:crypto` in a pure module has precedent — `modules/reviews/prompt-log.ts`);
   move `rootFor` out of `scan-executor.ts` into `helpers.ts` and export it, because the write path needs the same
   longest-match answer the scan uses; `writeZone(path, roots, mode)` returning the refusal or `null`. Serves R7, R17, R23.
8. **`.devdigest` is always a root** (`modules/context/settings.ts`). Order matters and is the whole risk:
   resolve the configured roots to the defaults **first** (the existing `roots.length > 0 ? … : DEFAULT_SCAN_ROOTS`
   branch), and only then append `DEVDIGEST_ROOT` and de-duplicate — after `normalizeRoot`, so a workspace that
   typed `.devdigest/` by hand gets one root and one group, not two. Appending before the fallback silently
   deletes the three defaults. Serves R17.
9. **Repository** (`modules/context/repository.ts`, and the interfaces in `types.ts`): `upsertDoc(workspaceId,
   repoId, doc)` — insert or update the `repo_docs` row and recompute `repo_doc_scans.file_count` from the row
   count, in one transaction, so the footer never disagrees with the list; `recordEdit(repoId, path, {
   createdHere, contentHash })`; and `local` / `stale` on the reads: `docsFor` and `docByPath` left-join
   `repo_doc_edits` and return `local = created_here`, `stale = edit.content_hash IS NOT NULL AND
   repo_docs.content_hash IS DISTINCT FROM edit.content_hash`. `ContextDocRecord` grows the two booleans;
   `toDocDto` passes them through. Serves R18, R22, R27.
10. **Service** (`modules/context/service.ts`): `createDoc`, `uploadDoc`, `createFolder`, `saveDoc`. Each one, in
    this order: `requireRepo` (tenancy first — a cross-tenant write puts another workspace's text into this one's
    prompts), `409 clone_not_ready` when `clonePath` is null, `sanitizeDocPath`, `writeZone`, the size bound in
    **code points and bytes** before the port call, the port call, `contentHash`, `upsertDoc` with `kind` from
    `rootFor` + `kindForRoot` and `tokens` from `container.tokenizer.count(renderDoc(path, body))`, `recordEdit`,
    return `toDocDto`. `uploadDoc` additionally: basename the client filename (it is a name, never a path),
    case-insensitive `.md` check, and refuse `400 binary_content` when the decoded text contains `U+0000` — a
    renamed `.exe` passes every extension check and only that one catches it.
    **In the same step**, give `docContent` the three read states: no scanned row → `doc_missing`;
    `CloneReadError` mapped by `reason` (`not_found` → `doc_missing`, otherwise `doc_refused`); text containing
    `U+0000` → `doc_binary`. Serves R11, R13-R16, R18, R22-R25, R30.
11. **Routes** (`modules/context/routes.ts`): the four routes from the Contract table, each with `schema` (the
    upload route has no body schema — the payload is multipart, exactly as `skills/routes.ts:145` documents) and
    each with `config: { rateLimit: { max: 30, timeWindow: '1 minute' } }`. Extend the header comment's route
    map. `modules/index.ts` needs no edit: the `context` module is already registered. Serves R13-R16, R29.
12. **Tests** — see `## Tests`.

---

### P2 — one untrusted renderer, and the copy both wave-2 packages need

**Agent:** implementer · **Depends on:** —

**Owns:**
- `client/src/components/context-doc-view/**` (new)
- `client/src/app/repos/[repoId]/context/_components/DocumentReader/**` (deleted by this package)
- `client/src/app/repos/[repoId]/context/_components/ProjectContextView/helpers.ts` and `helpers.test.ts`, and the
  one import line in `ProjectContextView.tsx` — **only** what the move requires; P3 owns the rest of that folder afterwards
- `client/messages/en/context.json`

**Contract — what P3 and P4 may assume:**

- `@/components/context-doc-view` exports:
  - `DocumentReader({ markdown }: { markdown: string })` — the one untrusted renderer (R12).
  - `DocReadFailure({ reason }: { reason: "missing" | "refused" | "binary" })` — the reason block (R11).
  - `readFailureReason(err: unknown): "missing" | "refused" | "binary" | null` — maps an `ApiError` carrying
    `doc_missing` / `doc_refused` / `doc_binary` to that union, and anything else to `null`.
  - `isSafeUrl(url: string | undefined): boolean` and `KIND_COLOR: Record<ContextDocKind, string>`.
- `client/messages/en/context.json` already carries **every** key both wave-2 packages need. Add no key of your
  own; if one is missing, that is a gap to report, not to fill.
- `ProjectContextView/helpers.ts` keeps `formatWhen` and nothing else.

**Steps**

1. **Create `client/src/components/context-doc-view/`**: `DocumentReader.tsx` (moved verbatim, header comment and
   both XSS halves intact), `helpers.ts` (`isSafeUrl` and `KIND_COLOR`, moved with their comments),
   `DocReadFailure.tsx` (an `EmptyState`-shaped block reading `read.missing` / `read.refused` / `read.binary`),
   `helpers.ts`'s `readFailureReason`, `styles.ts`, `index.ts`. Two routes consume it, which is what promotes it
   out of a route folder; leaving a second copy behind is what `AC-56` forbids. Serves R11, R12.
2. **Remove the old homes**: delete `…/context/_components/DocumentReader/`, strip `isSafeUrl` and `KIND_COLOR`
   from `ProjectContextView/helpers.ts`, move their cases out of `helpers.test.ts` into
   `context-doc-view/helpers.test.ts`, and repoint the two imports in `ProjectContextView.tsx` so
   `pnpm typecheck` and `pnpm test` are green when you stop. Serves R12.
3. **Write the whole message set** into `client/messages/en/context.json`, keeping the existing keys except where
   noted. The list is binding — P3 and P4 use these names:
   - Rewrite `subtitle` and `empty.body`: the page is no longer read-only.
   - `read.missing`, `read.refused`, `read.binary` — the three reasons (R11).
   - `actions.newDoc`, `actions.newFolder`, `actions.upload`, `actions.rescan` — the four control labels (R6).
   - `create.title`, `create.pathLabel`, `create.pathHint` (under `.devdigest/`), `create.submit`,
     `create.exists`, `create.invalidPath`, `create.tooLarge` (R13, R23, R24).
   - `folder.title`, `folder.pathLabel`, `folder.submit`, `folder.createdEmpty` — the last saying the folder was
     created and holds no `.md` yet, so the list will not show it (R15).
   - `upload.invalidType`, `upload.binary` (R14).
   - `reader.preview`, `reader.edit`, `reader.save`, `reader.cancel`, `reader.saving`, `reader.saveError` (R5, R16).
   - `local.badge`, `local.body` — three facts in one sentence: not in the repository; no colleague, clone or run
     elsewhere sees it; gone if the repository must be cloned again. **Never** "not committed yet" (R22).
   - `stale.badge`, `stale.body` — the shown text came from the branch; the edit made here is gone (R27).
   - `tracked.title`, `tracked.body` (naming `git reset --hard origin/{branch}` and "with no trace and no
     question"), `tracked.confirm`, `tracked.cancel` (R26).
   - `write.cloneNotReady` — why the four controls are disabled (R25).
   - `attach.preview`, `attach.previewLabel` (`"Preview {path}"`), `attach.previewTitle` (R9, R10).

---

### P3 — the Project Context page, rebuilt to the design

**Agent:** implementer · **Depends on:** P1, P2

**Owns:**
- `client/src/app/repos/[repoId]/context/**` (everything under it)
- `client/src/lib/hooks/context.ts`, `client/src/lib/types.ts`
- `client/src/app/globals.css` — **P4 must not touch this file**

**Contract — what you may assume, without opening another package:**

- Everything in P1's Contract block above: the four write routes with their bodies, statuses and error codes; the
  read route's three failure codes; `SpecFile.local` / `SpecFile.stale` (optional, absent = false); `roots` always
  containing `.devdigest`; a written document present in the next `GET …/docs` with no rescan.
- Everything in P2's Contract block above: `@/components/context-doc-view` exports `DocumentReader`,
  `DocReadFailure`, `readFailureReason`, `isSafeUrl`, `KIND_COLOR`; every message key you need already exists in
  `client/messages/en/context.json`; `ProjectContextView/helpers.ts` has only `formatWhen` left.
- `useActiveRepo().activeRepo?.default_branch` is the branch name R26's warning must print.

**Steps**

1. **Grouping, as pure helpers** in `ProjectContextView/helpers.ts`, unit-tested: `groupByRoot(documents)` →
   one entry per distinct `doc.root`, in the order the roots appear in `page.roots`, each carrying
   `{ root, kind, rows: { doc, label }[] }` where `label = doc.path.slice(root.length + 1)`. The server already
   assigns each document to exactly one root by longest match, so a document cannot land in two groups — the
   client must not re-derive that from the path prefix. Serves R1, R7, R8.
2. **The list pane**: a group header per root — the root printed **once**, with the group's kind badge from
   `KIND_COLOR` — and rows carrying `label` and nothing else. The `local` badge sits on a row whose document has
   `local === true`, and the `stale` badge on one with `stale === true`. Serves R1, R8, R22, R27.
3. **The action bar** above the list: exactly four controls — new document, new folder, upload, rescan — and
   **delete the Rescan button from the page header**, which is what makes the action bar the only rescan on the
   page. No rename and no delete control anywhere. All four are disabled with `write.cloneNotReady` when
   `page.data.state === "no_clone"`. Serves R3, R6, R25.
4. **The right panel's header**: the document name, a `Preview | Edit` toggle defaulting to `Preview`, the
   "Used by N agents" badge for the **selected** document (it leaves the list row in step 2), and the `local` /
   `stale` notice with its explanatory body. The pane renders through `DocumentReader`, and through
   `DocReadFailure` when `readFailureReason(doc.error)` is not `null`. Serves R2, R5, R11, R12, R22, R27.
5. **Edit mode**: a `Textarea` seeded from the loaded content when the toggle flips to `Edit`, held in local
   component state — a draft is not shareable and must not survive a reload, so it is neither URL state nor
   written into the query cache. Save calls the save hook and returns the panel to `Preview` showing the saved
   text; Cancel discards. When the selected document's path does not start with `.devdigest/`, Save opens the
   confirmation `Modal` first — `tracked.title` / `tracked.body` with the active repo's `default_branch`
   interpolated — and writes only on confirm. Serves R16, R26.
6. **Three dialogs**, following `CreateSkillFromConventionsModal`: new document (path under `.devdigest/`, then
   content empty), new folder (path; on success show `folder.createdEmpty` rather than a silently unchanged
   list), and upload (a hidden `<input type="file" accept=".md,text/markdown">` posting one `File` through
   `api.upload`). Map `ApiError.code` to the message: `already_exists` → `create.exists`, `invalid_path` →
   `create.invalidPath` / `upload.invalidType`, `too_large` → `create.tooLarge`, `binary_content` →
   `upload.binary`. Serves R13, R14, R15, R23, R24.
7. **Hooks** in `client/src/lib/hooks/context.ts` — no `fetch` in a component: `useCreateContextDoc`,
   `useUploadContextDoc`, `useCreateContextFolder`, `useSaveContextDoc`. Each writes the returned `SpecFile`
   nowhere by hand and instead invalidates `["context-docs", repoId]`, `["context-doc", repoId, path]`,
   `["agent-context-docs"]` and `["skill-context-docs"]` — the last two are how a saved edit moves the agent
   editor's token footer and raises the over-budget warning with the attachment set untouched. Re-export any new
   contract type from `client/src/lib/types.ts`. Serves R18, R20.
8. **Tests** — see `## Tests`.

---

### P4 — preview and the kind badge in both attach tabs

**Agent:** implementer · **Depends on:** P2 (and, at runtime only, P1)

**Owns:**
- `client/src/components/context-docs/**`
- `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/**`
- `client/src/app/skills/_components/SkillDetail/_components/ContextTab/**`

**Contract — what you may assume, without opening another package:**

- From P2: `@/components/context-doc-view` exports `DocumentReader({ markdown })`,
  `DocReadFailure({ reason })` and `readFailureReason(err)`; the keys `attach.preview`,
  `attach.previewLabel` (`"Preview {path}"`), `attach.previewTitle`, `read.missing`, `read.refused`,
  `read.binary` exist in `client/messages/en/context.json`. Add no key.
- From P1, at runtime: `GET /repos/:id/context/docs/content?path=…` answers `200` with a `SpecFile` carrying
  `content`, or an error whose `code` is `doc_missing` / `doc_refused` / `doc_binary`. `useContextDoc(repoId,
  path)` in `client/src/lib/hooks/context.ts` already calls it and needs no change — read the failure off
  `query.error` through `readFailureReason`.
- `SpecFile.kind` is one of four values and `KIND_COLOR` covers all four. `orderDocuments` already hands each row
  its `doc: SpecFile | undefined`; a row whose `doc` is `undefined` is a saved path the scan no longer holds and
  gets no badge.

**Steps**

1. **The kind badge** on every `ContextDocList` row (`components/context-docs/ContextDocList.tsx`): `<Badge
   color={KIND_COLOR[doc.kind]}>{t(\`kinds.${doc.kind}\`)}</Badge>`, beside the existing `missing` badge. This is
   the defect: `AC-10` has required it since the first plan and no row has ever rendered one. Serves R4.
2. **The preview control** on every `ContextDocList` row — attached and unattached alike, since deciding whether
   to attach is the whole point — as a button with `aria-label={t("attach.previewLabel", { path })}`. It must not
   toggle the checkbox or start a drag: stop the event and keep it outside the row's drag handlers. Serves R9, R10.
3. **The same control on every `InheritedGroup` row.** Those rows stay read-only in every other respect — no
   checkbox, no handle: preview is not a way around "inherited documents are managed on the skill". No kind badge
   here; `InheritedContextDoc` carries no `kind` and `AC-10` speaks of the attachable list. Serves R10.
4. **`DocPreview`** in `components/context-docs/`: a vendored `Modal` titled with the document path, its body
   `DocumentReader` on success, `DocReadFailure` on a mapped failure, `Skeleton` while loading. It holds the
   previewed path in local state and nothing else — opening and closing it must leave the attachment set and its
   order untouched. Both `ContextDocList` and `InheritedGroup` take a new `repoId` prop and both `ContextTab`
   components pass it. Serves R9, R10, R11, R12.
5. **Tests** — see `## Tests`.

---

**Dispatch order.**

| Wave | Packages | Landing condition before the next wave |
|---|---|---|
| 1 | **P1** and **P2**, concurrently | P1: `pnpm arch`, `pnpm typecheck`, unit tests and `diff -r` all green. P2: `pnpm lint`, `pnpm typecheck`, `pnpm test` green — the renderer move must leave the client compiling |
| 2 | **P3** and **P4**, concurrently | Both green on the client gates; then the whole-repo verification below |

P1 and P2 touch no common file: P1's only client paths are under `client/src/vendor/shared/`, P2's are components
and messages. P3 and P4 touch no common file either — and `client/messages/en/context.json` and
`client/src/app/globals.css` are the two that would otherwise collide, which is why one belongs to P2 and the
other to P3 alone.

## Tests

Unit tests are each package's own; nobody writes another package's file.

**P1** (`server/`, hermetic unless suffixed `.it.test.ts`):
- `server/test/git-write-containment.test.ts` — **new**, modelled on `git-read-containment.test.ts` (a real temp
  tree, no DB, no git binary): a write through a symlinked component refused; a write resolving outside the clone
  refused; `.devdigest/x.md → ../.git/config` refused; an over-cap body refused **with no file created**; create
  onto an existing path refused and the original byte-identical; a successful overwrite leaving no temp file.
- `server/test/context-write.test.ts` — **new**, service level over `MockGitClient` and a fake repository: the
  zone rules for each of the four use cases, `clone_not_ready`, the returned `SpecFile`'s `kind` / `tokens` /
  `local`, `binary_content` on an uploaded body carrying `U+0000`, and the basename rule for a filename like
  `../../evil.md`.
- `server/test/context-helpers.test.ts` — extend: `.devdigest` present with configured roots, with none (the
  defaults must survive), and when the workspace typed `.devdigest/` by hand (one root, not two); `rootFor`
  longest match; `writeZone`.
- `server/test/context.it.test.ts` — extend: create → the document is in `GET …/docs` with no rescan and is
  attachable; a second create on the same path → `409`; save → `GET …/content` returns the new text; the three
  read-failure codes.
- Commands: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`, then
  `cd server && pnpm exec vitest run .it.test --fileParallelism=false` (see `## Risks`).

**P2**: `client/src/components/context-doc-view/helpers.test.ts` — the `isSafeUrl` cases moved out of
`ProjectContextView/helpers.test.ts`, plus `readFailureReason` over an `ApiError` of each code and over an
unrelated error. `cd client && pnpm test`.

**P3**: rewrite `ProjectContextView.test.tsx` — one group header per root with the root printed once and the row
showing the relative label; four controls and no Rescan in the page header; the toggle defaulting to `Preview`;
the tracked-file confirmation appearing before any mutation fires and the mutation firing only after confirm; the
`local` and `stale` notices. Add `helpers.test.ts` cases for `groupByRoot`, nested roots included. `fireEvent`,
not `user-event`. `cd client && pnpm test`.

**P4**: a kind badge on every row of `ContextDocList`; a preview control on an **unattached** row and on an
inherited row, each with an accessible name naming the document; opening and closing the preview calling no
`onCommit`. `cd client && pnpm test`.

**Integration and e2e:** the server integration file above is in scope. **No e2e flow is in scope** —
`e2e/specs/*.flow.json` is not touched by this plan.

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`. `reviewer-core` is untouched, so its two gates do
not run.

**P1**
```sh
cd server && pnpm arch
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
diff -r server/src/vendor/shared client/src/vendor/shared
```

**P2, P3, P4**
```sh
cd client && pnpm lint
cd client && pnpm typecheck
cd client && pnpm test
```

**After wave 2, once, over the whole tree**
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

## Risks (from INSIGHTS.md)

| Risk | What this plan does |
|---|---|
| *"A path compared as a string must be canonicalised before it enters, not at each comparison"* (`server/INSIGHTS.md:462`) — a root written `docs/` walked the right directory and then matched nothing: a successful, empty scan with no error | P1 step 8 appends `.devdigest` **after** `normalizeRoot` and de-duplicates after it, and step 7 keeps one `rootFor` for the scan and the write path |
| *"18 integration files each start their own testcontainers Postgres in parallel … a trace fetch answers 404 because the run did not finish"* (`server/INSIGHTS.md:826`) | `## Tests` runs the integration split with `--fileParallelism=false`. A `404` from a trace fetch is a timeout, not a routing defect |
| *"`drizzle-kit generate` cannot be answered from a pipe"* (`server/INSIGHTS.md:603`) — a migration that both adds and drops needs two runs | P1 step 6 is additive only: one new table, one new nullable column, one `db:generate` |
| *"A comment asserting a mechanism is worth grepping for the mechanism"* (`server/INSIGHTS.md`, 2026-08-14) — four of five findings were comments the code did not honour | R28 is a step, not a footnote; and the `.devdigest` invariant is asserted by a test, not by a sentence |
| `String.slice` splits a surrogate pair (`server/INSIGHTS.md:166-180`) | The write path bounds **code points** and bytes separately, reusing `truncateCodePoints`' rule |
| *"`PromptAssembly` gains a field and the trace drawer does not — nothing checks"* (`client/INSIGHTS.md:892`) | `local` and `stale` are rendered in P3 steps 2 and 4, and asserted in P3's tests. A contract field nobody renders is this plan failing |
| *"A fixture built by spreading `FIXTURE.array[0]` passes `pnpm test` and fails `pnpm typecheck`"* (`client/INSIGHTS.md:909`) | `local` and `stale` are optional, so wave 1 cannot redden wave 2's fixtures before they are updated |
| *"`@testing-library/user-event` is not installed"* (`client/INSIGHTS.md:583`) | Every component test uses `fireEvent` |
| *"A disabled TanStack v5 query reports `isLoading === false`"* (`client/INSIGHTS.md:638`) | The page's four states stay decided in one ordered branch on `page.data.state`; the editor draft is local state, never inferred from a flag |
| An inline style beats a media-query rule whatever the selector (`client/AGENTS.md`) | Any responsive property for the new action bar or panes is declared **only** in `globals.css`, keyed on a `dd-` class — and only P3 may edit that file |

## Alternatives rejected

- **Letting a client package own the contract change** (so wave 2 could start earlier). It cannot: adding a field
  to `SpecFile` breaks `toDocDto`, and adding a method to `GitClient` breaks `SimpleGitClient` and
  `MockGitClient` — all server files. The alternative was a placeholder `local: false` shipped by a client agent
  and corrected later, which is a lie in the tree between two waves.
- **A JSON upload (`{ filename, content }`) instead of multipart.** `@fastify/multipart` is already registered
  and already used by skill import, `api.upload` already exists on the client, and multipart keeps the filename
  rule (basename it, join `.devdigest/` server-side) where the spec puts it. JSON would have meant the browser
  decoding the file and a second way to express the same request.
- **Deciding "is this file tracked by git" with `git ls-files`.** `AC-70` defines the answer as "outside
  `.devdigest/`", so a subprocess per save would buy a second, occasionally disagreeing answer.
- **Server-enforced confirmation for R26.** The warning is something a UI renders; the server cannot. Left as
  Recommendation 1 rather than folded in.
- **Computing `stale` by re-reading every document on every list request.** The scan already reads each file to
  count its tokens, so a `content_hash` column answers the same question with no I/O, and the single-document
  read recomputes it live where freshness matters.
- **Storing document text in Postgres for durability.** `D4` settled it: the mechanism is the file, and a second
  copy would create the "who wins" question the spec's `## Edge cases` says does not exist.
- **Keeping the untrusted renderer in the page folder and building a second one for the tabs.** `AC-56` forbids
  two, and two would drift on the first change to either.
- **A three-wave order with the tabs last.** P4 depends only on P2, so waiting for P1 would serialise work that
  has no reason to wait.

## Verification

Run after wave 2, in order. Everything below is observable; the last item goes through the real entry point.

1. `cd server && pnpm db:migrate` applies `0017_*` and the API boots. (R22, R27)
2. `./scripts/dev.sh`, then open `http://localhost:3000/repos/<id>/context`. The list shows **one group per
   configured root plus `.devdigest`**, each root printed once with its kind badge; a document under `docs/adr/`
   with both roots configured appears once, in the `docs/adr` group, labelled `0001.md`; with only `docs`
   configured it appears in `docs` labelled `adr/0001.md`. (R1, R7, R8, R17)
3. Exactly four controls sit above the list; the page header has no Rescan button; there is no rename or delete
   control on the page. (R3, R6)
4. Select a document: the right panel's header shows its name, a `Preview | Edit` toggle sitting on `Preview`,
   and "Used by N agents" — and the list row no longer carries that count. (R2, R5)
5. Create `.devdigest/house-rules.md` through the `+` control. It appears in the list **without pressing
   Rescan**, with a kind badge (`other`), a token count and the "local to this machine" mark whose text says all
   three consequences. `ls server/clones/<owner>/<repo>/.devdigest/` shows the file. (R13, R18, R22)
6. Create the same path again → "already exists", and the file on disk is unchanged. Upload a `.md` → it lands at
   `.devdigest/<basename>`. Upload a renamed binary → refused, and no file appears. Create a folder → the UI says
   it was created and holds no `.md` yet. (R14, R15, R23, R24)
7. `Edit` the created document, save, and the panel returns to `Preview` showing the new text; `cat` the clone
   file to confirm. Then `Edit` a **git-tracked** document (`docs/architecture.md`): the confirmation names
   `git reset --hard origin/<default-branch>` and says the edit is erased with no trace; cancelling leaves the
   file byte-identical; confirming writes it. (R16, R26)
8. `curl` the four write routes with a bad path — absolute, `..`, `.txt`, `.git/config`, and (for create) a path
   outside `.devdigest/` — each answers `400` and creates nothing. With `PROJECT_CONTEXT` roots pointing at a
   clone that does not exist yet, the controls are disabled with the "preparing the clone" explanation instead of
   erroring. (R23, R25)
9. Attach the created document to an agent in **Skills Lab → Agents → Context**: every row carries its kind
   badge, and every row — attached, unattached and inherited — carries a preview control whose accessible name
   names the document. Open one: the markdown renders, and closing it leaves the checkboxes and their order
   exactly as they were. Preview a document that was deleted from the clone: the reason `missing` appears in
   place of the content. (R4, R9, R10, R11)
10. A document containing `<img src=x onerror=alert(1)>` and `[click](javascript:alert(1))` renders the tag as
    **text** and the link as un-clickable text — on the page, in `Preview` mode, and in the tab preview. (R12)
11. Save an edit that makes the effective set exceed the budget: the agent editor shows the over-budget warning
    with the attachment set unchanged. (R20)
12. **End to end.** Attach the created document to an enabled agent, run a review on a PR from the repository's
    page, open the run trace: `Specs read` names the document and the `## Project context` block holds the text
    **as last saved**. Then edit the document, run again, and the block holds the new text. (R19)
13. **Durability.** With the created document in place, trigger a repo refresh and then a resync
    (`POST /repos/:id/refresh`, then whatever triggers `resyncRepo`), and re-read the document: same content,
    still listed. Then edit a tracked document, resync, and re-open it: the content is the branch's and the page
    says the edit made here is gone. (R21, R27)
14. **Regression, from plan 08:** the footer still reads "N documents · last scanned …"; the clone-preparing and
    empty states still render; the reading pane still renders markdown. (`AC-2`, `AC-4`, `AC-5`, `AC-6`, `AC-7`)

## Open questions

_None._ The spec's own `## Open questions` is empty, and both questions raised by the 2026-08-14 amendment were
closed by the human the same day. Recommendations 1-3 are proposals, not questions — the plan is executable as
written whether or not any is accepted.

# 07 — Blast Radius

**Status:** Planned 2026-08-09
**Scope:** repo-wide | server · client · mcp · vendored `shared` contract
**Modules touched:** `server/src/modules/blast` (new), `repo-intel`, `reviews`, both
`vendor/shared/contracts` copies, the PR-detail Overview tab, `mcp/`

## Problem

The repo-intel index already knows which symbols a PR changes, who calls them, and which HTTP
endpoints and crons sit in the calling files — and nothing surfaces it. No route, no card, no
MCP answer, so a reviewer still has to guess what a change reaches. This spec exposes that
index as a read-only per-PR answer: an HTTP route, a card in the Overview tab, a real MCP tool,
and an optional one-paragraph LLM explanation built on facts the index supplied. It also adds a
CLI (`devdigest review --mode working`) that reviews the uncommitted tree through the same
reviewer-core engine, so the loop is usable before a PR exists.

## Out of scope

- **The tree/graph toggle.** Tree only — no graph view, no `MermaidDiagram`, even though
  `blast.json` already carries `view.graph` and `graph.*`.
- **Persisting the blast result or the summary.** Both are computed per request.
- **Indexing changes.** No pipeline stage, no table, no migration. An unindexed repo gets a
  `degraded` status with a reason, not an index run.
- **`PrBrief`.** `contracts/brief.ts` `BlastRadius` stays untouched and unused here.
- **A new `FeatureModelId`** (the summary reuses `risk_brief`; widening the enum drags in the
  Settings screen), **`--mode staged` / `--mode branch`** (validated and refused, not
  implemented), and **e2e** (no `e2e/specs/*.flow.json` change).

## What already exists

| Path | What it gives us |
|---|---|
| `server/src/modules/repo-intel/service.ts:220-303` | `getBlastRadius(repoId, changedFiles)` — public facade entry, with a **clone-reading fallback** (`readClone`, `codeIndex.symbols`) when the persistent path declines |
| `server/src/modules/repo-intel/service.ts:305-391` | `tryPersistentBlast` — Postgres only. Returns `null` unless `repo_index_state.status` is `full` or `partial` |
| `server/src/modules/repo-intel/service.ts:386` | `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` applied to the **flat** list — the bug in step 3 |
| `server/src/modules/repo-intel/types.ts:74-87` | `BlastResult` (`changedSymbols`, `callers`, `impactedEndpoints`, `factsByFile`, `degraded`, `reason`) |
| `server/src/modules/repo-intel/repository.ts:432-437` | `getEdges(repoId)` — **all** edges for a repo, unscoped; the rank pipeline's query, not a blast query |
| `server/src/db/schema/repo-intel.ts:55-68` | `file_edges`: `fromFile` **imports** `toFile`; index `file_edges_repo_to_idx` on `(repoId, toFile)` is already the reverse-lookup path |
| `server/src/db/schema/repo-intel.ts:74-86` | `file_facts` — per-file `endpoints` / `crons`, precomputed |
| `server/src/db/schema/pulls.ts:5-55` | `pull_requests` (`headSha`, `repoId`, `workspaceId`) and `pr_files` (`path`) |
| `server/src/modules/intent/types.ts:22-43` · `intent/routes.ts` | the structural-port pattern step 5 copies, and the route shape: `getContext`, `IdParams`, `NotFoundError`, `rateLimit: {max: 6}` on the LLM route |
| `server/src/modules/_shared/feature-models.ts:26-34,55-60` | `SettingsReader` + `resolveFeatureModel`, how a system feature picks provider+model |
| `server/src/modules/reviews/run-executor.ts:328-354` · `adapters/git/diff-parser.ts:14` | the only current call of `reviewPullRequest`, and `parseUnifiedDiff(raw)` → `UnifiedDiff` |
| `client/messages/en/blast.json` | `stat.*`, `view.*`, `callerCount`, `noDownstream`, `graph.*` — already loaded by `src/i18n/request.ts` (directory scan, no registration step) |
| `client/.../_components/OverviewTab/OverviewTab.tsx:29-31` | the reserved `<div aria-hidden />` slot |
| `client/src/lib/github-urls.ts:63-78` · `vendor/ui/primitives/MonoLink.tsx` | `githubBlobUrl(repoFullName, sha, file, startLine, endLine)`, and the primitive whose `href` renders an anchor |
| `mcp/src/tools/blast-radius.ts` · `index.ts:87,218-226` · `project.ts:36-38` | the stub, its frozen description and registration, and `truncate` by code point |

**Nothing exists** for: an HTTP blast route, a reverse import-graph walk, a `blast` contract, a
card, an MCP blast answer, a diff-only review route, or a CLI.

## Constraints

| Rule | Source |
|---|---|
| `blast/` may not import `modules/pulls/**` or `modules/repo-intel/**` — including `import type`, which counts as an edge | `.dependency-cruiser.cjs:146-162` (`no-cross-module`); `server/INSIGHTS.md:99-117` |
| No Drizzle outside `blast/repository.ts`; no `container.db` in a route; the service takes its repository as a parameter; no `*Row` leaves the slice | `.dependency-cruiser.cjs:39,52`; `onion-architecture` §3.1-3.3, §3.5 |
| Routes declare `schema` (Zod via `ZodTypeProvider`); no hand-rolled `Schema.parse(req.body)` | `server/README.md`; `onion-architecture` §3.1 |
| `vendor/shared` is two physical copies; the server copy is the source of truth and must be mirrored byte-for-byte | root `CLAUDE.md`; `gates.md` → `repo · vendor` |
| Fastify modules are registered by hand in `server/src/modules/index.ts` | `server/src/modules/index.ts:16-25` |
| Client: no `fetch` in a component — data arrives through a hook in `src/lib/hooks/*`; tests use `fireEvent` (`user-event` is not installed) | `client/AGENTS.md`; `client/INSIGHTS.md:435` |
| `mcp/` uses **npm**, `NodeNext` (relative imports carry `.js`), never imports `server/src/**`, never writes to stdout | `mcp/AGENTS.md` |
| Truncate by code point (`[...text].slice`), never `String.slice` | `server/INSIGHTS.md:164-176` |

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| 1, 2 | `zod` | The new contract in both vendored copies — snake_case object schema, `z.infer` exports, enum for `status` |
| 3, 4 | `drizzle-orm-patterns` | The reverse-edge query and the per-symbol cap live in repo-intel's repository/service |
| 4 | `postgresql-table-design` | Confirm the depth-2 walk rides `file_edges_repo_to_idx` and adds no index |
| 5-8, 14 | `onion-architecture` | Ring placement for the new `blast/` slice, the structural container port, the repository seam, and where the `/reviews/diff` logic sits |
| 9, 10, 14 | `fastify-best-practices` | Route schema declaration, per-route `rateLimit`, error mapping |
| 9, 14, 15 | `security` | Every new entry point takes user input; the diff route accepts an otherwise unbounded body |
| 11, 12 | `frontend-architecture` | Card placement under `_components/`, hook vs component-body split, where the "explain" state lives |
| 12 | `react-best-practices` · `next-best-practices` | Four states that never mask each other, no derived state in `useState`, keys on caller rows; `'use client'` on the leaf, not the tab or a barrel |
| 12 (test) | `react-testing-library` | `BlastRadiusCard.test.tsx` — query priority, `fireEvent`, the `href` assertion |

## Steps

### Contract

**1. `server/src/vendor/shared/contracts/blast.ts` (new).** Zod, snake_case, mirroring the
other platform contracts. Export schemas *and* `z.infer` types:

```
BlastIndexStatus = z.enum(['full','partial','degraded'])
BlastEndpoint    = { label, file, line, depth: z.number().int().min(0).max(2), kind: z.enum(['http','cron']) }
BlastCaller      = { file, symbol, line, rank }
BlastSymbol      = { name, kind, file, line, callers: BlastCaller[], caller_count, truncated, endpoints: BlastEndpoint[] }
BlastRadiusView  = { status, reason: z.string().nullable(), repo_full_name, head_sha,
                     changed_files: string[], symbols: BlastSymbol[],
                     totals: { symbols, callers, endpoints, crons }, summary: z.string().nullable() }
BlastSummaryResponse = { summary: z.string() }
```

Name it `BlastRadiusView`, not `BlastRadius` — `contracts/brief.ts:77-82` already exports that
name and the barrel is `export *`. A header comment states the relationship: `brief.ts`'s
version is the future `PrBrief` payload, carries no index status and no line numbers, and
without a line number the `file:line` link cannot open the right line. Add
`export * from './contracts/blast.js';` to `server/src/vendor/shared/index.ts` alongside lines
18-28, plus one line in its header inventory. *Check:* `cd server && pnpm typecheck`.

**2. Mirror to the client.** Copy `blast.ts` verbatim to
`client/src/vendor/shared/contracts/blast.ts`, make the identical barrel edit in
`client/src/vendor/shared/index.ts`, and re-export the card's types from
`client/src/lib/types.ts` (types only, not schemas — `client/AGENTS.md`).
*Check:* `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing.

### repo-intel

**3. Cap callers at 20 per symbol.** `server/src/modules/repo-intel/service.ts:386` applies
`MAX_CALLERS_PER_SYMBOL` to the flat list; the constant name says per-symbol. Group `callers`
by `viaSymbol`, sort each group by `rank` descending with a stable tiebreak on `file` then
`line`, take the first 20 of each group, then flatten. State the sort explicitly — an
aggregate without an `ORDER BY` reshuffles for no visible reason (`server/INSIGHTS.md:69-80`).
`getBlastRadius` has no other consumer today, so no call site changes.
*Check:* `server/test/blast-service.test.ts`; `cd server && pnpm arch`.

**4. `getDownstream(repoId, files, maxDepth)` on the `RepoIntel` facade.** New method on the
interface (`types.ts`), the service, and a new scoped repository query. **Verify the column
direction empirically before writing the query** — read `schema/repo-intel.ts:50-53` and confirm
against the indexer that writes the rows. The answer this plan expects: `from_file` **imports**
`to_file`, so the dependents of a changed file `X` are `WHERE repo_id = ? AND to_file IN (X…)`
and `from_file` is the dependent. Do not reuse `getEdges` (`repository.ts:432`) — it loads every
edge in the repo. Walk breadth-first, **depth capped at exactly 2**, seeding depth 0 with the
changed files and excluding them from the result; dedupe by file keeping the smallest depth;
enrich from the existing `getFileFacts` read; return `{ file, depth, endpoints, crons }[]` with
the type declared in `repo-intel/types.ts`.
*Check:* `server/test/blast-downstream.test.ts`; `pnpm arch`; `pnpm typecheck`.

### The `blast/` module

**5. `server/src/modules/blast/types.ts` (new).** Declare `BlastContainer` structurally, the
way `modules/intent/types.ts:22-43` does. It must **not** import `Container` and must **not**
import `modules/repo-intel/types.js` — the second is the binding reason here, since a type
import across slices is a `no-cross-module` edge. `repoIntel` is declared inline with only
the three methods this module calls:

```ts
export interface BlastContainer extends SettingsReader {
  readonly repoIntel: {
    getIndexState(repoId: string): Promise<{ status: string; degraded?: boolean; degradedReason?: string }>;
    getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastFacts>;
    getDownstream(repoId: string, files: string[], maxDepth: number): Promise<DownstreamFile[]>;
  };
  llm(id: Provider): Promise<LLMProvider>;
}
```

`BlastFacts` / `DownstreamFile` are local structural declarations naming only the fields read
(return types are covariant, so the real `BlastResult` satisfies a narrower shape; widen
`reason?: DegradedReason` to `reason?: string`). Everything else is a contract type from
`@devdigest/shared`; a real `Container` satisfies this by construction.
*Check:* `pnpm arch` reports no `no-cross-module` and no `no-circular` edge from `blast/`.

**6. `server/src/modules/blast/repository.ts` (new).** `constructor(private db: Db) {}`, no
`Container`. Two reads: `getPullForBlast(workspaceId, prId)` →
`{ repoId, headSha, owner, name } | undefined` (join `pull_requests` → `repos`, scoped by
workspace), and `getChangedFiles(prId)` → `string[]` from `pr_files` ordered by `path` so the
answer is stable. *Check:* `pnpm arch` (`no-sql-outside-repository`).

**7. `server/src/modules/blast/helpers.ts` (new).** Pure, calls nothing. Two functions:

- `deriveStatus(indexState, facts)` → `{ status: 'full'|'partial'|'degraded', reason: string|null }`.
  `full` only when `indexState.status === 'full'` **and** `facts.degraded !== true`;
  `partial` when `indexState.status === 'partial'`; `degraded` otherwise. `reason` is one
  human-readable sentence naming the cause (`degradedReason` / `facts.reason` mapped to prose),
  and `null` only when `status === 'full'`. **An empty `symbols` array is never served as "no
  impact" under a non-`full` status** — the card branches on `status` before emptiness.
- `toView(...)` → `BlastRadiusView`: group callers by `viaSymbol`, attach the symbol's
  declaration line, set `caller_count` to the count **before** the 20 cap and `truncated`
  accordingly, attach endpoints from the downstream walk (`kind: 'http'` from `endpoints`,
  `'cron'` from `crons`, carrying `depth`), compute `totals`. No `*Row` leaves this file.

**8. `server/src/modules/blast/service.ts` (new).** Constructor takes `BlastContainer` plus the
repository as a defaulted parameter (`onion-architecture` §3.3); `db` is deliberately not on the
port, so pass `Db` alongside it or have the route supply the repository — pick one, keep the
seam. `getBlast(workspaceId, prId)`: (1) `repo.getPullForBlast` — `undefined` means the caller maps a
404. (2) `repoIntel.getIndexState(repoId)` **first**; if the status is not `full` or `partial`,
return the degraded view and **do not call `getBlastRadius`** — its fallback reads the clone and
calls `codeIndex.symbols` (`service.ts:236-303`), the AST work acceptance criterion 4 forbids on
the request path. (3) `repo.getChangedFiles`; an empty list short-circuits to an empty `full`
view. (4) `getBlastRadius` and `getDownstream(repoId, changedFiles, 2)` in one `Promise.all`.
(5) `deriveStatus` + `toView`. **Zero LLM calls on this path, always.**

`summarize(workspaceId, prId)`: build the view with `getBlast`, resolve provider+model with
`resolveFeatureModel(container, workspaceId, 'risk_brief')`, `await container.llm(provider)`, and
make **exactly one** `llm.complete` call. The prompt carries the view's symbols, callers and
endpoints as the only facts and forbids naming anything absent from that list; one paragraph.
Persist nothing. A `degraded` status is stated in the prompt, not a reason to skip the call.

**9. `server/src/modules/blast/routes.ts` (new).** A default Fastify plugin,
`app.withTypeProvider<ZodTypeProvider>()`, copying `modules/intent/routes.ts`.
`GET /pulls/:id/blast` — `schema: { params: IdParams }`, `getContext` for tenancy,
`undefined` → `NotFoundError`, no extra rate limit (it is a pure read).
`POST /pulls/:id/blast/summary` — same params schema plus
`config: { rateLimit: { max: 6, timeWindow: '1 minute' } }`, the intent route's number for a
human clicking a button, and tenancy resolved **before** spending.

**10. Register the module.** One import and one entry in `server/src/modules/index.ts`.
*Check:* `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`.

### Client

**11. `client/src/lib/hooks/blast.ts` (new).** Follow `src/lib/hooks/repo-intel.ts`:
`useBlastRadius(prId)` → `useQuery` on `GET /pulls/:id/blast`, key `['blast', prId]`,
`enabled: !!prId`; `useExplainBlast(prId)` → `useMutation` on `POST /pulls/:id/blast/summary`
writing the paragraph into the cached view with `qc.setQueryData`. Not added to an aggregating
barrel (`client/INSIGHTS.md:317`).

**12. `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/` (new)** —
`BlastRadiusCard.tsx`, `styles.ts`, `index.ts`, `BlastRadiusCard.test.tsx`. `'use client'` on
the component leaf. Top to bottom: stat row (`t('stat.*')` against `totals`) → one disclosure
per symbol labelled `t('callerCount', { count })` → caller rows as `MonoLink` with
`href = githubBlobUrl(repo_full_name, head_sha, caller.file, caller.line)`, degrading to plain
text when it returns `undefined` → endpoint chips. An "Explain" button calls the summary
mutation and renders the paragraph; it never fires automatically.

Four states, branched in this order, none masking another: `isError` → error;
`isLoading && !data` → skeleton; `status !== 'full'` → the card **plus** a banner carrying
`reason`; `symbols.length > 0 && totals.callers === 0` → `t('noDownstream', { count })`.
Before fixing that order, write down what a **disabled** query renders and confirm it is a
state you want (`client/INSIGHTS.md:490-517`): with no `prId` the query is `enabled: false`, so
`isLoading` is `false` and `data` is `undefined`, and the fall-through must land on the empty
state, not the error state.

Reuse `messages/en/blast.json` as it stands; add a key only if genuinely missing (an error label
and an explain label likely are). No `view` toggle. Then replace `OverviewTab.tsx:29-31`'s
`<div aria-hidden />` with `<BlastRadiusCard prId={prId} />` and drop the reservation comment.
*Check:* `cd client && pnpm lint && pnpm typecheck && pnpm test`.

### MCP

**13. Rewrite `mcp/src/tools/blast-radius.ts`.** Signature becomes
`getBlastRadius(client: ApiClient, resolver: Resolver, args: { repo: string; pr: number })`,
copying `mcp/src/tools/get-conventions.ts`: `assertRepoSlug` / `assertPrNumber` →
`resolver.pullId(repo, pr)` → `client.get('/pulls/<id>/blast', BlastPayload)`, where
`BlastPayload` is a **narrow local Zod schema** in `mcp/src/api/schemas.ts` naming only the
projected fields — never a third vendored copy of the contract (`mcp/AGENTS.md`).

Add `projectBlast` to `mcp/src/project.ts`: keep `status`, `reason`, `changed_files`, `totals`,
and per symbol `name`, `file:line`, callers as `file:line` up to a documented cap, and endpoint
labels. Sort **totally** (rank desc, then file, line, name — a partial order over an unordered
input is not deterministic, `project.ts:70-80`) and truncate with the existing code-point
`truncate`. A non-`full` status must surface as a `note` the model reads, the way
`get_conventions` does for an empty answer.

Update `mcp/src/index.ts:87` — replace the `PLACEHOLDER` description with what the tool does,
when to call it, and that it costs nothing — and `:218-226` to pass `client` and `resolver`
through `guard`. *Check:* `cd mcp && npm run typecheck && npm test && npm run build`, then
launch `node dist/index.js`; the suite resolves `./x.js` → `x.ts` and will not catch a missing
extension (`mcp/AGENTS.md`).

### CLI

**14. `POST /reviews/diff` in the existing `reviews/` module.** Route in
`server/src/modules/reviews/routes.ts`, body schema declared with Zod
(`{ diff: z.string().min(1).max(<explicit cap>), agentId?: string, all?: boolean }`), per-route
`rateLimit` at least as tight as `POST /pulls/:id/review`'s 10/min. Resolve the agent through
the **existing** `ReviewService.resolveTargets` (`service.ts:47-58`), parse the diff with
`parseUnifiedDiff`, resolve the provider with `container.llm(agent.provider)`, and call the
**same** `reviewPullRequest` (`reviewer-core/src/review/run.ts:148`) with `systemPrompt`,
`model`, `diff`, `llm`, `strategy`, `task`. Persist **nothing** — no PR row to attach findings
to — and return the structured findings plus the verdict. No new engine code in `reviewer-core`.
State the body cap and reject above it: an unbounded diff is an unbounded prompt (`security` A06).

**15. The CLI in `mcp/`.** Add `"bin": { "devdigest": "dist/cli.js" }` to `mcp/package.json`;
add no runtime dependency — argument parsing is hand-rolled. New `mcp/src/cli.ts`:
`git rev-parse --show-toplevel` → `git diff HEAD` (via `node:child_process` `execFile`, never a
shell) → `POST /reviews/diff` through the existing `ApiClient` → print `severity path:line title`
per finding → exit.

- `--mode` validates against `working|staged|branch`; `staged` and `branch` exit **2** with
  `not implemented`, keeping the room without the code.
- **Untracked files are invisible to `git diff HEAD`.** Exclude them honestly, say so in `--help`.
- Exit contract, in `--help`: **0** no blocking findings · **1** blocking findings · **2** the
  review could not be run. Diagnostics to stderr; keep `cli.ts` and `index.ts` on separate
  import chains so nothing can make the MCP server print.

*Check:* `cd mcp && npm run build && node dist/cli.js --help`, then a real run against a dirty
working tree with the API up.

## Tests

Every new test must be **proven to fail before it is left green** — the root `AGENTS.md` names
this as the one thing not to economise on.

| File | Kind | Asserts |
|---|---|---|
| `server/test/blast-service.test.ts` (new) | unit, fake `BlastContainer` + fake repository | callers grouped by symbol; **21 callers on one symbol yield 20 with `truncated: true` and `caller_count: 21`**, while two symbols with 15 each keep all 30; rank-desc order with the file/line tiebreak; `deriveStatus` over all three statuses incl. `degraded` with a non-null reason; an unindexed repo returns `degraded` **without** `getBlastRadius` being called (assert the spy count is 0); the whole path makes zero `llm` calls |
| `server/test/blast-downstream.test.ts` (new) | unit, fake repository over a hand-built edge set | the walk returns dependents (not dependencies), **stops at depth 2** — a node reachable only at depth 3 is absent — dedupes to the smallest depth, and excludes the changed files themselves |
| `server/test/blast.it.test.ts` (new) | integration, testcontainers Postgres, `app.inject()` | `GET /pulls/:id/blast` on a seeded indexed repo returns 200 with a `full` status and a non-empty `symbols`; an unknown id returns 404; a PR in an unindexed repo returns 200 with `status: 'degraded'` and a non-null `reason`. Follow `server/test/intent.it.test.ts:1-40` for the harness (`startPg`, `dockerAvailable`, `MockSecretsProvider({})` so no route can reach a live provider) |
| `client/.../BlastRadiusCard/BlastRadiusCard.test.tsx` (new) | component, jsdom | the four states render distinctly and none masks another; the caller row's **`href` equals the exact `githubBlobUrl` output including the `#L<line>` fragment**; the partial/degraded banner shows `reason`; the Explain button fires the mutation only on click. `NextIntlClientProvider` with `messages={{ blast }}`; `fireEvent`, not `userEvent` |
| `mcp/test/blast-radius.test.ts` (rewrite) | unit, stubbed `fetch` | the tool calls the API and projects it; sort is total and stable; a non-`full` status carries a note; a malformed `repo`/`pr` still throws `ToolError`. **Delete the existing `expect(getBlastRadius.length).toBe(1)` assertion** — it pins the stub signature |
| `mcp/test/cli.test.ts` (new) | unit, stubbed `fetch` + stubbed exec | exit 0 / 1 / 2 for the three outcomes; `--mode staged` exits 2 saying not implemented; `--help` mentions the exit codes and the untracked-file exclusion |

```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm exec vitest run .it.test        # integration IS in scope for this plan
cd client && pnpm test
cd mcp    && npm test
```

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`:
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

`reviewer-core` is untouched, so its two gates are `skip`, not `ok`. **`mcp/` has no Track A
gate** — `TESTING.md` records its suite as "run by hand" — so run
`cd mcp && npm run typecheck && npm test && npm run build` yourself and report it; `gates.sh`
will not. Then `/pr-self-review`: once when the feature is complete, once after the fixes, done.

## Risks (from INSIGHTS.md)

- **`server/INSIGHTS.md:99-117` — a service the container constructs must not import
  `Container`.** `RepoIntelService` has that cycle and it is baselined, which is why copying it
  reads as safe. Step 5's structural port is the fix, doing double duty: it also keeps
  `modules/repo-intel/types.ts` out of `blast/`'s import graph, which `no-cross-module` rejects.
- **`server/INSIGHTS.md:69-80` — an aggregate without a stated `ORDER BY` reshuffles.** Which is
  why step 3 specifies the sort in the same step that adds the grouping.
- **`server/INSIGHTS.md:39-57` — a frozen dependency-cruiser edge silences that edge entirely.**
  Do not run `pnpm arch:baseline` to clear anything this branch introduces.
- **`client/INSIGHTS.md:490-517` — a disabled TanStack v5 query reports `isLoading === false`.**
  Step 12's state order is written against this. Related, `:163-249`: an optional prop with a
  `= false` default disabled a whole feature in silence, twice — so `BlastRadiusCard` takes one
  required `prId` and no behaviour flags.
- **`mcp/INSIGHTS.md:43-54` — `mcp/` needs `NodeNext`**, and Vitest resolves a missing `.js`
  extension that `node dist/index.js` will not; build plus a launch is the only check.
- **Root `INSIGHTS.md:494` — a spec citing code by line number rots silently.** Every
  `path:line` above was read on 2026-08-09; re-verify one that looks wrong.

## Alternatives rejected

- **Reuse `contracts/brief.ts` `BlastRadius`.** It is the future `PrBrief` payload: no index
  status, no line numbers on callers. Without a line number the `file:line` link cannot open
  the right line, which is an acceptance criterion. Two contracts, related by a comment.
- **Cap callers globally rather than per symbol.** A global cap makes a PR touching five
  symbols show four callers each, and the constant is already named per-symbol.
- **Call `getBlastRadius` unconditionally and rely on it degrading.** The facade's fallback
  parses the clone on the request path (`service.ts:236-303`). Checking `getIndexState` first
  is what makes "no AST rebuild during the request" true rather than usually true.
- **Put the blast route in `modules/pulls/`.** `pulls/routes.ts` is already 420 lines with 16
  `container.db` calls (`onion-architecture` §5); this is a separable slice.
- **A new `blast` FeatureModelId.** Widens the shared `Settings` contract and the Settings
  screen for one paragraph; `risk_brief` is the same class of call.
- **A diff-only reviewer for the CLI.** The point of `POST /reviews/diff` is that it is the same
  `reviewPullRequest`; a second engine drifts from the PR one immediately.
- **Depth 3+ downstream.** Depth 2 is what the homework tests and what keeps the query bounded.

## Acceptance criteria

Items 1-8 map 1:1 onto the homework's criteria.

1. **A real PR with a description and a demo video.** The body explains the feature and links
   this spec; the video walks the card, the MCP tool and the CLI.
2. **The demo PR shows ≥2 real callers and ≥1 HTTP endpoint.** Target already verified:
   `Holubinka/dev-digest` is cloned and indexed (`repo_index_state.status = 'full'`), PR #12
   changes `server/src/modules/reviews/service.ts`, which declares `ReviewService` with real
   callers at `server/src/app.ts:83` and `server/src/modules/reviews/routes.ts:22`, and
   `reviews/routes.ts` declares 8 HTTP endpoints. Re-verify the counts before recording.
3. **Clicking a `file:line` opens that exact line on GitHub.** The `href` is
   `githubBlobUrl(repo_full_name, head_sha, file, line)`, ending `#L<line>`; pinned by the
   component test, checked once by hand.
4. **No AST parse or import-graph rebuild during the request.** `GET /pulls/:id/blast` reads
   Postgres only — `getIndexState` first, never the facade's clone-reading fallback. Pinned by
   the spy assertion in `blast-service.test.ts`.
5. **A clear empty state.** Symbols found with no callers renders `blast.noDownstream` with the
   symbol count — not a blank card, not an error.
6. **`partial` and `degraded` are a separate, visible state,** carrying the human-readable
   `reason`; an empty `symbols` array under a non-`full` status is never shown as "no impact".
7. **Zero LLM calls on the main path; exactly one for the summary.** Asserted in both
   directions on a spying fake in `blast-service.test.ts`.
8. **`get_blast_radius` returns a compact structured result over MCP** — real API call, narrow
   local schema, total sort, code-point truncation, a `note` when the index is not `full`.
   Verified against the built server, not only the test suite.
9. Beyond the homework's eight: **`devdigest review --mode working`** reviews the uncommitted
   tree through the same `reviewPullRequest`, prints `severity path:line`, persists nothing,
   and honours the 0/1/2 exit contract, with `staged` and `branch` exiting 2.

**End-to-end verification, once, at the end:** `./scripts/dev.sh`; open PR #12, read the card,
click a caller link and land on the right line, press Explain and get one paragraph naming only
listed symbols; call `get_blast_radius` on the same PR through the built MCP server; run
`devdigest review --mode working` in a dirty checkout. All three answer from the same API.

## Open questions

_None._

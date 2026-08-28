# Testing & CI strategy

DevDigest is five independent packages (no workspace), so testing is organised
as **one suite per package**, each with its own CI workflow, runner, and path
filter. A package's suite runs only when that package (or a package it depends
on at type-check time) changes.

## Philosophy — typological, not exhaustive

We do **not** chase line coverage. Each suite covers the *kinds* of things that
can break in that layer — one happy path plus the edge that actually matters per
workflow — and deliberately skips the rest. Concretely:

- **Test behaviour at the seams**, not implementation details. Routes, adapters,
  contracts, the review pipeline, the rendered component.
- **Mock the outside world.** LLMs, GitHub, and git are stubbed via
  `server/src/adapters/mocks.ts` so unit tests are hermetic and key-free.
- **One real integration per data-backed workflow**, against a real Postgres —
  not a mock DB — because the bugs there live in SQL, migrations, and wiring.
- **A few end-to-end browser flows** over the *main* user journeys, on seeded
  data, with no LLM in the loop.

If a test wouldn't catch a class of regression we care about, we don't write it.

## Suite map

| Suite | Package | Kind | Runner | Workflow | Docker? |
|-------|---------|------|--------|----------|---------|
| client | `client/` | component / unit (jsdom) | vitest | `client.yml` | no |
| server-unit | `server/` | unit (hermetic) | vitest | `server-unit.yml` | no |
| server-integration | `server/` | integration (real Postgres) | vitest | `server-integration.yml` | **yes** |
| reviewer-core | `reviewer-core/` | unit (engine) | vitest | `reviewer-core.yml` | no |
| e2e web | `e2e/` | browser e2e (deterministic) | agent-browser + `run.ts` | `e2e-web.yml` | yes (stack) |
| mcp | `mcp/` | unit (hermetic, stubbed `fetch`) | vitest | none — **run by hand** | no |
| shared-sync | `server/` + `client/` | consistency gate (not a test) | `diff -r` | `shared-sync.yml` | no |
| prompt-sync | `docs/agent-prompts/` + `server/` | consistency gate (not a test) | `scripts/prompt-sync.mjs` | `prompt-sync.yml` | no |
| pr-self-review | `scripts/pr-self-review/` | script tests (plain Bash) | `test/run.sh` | `pr-self-review.yml` | no |

## What each suite covers

**client** — components render and react to interaction (React Testing Library
+ jsdom). `fetch` is mocked; no API, DB, or browser. Covers the PR-review
surface (list, diff, findings, run controls) and the agent editor.

**server-unit** — the DB-free majority: adapters, prompt assembly, grounding,
repo-intel ranking & indexing, pricing, route smoke. The `typecheck` job also
runs on Windows, which doubles as the `@ast-grep/napi` prebuilt gate (install
fails there if the win32 prebuilt is missing).

**server-integration** — the `*.it.test.ts` files. Each starts a real Postgres
(pgvector) via testcontainers, builds the Fastify app, migrates + seeds, and
drives routes end-to-end: reviews + run lifecycle (incl. grounding), agents CRUD,
repo-intel symbol clamping, pulls comments, settings models. They self-skip when
Docker is unavailable.

**reviewer-core** — the pure engine: `toReview` selection, prompt construction,
and a `run` with a stubbed model → grounded findings. No DB / GitHub / FS.

**e2e web** — see `e2e/README.md`. Deterministic agent-browser flows over the
main journeys (boot → PR list → PR detail; agents) against a real seeded stack.
No `chat`, no model key.

**mcp** — hermetic vitest over the MCP server's pure parts: the projections and
their finding ordering, the resolvers, the error texts, the run-wait ceiling, and
each tool handler against a stubbed `fetch`. **No `*.it.test.ts`** — `mcp/` has no
database, so the suffix rule has nothing to select. **Nothing in `e2e/`** either:
that suite drives the web UI and MCP has no browser surface.

`run_agent_on_pr` is deliberately in **no suite**. It is the one tool that writes,
and a real run makes live provider calls that cost real money — an out-of-process
HTTP client cannot override the server's LLM the way an in-process test can
(`server/INSIGHTS.md` §"An integration test that starts a review makes LIVE
OpenRouter calls unless `secrets` is overridden"). It is exercised by hand, once,
against a running stack. `mcp/scripts/smoke.ts` covers the read-only tools the same
way — manual, no LLM cost.

There is **no `mcp.yml` workflow and no Track A gate**: `scripts/pr-self-review/scope.sh`
maps only `client/*`, `server/*` and `reviewer-core/*` into `.packages`
(`scope.sh:209-213`), so a change confined to `mcp/` triggers nothing. That is
deliberate for now — teaching the pre-push gate a fourth package means editing scripts
that have their own Bash suite. Until then, run `cd mcp && npm run typecheck && npm test`
by hand before pushing and paste the result into the PR body.

**shared-sync** — not a test suite but a consistency gate. `@devdigest/shared` is
vendored into both `server/` and `client/` instead of being a workspace package,
so each side type-checks against its own copy and nothing notices when the two
drift. The gate is a plain `diff -r` between them, path-filtered to run only when
a vendored copy changes. It fires on content changes and on added or deleted
files. `server/src/vendor/shared/` is the source of truth (`reviewer-core`
aliases it), but read the diff before overwriting — the copies have drifted in
both directions before.

**prompt-sync** — the same shape of gate for reviewer prompts. Each one exists
three times: the markdown in `docs/agent-prompts/`, a template literal in
`server/src/db/seed-prompts.ts` that `pnpm db:seed` upserts, and
`agents.system_prompt` in the database. A prompt improved in the doc and pushed
to a running agent but not mirrored into the seed constant is reverted the next
time anyone seeds — it survives until a fresh clone, then vanishes. The gate
compares the first two (`node scripts/prompt-sync.mjs`, no dependencies). It
cannot compare the third: CI has no database, so the DB copy stays a manual
`PUT /agents/:id`, which is also what versions the change into `agent_versions`.

**pr-self-review** — the six Bash scripts behind the pre-push gate (see the root
`README.md`): scope the branch, run the deterministic gates, filter against the
baseline, render the verdict, and refuse a push that has none. No Node, no pnpm,
no database. Every test builds its own throwaway git repo under `mktemp -d`, and
`run.sh` compares this repository's `HEAD` and branch list before and after as an
escape canary — it once escaped for real. `seam.test.sh` is the only one that runs
the whole chain end to end; the rest test one script each.

## Running locally

```sh
# per package
cd client        && pnpm test           # + pnpm typecheck
cd reviewer-core && npm test
cd mcp           && npm run typecheck && npm test   # no CI workflow — this is the gate

# server — the unit/integration split (see note below)
cd server && pnpm test:unit   # unit, no Docker
cd server && pnpm test:it     # integration, needs Docker — and runs the files SERIALLY
cd server && pnpm test                                          # both

# browser e2e (needs the full stack + agent-browser CLI)
./scripts/dev.sh
npm i -g agent-browser && agent-browser install
cd e2e && npm install && npm test

# the pre-push gate's own scripts (jq is the only dependency)
bash scripts/pr-self-review/test/run.sh
```

## Conventions

- **Integration tests end in `*.it.test.ts`.** The unit lane excludes that glob
  (`pnpm test:unit`); the integration lane selects only it (`pnpm test:it`).

  **The integration lane runs its files one at a time, and that is load-bearing.**
  There are 23 `*.it.test.ts` files and each starts its own Postgres container;
  in parallel they starve each other and the suite fails intermittently — three
  tests on one run, five on the next, one on the third, never the same names.
  Measured 2026-08-28: parallel failed on all three consecutive runs, serial
  passed 197/197 twice. `--no-file-parallelism` lives inside `pnpm test:it` so
  it cannot be forgotten; the unit lane keeps its parallelism, where it is worth
  5s against 19s. A DB-backed test that imports `test/helpers/pg.ts`
  must use the `.it.test.ts` suffix.
- **`server/package.json` may be held under `skip-worktree` locally** (a local variant
  diverges from the committed file). That is a per-clone git flag — it is not committed
  and a fresh clone will not have it (`git ls-files -v` shows no `S`). Either way, do
  not rely on committed `test:unit` / `test:integration` scripts existing: CI invokes
  the split with `pnpm exec vitest run …` directly.
- **Hermetic by default.** Reach for `src/adapters/mocks.ts` (MockLLMProvider,
  MockGitClient) rather than real network/keys.
- **E2E specs are deterministic batch JSON** (`e2e/specs/*.flow.json`) using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **CI is path-filtered per package.** Cross-package source aliases are encoded
  in each workflow's `paths:` (e.g. `reviewer-core/**` triggers `server-unit`
  because the server type-checks against `../reviewer-core/src`).
- **`server/clones/**` is runtime data** (git-ignored) and never collected by
  any suite.

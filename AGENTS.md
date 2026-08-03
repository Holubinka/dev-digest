# DevDigest

Local-first AI pull-request review. Course starter: import a PR, run an agent review on
it. Several standalone packages, **no monorepo workspace** — each owns its `package.json`
and lockfile.

## Stack

| Folder | Package | Stack | Port |
|---|---|---|---|
| `server/` | `@devdigest/api` | Fastify 5 · Drizzle 0.38 · Postgres 16 + pgvector · Zod 3 | 3001 |
| `client/` | `@devdigest/web` | Next.js 15 App Router · React 19 · TanStack Query 5 · Tailwind 4 | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure TS library — `openai` + `zod` only | — |
| `e2e/` | `@devdigest/e2e` | `agent-browser` (not Playwright) · declarative JSON flows | — |

Node ≥ 22 · Vitest 2 everywhere. Docker runs Postgres only; API and web run on the host.

## Commands

```sh
./scripts/dev.sh                # bootstrap from zero: Postgres, .env, deps, migrate, seed, dev servers
./scripts/e2e.sh                # hermetic e2e on isolated ports (5433/3101/3100) — local only, not CI

cd server && pnpm db:migrate    # REQUIRED after clone — the server does not migrate on boot
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit (hermetic)
cd server && pnpm exec vitest run .it.test                      # integration (testcontainers Postgres)

cd client && pnpm lint          # ESLint — client/ only; no other package has one
```

`server/` and `client/` use **pnpm**; `reviewer-core/` and `e2e/` use **npm**. Do not mix.

## A push is gated

`.claude/settings.json` registers `scripts/pr-self-review/gate.sh` as a `PreToolUse` hook, so in
Claude Code a Bash command containing `git push`, `gh pr create` or `gh pr ready` is **refused**
unless `.pr-self-review/latest.json` holds a fresh passing verdict for the current `HEAD` and
working tree. Only that hook enforces it; a push from your own terminal is untouched.

- **To get a verdict:** run `/pr-self-review` (the `pr-self-review` skill). `--gates` is seconds
  and is enough for a push; a PR needs a full run.
- **To bypass once:** `PR_SELF_REVIEW_SKIP=1 <command>`. It is recorded in the next report.
- **To turn it off:** delete the `PreToolUse` block from `.claude/settings.json`.

A Track A gate failure (arch, lint, typecheck, tests, vendor mirror, skills registry) stops both
the push and the PR. A critical found by a review subagent stops only the PR.

## Non-default conventions

- **Cross-package imports resolve to a sibling's TypeScript source** via tsconfig
  `paths` — not to `dist/`, not to a published package. `reviewer-core` never emits JS
  (its `build` is `tsc --noEmit`).
- **`@devdigest/shared` is vendored twice** — `server/src/vendor/shared/` and
  `client/src/vendor/shared/`. `reviewer-core` aliases the **server** copy, making it the
  de-facto source of truth. Type-checking cannot see the drift — each package compiles
  against its own copy — so the `shared-sync` CI gate compares them. After changing a
  contract, mirror it: `diff -r server/src/vendor/shared client/src/vendor/shared`.
- **Vitest configs duplicate the tsconfig aliases** (`resolve.alias`). Add a path in one
  and not the other, and tests break while typecheck still passes.
- **Fastify modules are registered by hand** in `server/src/modules/index.ts`, never
  autoloaded from the filesystem.
- **Secrets never pass through `process.env` or `AppConfig`.** They go through
  `SecretsProvider` (`~/.devdigest/secrets.json`, mode 0600). Do not add an API key to
  the env schema.
- **The DB schema is intentionally over-provisioned.** Tables for `eval`, `ci`, `skills`,
  `knowledge` and `context` exist and sit empty until later course lessons. An empty
  table is not a bug.

## Gotchas

- The API exits with `ERR_MODULE_NOT_FOUND` when `reviewer-core/node_modules` is missing —
  its raw source is imported at runtime. Install dependencies there too.
- `relation ... does not exist` on first run means migrations were never applied.
- Port 5434 is the Dockerized Postgres, published from 5432 inside the container;
  `scripts/e2e.sh` uses 5433 to stay out of its way.

## Do not touch

- `server/src/vendor/**`, `client/src/vendor/**` — vendored copies. Change the server
  copy first, then mirror deliberately.
- `server/clones/**` — runtime data from repo-intel cloning. Git-ignored, not a submodule.
- `e2e/specs/*.flow.json` — live browser-test scenarios, not documentation.
- `.claude/skills/*` named in `skills-lock.json` — pinned upstream copies. Skills absent
  from that lock, `engineering-insights` among them, are ours to edit.
- `CLAUDE.md` in any package — a symlink to that folder's `AGENTS.md`, the compatibility
  shim for Claude Code, which discovers only `CLAUDE.md`. Edit `AGENTS.md`; never replace
  the symlink with a regular file.

## Read when

- **Read `<module>/AGENTS.md` first** when working inside `server/`, `client/`,
  `reviewer-core/` or `e2e/`. Each holds conventions that apply only there, and
  auto-loading by location is not guaranteed in every editor.
- **Read `<module>/INSIGHTS.md`** before debugging in that module — it records failures
  that already cost someone time.
- **Run the `engineering-insights` skill** before reporting a substantial task complete —
  it appends what the session learned to that module's `INSIGHTS.md`.
- **Read `docs/architecture.md`** before changing how a review is produced end to end.
- **Read `server/README.md`** before adding or changing an HTTP route — it holds the API
  map and the module-registration contract.
- **Read `reviewer-core/README.md`** before touching prompt assembly, the LLM call, or
  the grounding gate.
- **Read `TESTING.md`** before adding a test or a CI workflow — it defines the
  unit/integration/e2e split and the `*.it.test.ts` rule.
- **Read `docs/agent-prompts/README.md`** before editing a built-in agent prompt — the DB
  is the source of truth, the files are the readable copy.

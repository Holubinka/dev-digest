# server/ — `@devdigest/api`

Fastify 5 + Drizzle over Postgres. Repo-wide rules live in the root `AGENTS.md`; this
file only covers what is specific to this package.

## Layering

`modules/<name>/routes.ts → service.ts → repository.ts`. Routes validate and delegate;
services hold logic and reach I/O only through the DI container
(`platform/container.ts`); repositories own the SQL. Do not query the DB from a route.

Every external dependency is an adapter in `adapters/` behind an interface. Tests use
`adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`) — never real network or keys.

## Conventions

- **Register new modules by hand** in `src/modules/index.ts`. Filesystem autoload is
  deliberately not used: dynamic `import()` of `.ts` is not portable across tsx, the
  bundler and vitest.
- **`vitest.config.ts` repeats the tsconfig path aliases.** Add a path to one and not
  the other and tests fail while `typecheck` passes.
- **`LOG_LEVEL` runs through `z.preprocess`** in `platform/config.ts`, which turns an
  empty string into `undefined`. `.env.example` ships `LOG_LEVEL=` empty, and an empty
  string is not a valid enum member.
- **Never widen the env schema to carry a secret.** `platform/config.ts` excludes every
  API key on purpose; they resolve through `SecretsProvider`.
- **Migrations do not run on boot.** `pnpm db:migrate` is a manual step, by design.

## Schema

`src/db/schema/*.ts`, one file per domain, aggregated by `src/db/schema.ts` for
drizzle-kit. Tables under `eval`, `ci`, `skills`, `knowledge` and `context` are
provisioned for later course lessons and are expected to be empty — do not "clean them
up". pgvector is enabled by migration `0000`; the `vector` column type comes from
`drizzle-orm/pg-core`, not from an npm package.

## Tests

`*.it.test.ts` means DB-backed (testcontainers Postgres); everything else must be
hermetic. A test that imports `test/helpers/pg.ts` must carry that suffix.

## Read when

- **Read `README.md`** before adding a route — it holds the API map and the request
  lifecycle.
- **Read `INSIGHTS.md`** before debugging anything here.
- **Read `../TESTING.md`** before adding a test or touching CI.
- **Read `../reviewer-core/AGENTS.md`** before changing anything the review engine
  consumes — its source is imported directly, so a change here can break it at runtime
  without any build step noticing.

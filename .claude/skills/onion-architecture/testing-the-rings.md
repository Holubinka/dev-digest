# Testing the rings

The reason to draw the rings at all: each one gets a cheaper test than the one outside it.
Pure core gets unit tests, the imperative shell gets integration tests, and the shell stays
thin so there is less of it to test the expensive way `[FC]`.

---

## 1. Which test for which ring

| Ring | Test | Needs | Where |
|---|---|---|---|
| Core | Call the function, assert the value | nothing | `test/<topic>.test.ts` |
| Ports | Nothing — an interface has no behaviour | — | — |
| Application (service) | Construct with a fake repository and mock adapters | nothing | `test/<module>-<case>.test.ts` |
| Application (repository) | Real Postgres | Docker | `test/<module>.it.test.ts` |
| Infrastructure (routes) | `app.inject()` through `buildApp({ overrides })` | Docker if it reads the DB | either |
| Infrastructure (adapters) | Test the real thing, or do not test it | varies | `test/adapters.test.ts` |

**The filename is the contract.** `*.it.test.ts` means DB-backed. A test that imports
`test/helpers/pg.ts` must carry the suffix, because the two lanes run as separate CI jobs:
`vitest run --exclude '**/*.it.test.ts'` (16 files, 108 tests, no Docker) and `vitest run
.it.test` (6 files, testcontainers Postgres).

## 2. The core is free to test

No setup, no fixtures, no doubles:

```ts
// test/pulls-status.test.ts — deriveReviewStatus takes `now` as a parameter,
// so there is no clock to mock.
expect(deriveReviewStatus(runs, now)).toBe('stale');
```

If a test of a "pure" function needs a mock, the function is not in the core ring. Move the I/O
out and pass the result in.

`reviewer-core` is entirely this. Its three test files stub `LLMProvider` and assert on values —
no server, no database, no key.

## 3. The service seam, and why three services have none

A service should be testable with a fake repository. Today only `repo-intel` is, and only by
force:

```ts
const svc = new RepoIntelService(container);
(svc as unknown as { repo: Record<string, unknown> }).repo = {
  getRepoBasics: async () => opts.basics ?? null,
  tryGetIndexState: async () => opts.indexStateRow ?? null,
};
```
— `test/repo-intel-facade-degraded.test.ts:33-39`

That works because `RepoIntelService` builds its own repository in its constructor, so the only
way in is to overwrite the private field afterwards. It is brittle: rename `repo` and the test
silently exercises the real repository against `db: {} as never`.

**`AgentsService`, `RepoService` and `ReviewService` have no hermetic tests at all** for the same
reason. They are reachable only through `*.it.test.ts` against real Postgres — the most expensive
test for logic that needs none.

The fix is one default parameter ([layering.md](layering.md) §3):

```ts
constructor(container: Container, repo = new AgentsRepository(container.db)) { … }
```

```ts
// Then, with no Docker and no database:
const svc = new AgentsService(fakeContainer, {
  list: async () => [agentRow({ name: 'reviewer' })],
} as unknown as AgentsRepository);

expect(await svc.list('ws-1')).toEqual([expect.objectContaining({ name: 'reviewer' })]);
```

Add the seam when you next touch one of these services. Do not add it as a standalone refactor
with no test behind it — a seam nothing uses is just a wider constructor.

## 4. Faking the outside

Adapters are substituted at the composition root, not by module mocking. `buildApp` takes
`{ config?, db?, overrides? }` and that is the whole test surface:

```ts
const app = await buildApp({
  config,
  overrides: { llm: { openrouter: new MockLLMProvider() }, git: new MockGitClient() },
});
const res = await app.inject({ method: 'GET', url: '/agents' });
```

No `vi.mock`. If you find yourself reaching for module mocking to replace an external call, the
call is not behind a port yet — go add one ([ports-and-adapters.md](ports-and-adapters.md) §3).

`test/routes-smoke.test.ts` runs the full app with **no database at all**, relying on
postgres-js connecting lazily. That works only for routes that never query.

## 5. Integration tests

Six exist. They drive real routes through `app.inject()` against real Postgres with real
migrations and `seed()`, mocking only the outside world. They self-skip when Docker is absent:

```ts
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```
— `test/reviews.it.test.ts:8-9`

Two things to know before writing one:

- `runReview` is fire-and-forget (`reviews/service.ts:133`), so assertions poll — use
  `waitForPrRuns` from `test/helpers/runs.ts` rather than a sleep.
- `platform/sse.ts:103` exports a module-level `runBus` singleton. Two `buildApp()` instances in
  the same process share run state, which matters when tests run in parallel.

Reserve these for what genuinely needs SQL: the repository, a migration, a constraint, a
transaction. A use case tested here that could have been tested in §3 costs a Docker pull on
every CI run.

## 6. What not to test

- **Ports.** An interface has no behaviour. Testing that a mock returns what you told it to
  returns nothing.
- **The container's wiring.** `container.git` returning a `SimpleGitClient` is a tautology; that
  it returns the *override* when one is given is already proven by every test that passes one.
- **Thin adapters.** `adapters/llm/openai.ts` is mostly an SDK call. Test the parsing helper it
  uses (`parseWithRepair`, in `reviewer-core`), not the HTTP round trip.

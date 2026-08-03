# Ports and adapters — the outside, inverted

A port is the shape the inside needs. An adapter is the technology that satisfies it `[H1]`.
The point is that the application can be "developed and tested in isolation from its eventual
run-time devices and databases" `[H1]` — not that you will ever swap Postgres.

---

## 1. Does this need a port?

| The dependency… | Port? |
|---|---|
| makes a network call | **Yes** |
| touches the filesystem or spawns a process | **Yes** |
| reads a secret | **Yes** — and it is `SecretsProvider`, which already exists |
| is non-deterministic (clock, randomness) | **Yes**, but as a parameter — see §6 |
| is Postgres, reached through Drizzle | **No** — the repository *is* the port |
| is a pure library (`zod`, `graphology`, `js-tiktoken`) | **No** — unless you need to fake it |

`js-tiktoken` gets a port (`Tokenizer`) despite being pure, because the fallback path
(`approxTokens`) is a second implementation. Two implementations is the real test, not purity.

## 2. Where the interface goes

**Answer this first: is the consumer a `service.ts` or a `*-executor.ts`?** If yes, the port
must go in `vendor/shared/adapters.ts` and the other two rows do not apply. Two gate rules close
them off, and **both count `import type`** — `tsPreCompilationDeps` is on and neither rule sets
`dependencyTypesNot`:

- port in `modules/<m>/types.ts` → the adapter must import it → `no-adapter-to-module`.
- port beside the adapter → the service must import it → `no-service-to-adapter-impl`.

`vendor/shared/adapters.ts` is the only file both an executor and an adapter may name. Verified
by probe, not by reading: a type-only import in each direction trips its rule.

| Used by | Interface lives in |
|---|---|
| a `service.ts` / `*-executor.ts` — **or** 2+ modules, or shared with the client | `vendor/shared/adapters.ts` |
| one module, consumed below the service layer | `modules/<m>/types.ts` |
| only its own adapter's callers, none of them a service | beside the adapter — `adapters/depgraph/index.ts` exports `DepGraph`, `adapters/tokenizer/index.ts` exports `Tokenizer` |

`DepGraph` gets to sit beside its adapter only because its consumers are
`modules/repo-intel/pipeline/*.ts`, not a service or an executor.

`vendor/shared/adapters.ts` states the contract in its header: *"ALL external calls go behind
these interfaces … Services depend on the interface, not the impl."* It currently holds
`LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider` and
`SecretsProvider`.

**`vendor/shared/` is vendored twice.** Change `server/src/vendor/shared/` first, then mirror to
`client/src/vendor/shared/`; the `shared-sync` CI gate runs `diff -r`. Type-checking cannot see
the drift, because each package compiles against its own copy.

## 3. The three obligations of a new port

A port is not finished until all three are done.

**1 — The interface, in terms of the domain.** Ask for what you need, not for how it is
fetched: `readFile(repo, path)`, not `exec(cmd)`. Nothing driver-shaped may appear in the
signature — no query builders, no `Response`, no SDK error types `[E4]`.

**2 — A mock in `adapters/mocks.ts`.** Seven exist: `MockLLMProvider`, `MockEmbedder`,
`MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockAuthProvider`,
`MockSecretsProvider`. Tests reach them through `buildApp({ overrides })` — never real network,
never real keys.

**3 — A slot on the container.** A getter for a synchronous dependency, an async method when a
secret must be resolved first, and an override that always wins:

```ts
get git(): GitClient {
  if (this.overrides.git) return this.overrides.git;
  this._git ??= new SimpleGitClient(this.config.cloneDir);
  return this._git;
}
```

Overrides-first is what makes `buildApp({ overrides: { git: new MockGitClient() } })` work.

## 4. Secrets

Only `SecretsProvider` `[C1]`. Never `AppConfig`, never `process.env` — `platform/config.ts`
excludes every API key deliberately, and widening the env schema to carry one is the single
most-repeated mistake in this codebase.

The resolution happens in the container, at construction time, and fails loudly:

```ts
const key = await this.secrets.get('OPENROUTER_API_KEY');
if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
return new OpenRouterProvider(key, {
  estimateCost: (model, tokensIn, tokensOut) =>
    this.priceBook.estimate(model, tokensIn, tokensOut),
});
```
— `platform/container.ts:181-189`

Two things to copy from those four lines: the secret never reaches the adapter's caller, and
`estimateCost` is **injected as a callback** so `OpenRouterProvider` holds no pricing table.
That is the pattern for anything the core needs but must not own.

`set?` on `SecretsProvider` is optional on purpose — a read-only backend may omit it, and
`settings/routes.ts:80-82` branches on its presence. After writing a key, call
`container.invalidateSecretCaches()`; providers are cached by construction.

## 5. Degraded contracts

An optional enrichment must never take the request down. `modules/repo-intel/types.ts:15-22`
sets the rule for the whole codebase:

- Object-returning methods carry an inline `degraded?: boolean` (plus an optional `reason`).
- Array-returning methods return `[]` when degraded — empty already means "no enrichment" to
  every consumer.

No `{ degraded, data }` wrappers; call sites stay natural. `adapters/depgraph/index.ts` takes
this to its conclusion: one try/catch around the whole cruise, returning `[]` on any failure,
so a broken tsconfig in a user repo degrades the ranking instead of failing the index.

Decide per port whether failure is degradation or an error. An LLM key that is missing is a
`ConfigError`; a dependency graph that would not build is `[]`.

## 6. Clock, randomness, logging

No global ports for these. The established patterns, in order of preference:

1. **Take it as a parameter.** `deriveReviewStatus(…, now: number)` in `pulls/status.ts:127`.
   Cleanest — the function stays pure and testable with no injection machinery.
2. **A constructor default.** `PriceBook` takes `private now: () => number = () => Date.now()`
   (`platform/price-book.ts:30`).
3. **A structural type, not an interface import.** `run-executor.ts:21-26` declares its own
   four-method `Logger` shape; the route passes `req.log`. The executor never names Fastify or
   pino, so it stays callable from a job.

Elsewhere `Date.now()` is called directly. That is acceptable where the value is not asserted on
— but if a test needs to control time, use pattern 1 rather than mocking globals.

## 7. Adapters point outward only

An adapter implements a port and knows nothing about features. Today two of them break this:
`adapters/astgrep/index.ts:25` and `adapters/depgraph/index.ts:20` both import `SUPPORTED_EXT`
from `modules/repo-intel/constants.ts`, and `adapters/auth/local.ts:5` imports from
`db/seed.ts`. All three are in the gate's baseline.

When an adapter needs a constant, the constant is in the wrong place. Move it beside the
adapter, or onto the port.

`adapters/git/simple-git.ts:33-34` also writes to `process.env` from a constructor path so git
subprocesses inherit `GIT_TERMINAL_PROMPT=0`. Mutating global process state from an adapter is a
real cost — it is done once, deliberately, and should not be copied.

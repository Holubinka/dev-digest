---
name: onion-architecture
description: "Decides which ring backend code belongs in and which direction it may point. Use when adding or changing a Fastify route, service, repository or adapter under server/, choosing between routes.ts / service.ts / repository.ts / helpers.ts, introducing a port for a new external dependency, wiring something into platform/container.ts, touching reviewer-core, or when `pnpm arch` fails. Covers layering, ports and adapters, the composition root, and which test each ring gets."
metadata:
  version: "1.0.0"
  tags: onion-architecture, hexagonal, ports-and-adapters, fastify, drizzle, layering, dependency-rule, composition-root, backend
---

# Onion Architecture — which ring, and which way it points

Placement and dependency direction for `server/` and `reviewer-core/`.

**One rule generates the rest: dependencies point inward, never outward** `[C1][O1]`. Every
rule below is that rule applied to a specific arrow. When a rule and the direction seem to
disagree, the direction wins and the rule is wrong.

This is enforced, not advised. `server/.dependency-cruiser.cjs` fails CI on a new violation.

## Navigation

| Read | For |
|---|---|
| **This file** | The rings, the four-step procedure, what to do when the gate fails, red flags, the review checklist |
| [layering.md](layering.md) | What goes in `routes.ts` / `service.ts` / `repository.ts` / `helpers.ts`, DTO mapping, when a service splits into an executor |
| [ports-and-adapters.md](ports-and-adapters.md) | When a dependency needs a port, where the interface lives, the mock obligation, degraded contracts, secrets |
| [testing-the-rings.md](testing-the-rings.md) | Which ring gets which test, the constructor seam, the `*.it.test.ts` rule |
| [README.md](README.md) | Scope, related skills, all 38 sources, changelog, how this skill was tested |

The gate documents itself: `server/.dependency-cruiser.cjs` carries the twelve rules, each with
a `comment` that dependency-cruiser prints alongside the violation. Read it there, not here.

Source tags (`[C1]`, `[H1]`, …) resolve in [README.md](README.md) §5.

---

## 1. The rings

Same folders you already have, named. Nothing moves.

| Ring | Holds | Lives in |
|---|---|---|
| **Core** — pure | Review engine, contracts, pure transforms. No I/O, no framework, no clock. | `reviewer-core/src/**`, `vendor/shared/contracts/**`, `modules/*/helpers.ts`, `modules/*/status.ts`, `repo-intel/pipeline/rank.ts`, `platform/resilience.ts` |
| **Ports** — interfaces | What the inside needs from the outside, expressed as a type. | `vendor/shared/adapters.ts`, `modules/repo-intel/types.ts`, the local `DepGraph` / `Tokenizer` interfaces |
| **Application** — use cases | Orchestration and SQL. Knows ports, never implementations. | `modules/*/service.ts`, `modules/*/*-executor.ts`, `modules/*/repository.ts` |
| **Infrastructure** — edges | Driving (HTTP) and driven (LLM, git, GitHub, Postgres) adapters. | `modules/*/routes.ts`, `adapters/**`, `db/**` |
| **Composition root** | Wiring. Outside the rings on purpose — the one place allowed to name every concrete type `[S1]`. | `platform/container.ts`, `app.ts`, `modules/index.ts` |

`platform/container.ts` importing `modules/` is **not** a violation to fix. A composition root
is *defined* as the single place that knows the concrete graph `[S1]`. Everywhere else, reaching
for the container to fetch a dependency is the Service Locator anti-pattern.

Modules are vertical slices; the rings live *inside* each slice. That hybrid is deliberate —
see §6.

## 2. The four-step procedure

Run in order for any "where does this go" question. Stop when the answer is determined.

**1 — Name the kind of code.** HTTP shape · use case · SQL · pure transform · external call ·
wiring · constant. If you cannot name it, it is not ready to be placed.

**2 — Find its ring.**

| The code… | Ring | File |
|---|---|---|
| reads `req`, sets a status code, declares a Zod `schema` | Infrastructure | `modules/<m>/routes.ts` |
| orchestrates a use case, applies policy, maps rows → DTOs | Application | `modules/<m>/service.ts` |
| is a long or background use case pulled out of a fat service | Application | `modules/<m>/<verb>-executor.ts` |
| is Drizzle | Application | `modules/<m>/repository.ts` |
| transforms values and calls nothing | Core | `modules/<m>/helpers.ts` |
| talks to a network, a disk or a subprocess | Infrastructure | `adapters/<port>/<impl>.ts` |
| is the *shape* of that external thing | Ports | `vendor/shared/adapters.ts` (2+ users) or `modules/<m>/types.ts` (1 user) |
| decides which implementation is used | Composition root | `platform/container.ts` |
| is reusable by the CI runner with no server present | Core | `reviewer-core/src/` |

**3 — Check the arrow points inward.** Outer may call any inner, directly, without a proxy
method `[G1]`. Inner may never name outer. If your import goes the wrong way, the thing you
need is in the wrong ring — move the thing, do not add the import.

**4 — Run the gate.** `cd server && pnpm arch`. It is faster than reasoning about it.
`pnpm arch:strict` adds the frozen backlog; the rule's own `comment` explains why it exists.

**When it fails, escalate in this order — stop at the first that works:**

1. **Move the code.** Nine times in ten the rule is right and the file is in the wrong ring.
   Check the baseline first (`pnpm arch:strict`): if the same edge is already frozen from
   another file, the thing you are importing has no home, and giving it one clears both.
2. **Narrow the rule**, in `pathNot`, with the reason in its `comment`. Only when a whole
   category is legitimately exempt — the bar is "the rule is wrong", not "the rule is
   inconvenient".
3. **Baseline it**, deliberately, only for something you intend to fix and only with a note
   saying what would fix it.

There is no inline-ignore comment, on purpose. `pnpm arch:baseline` re-freezes the **whole**
file, so run it only when a refactor has *removed* entries: check `arch:strict` reports fewer
than before, then read the diff to confirm nothing was added. Regenerating to silence a new
violation is the one thing this gate cannot survive.

## 3. The rules

1. **A route validates, resolves tenancy, delegates, and maps `undefined` → `NotFoundError`.**
   Nothing else. `modules/agents/routes.ts:70-82` is the reference. Declare `schema.body`; do
   not hand-roll `Schema.parse(req.body)` — `server/README.md` forbids it and
   `reviews/routes.ts:32` is the one place still doing it.
2. **A repository takes `Db`, returns rows, and holds nothing but Drizzle.** Never `Container`
   — `agents/repository.ts:52` is `constructor(private db: Db) {}`. Past ~200 lines, split by
   aggregate into `repository/<aggregate>.repo.ts` free functions behind the class
   (`reviews/repository.ts:21-32`).
3. **A service depends on ports, and gets its repository as a parameter.** New services take
   `constructor(container: Container, repo = new XRepository(container.db))`. The default keeps
   call sites unchanged; the parameter is what makes the service testable `[S1]`. Every existing
   service builds its own repository, which is exactly why three of them have no unit tests —
   see [testing-the-rings.md](testing-the-rings.md).
4. **Every external call goes behind a port** `[H1]`. A port is not finished until
   `adapters/mocks.ts` has an implementation of it.
5. **Data crossing a ring boundary is a plain structure** `[C1]`. A `*Row` never leaves its
   module; map to a DTO in `helpers.ts`. Mapping inline in a route
   (`pulls/routes.ts:223-253`) is a violation.
6. **Parse once, at the edge** `[PK]`. `vendor/shared/contracts/**` is the boundary. Inside a
   service the value is already the parsed type — do not re-validate it.
7. **Secrets reach code only through `SecretsProvider`.** Never `AppConfig`, never
   `process.env`.
8. **`reviewer-core` is the functional core** `[FC]`. Two runtime deps, `openai` and `zod`.
   Anything else arrives as a parameter or a callback — `estimateCost` is the pattern to copy.

## 4. Boundary with the sibling skills

Split by **question asked**, not by technology.

| Skill | Answers | Owns |
|---|---|---|
| **onion-architecture** (this) | *Which ring, and which way does it point?* | placement, layering, ports, the composition root, the gate |
| `fastify-best-practices` | *How does the framework do it?* | hooks, plugin registration, serialization, rate limits |
| `drizzle-orm-patterns` | *How do I write this query?* | schema, relations, transactions, migrations |
| `postgresql-table-design` | *How should the table look?* | types, indexes, constraints |

Do not load this skill for "why is this query slow", "how do I add a hook", or "write this
migration".

## 5. Red flags

Stop when you catch yourself writing any of these.

| Red flag | Rule broken |
|---|---|
| "It's a two-line query, I'll do it in the handler" | 1 — `pulls/routes.ts` began exactly here and is now 420 lines with 16 `container.db` calls |
| "The service can just take the container" | 3 — then the repository has no seam, and the only way to fake it is monkey-patching a private field |
| "I'll import `SimpleGitClient` here, it's simpler" | 4 — the service now needs real git to run |
| "I'll return the row, the route can map it" | 5 — a `*Row` in a route couples HTTP to the schema |
| "`repo-intel` already has that constant, I'll import it" | §1 — cross-slice import; move it to `_shared/` or a port |
| "The adapter needs `SUPPORTED_EXT` from the module" | §1 — the constant belongs beside the adapter, not in a feature |
| "I'll re-parse the body in the service to be safe" | 6 — it is already parsed; a second parse hides where the contract lives |
| "`node:fs` is fine here, it's just a read" | 4 — `GitClient.readFile` exists |
| "The container imports modules, that's a cycle, I'll fix it" | §1 — it is the composition root; leave it |
| "I'll regenerate the baseline to get CI green" | §2 — the baseline only shrinks |

## 6. What this costs, honestly

Onion is not free and this skill does not pretend otherwise. Bogard moved his team off it
because services grow into a big ball of mud regardless of how many layers guard them `[V1]`.
Domain-Driven Hexagon warns that most projects never swap databases, so a repository justified
by swappability is dead weight `[R1][V4]`.

The position taken here: the repository earns its place by **isolating SQL and giving tests a
seam**, not by promising portability. DevDigest is already vertical slices with rings inside
each slice `[V2]` — that hybrid is the design, not a compromise on the way to something purer.
Do not introduce `domain/`, `application/` and `infrastructure/` folders; the rings are named
where the code already sits.

## 7. Review checklist

- [ ] No Drizzle outside a `repository.ts` (§3.2)
- [ ] No `container.db` in a route (§3.1)
- [ ] The service takes its repository as a parameter (§3.3)
- [ ] Every new external call has a port **and** a mock in `adapters/mocks.ts` (§3.4)
- [ ] No `*Row` type crosses out of its module (§3.5)
- [ ] No import from another `modules/<slice>/` (§1)
- [ ] Nothing in `adapters/` imports `modules/` (§1)
- [ ] `reviewer-core` still imports only `openai` and `zod` (§3.8)
- [ ] No secret in `AppConfig` or `process.env` (§3.7)
- [ ] `cd server && pnpm arch` exits 0, and the baseline did not grow

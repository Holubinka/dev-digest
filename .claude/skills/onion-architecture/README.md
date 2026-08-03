# Onion Architecture Skill

The skill card: what this skill is for, what it deliberately leaves to others, where every rule
came from, and how it was tested.

## Contents

1. [Focus](#1-focus)
2. [File map](#2-file-map)
3. [What it covers, and what it does not](#3-what-it-covers-and-what-it-does-not)
4. [Cases it is built for](#4-cases-it-is-built-for)
5. [Sources](#5-sources)
6. [Related skills, and who owns what](#6-related-skills-and-who-owns-what)
7. [Conflicts this skill resolves](#7-conflicts-this-skill-resolves)
8. [Version and changelog](#8-version-and-changelog)
9. [How this skill was tested](#9-how-this-skill-was-tested)

## 1. Focus

Which ring a piece of backend code belongs in, and which direction it is allowed to point.
Scope is `server/` and `reviewer-core/`.

The skill exists because `server/AGENTS.md` had already stated the layering in three lines —
`routes.ts → service.ts → repository.ts`, "Do not query the DB from a route" — and nothing
measured it. When the gate was first run, it found **20 violations**, including four modules
with no service and no repository at all.

So this skill ships with teeth: `server/.dependency-cruiser.cjs` and a CI job. The prose
explains the rules; the gate is what actually holds the line.

## 2. File map

| File | Lines | Answers |
|---|---|---|
| `SKILL.md` | 181 | Which ring? Which way does the arrow point? The gate failed — now what? What do I check before I commit? |
| `layering.md` | 216 | What goes in `routes.ts` / `service.ts` / `repository.ts` / `helpers.ts`? Where do I map rows to DTOs? When does a service split? |
| `ports-and-adapters.md` | 149 | Does this dependency need a port? Where does the interface live? What else must I write? |
| `testing-the-rings.md` | 129 | Which test does this ring get? Why can't I unit-test this service? |

`SKILL.md` stays thin because it loads in full whenever the skill activates. The topic files
load only when the question needs them.

**There is no `enforcement.md`.** It was cut after the baseline (§9) showed an agent
reconstructing nearly all of it from `server/.dependency-cruiser.cjs` unaided. The gate
documents itself — twelve rules, each with a `comment` that dependency-cruiser prints alongside
the violation. The one part that demonstrably changed an answer, the escalation order when the
gate fails, moved into `SKILL.md` §2.

## 3. What it covers, and what it does not

| Covered here | Not covered — go here instead |
|---|---|
| Which file/ring a piece of code belongs in | How to write the Fastify route itself → `fastify-best-practices` |
| Whether a dependency needs a port | How to write the Drizzle query → `drizzle-orm-patterns` |
| Where the interface and its mock live | How the table should be shaped → `postgresql-table-design` |
| Dependency direction, and the gate that enforces it | Zod schema authoring → `zod` |
| Which ring gets which kind of test | How to write the test → `TESTING.md` |
| The composition root and DI wiring | Frontend placement → `frontend-architecture` |

## 4. Cases it is built for

- "Add an endpoint that returns X" — where do the pieces go?
- "We need to call \<external service\>" — port, adapter, mock, container slot.
- "This service is getting long" — split into what, and where?
- "Write a unit test for this service" — and discovering there is no seam.
- "`pnpm arch` is failing on my branch" — what the rule means and what to do about it.
- "Should this go in `platform/` or `modules/`?"

It should **not** load for: query performance, a migration, a Fastify hook, an HTTP status-code
question, or anything in `client/`.

## 5. Sources

Every link below was fetched and read while writing the skill (2026-08-01). The "What we take
from it" column records the specific claim used, so any rule can be traced back without
re-reading the source. Tags (`[C1]`, `[H1]`, …) are the ones cited across `SKILL.md` and the four
topic files.

**Tier 1** — primary or authoritative (the author of the idea, or official tool docs).
**Tier 2** — well-known practitioner, widely cited.
**Tier 3** — supporting; used for framing, never as the sole basis for a rule.

### O. Onion Architecture, from the source

| # | Source | Tier | What we take from it |
|---|---|---|---|
| O1 | [Jeffrey Palermo — The Onion Architecture: part 1 (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) | 1 | The rule verbatim: "All code can depend on layers more central, but code cannot depend on layers further out from the core." Also "The database is not the center. It is external", and the honest caveat that this is "not appropriate for small websites" — which is why §6 of `SKILL.md` exists. |
| O2 | [part 2 — the layers](https://jeffreypalermo.com/blog/the-onion-architecture-part-2/) | 1 | Repository *interfaces* belong in the core, implementations outside. Shapes the "the repository is the port for Postgres" position. |
| O3 | [part 3 — wiring](https://jeffreypalermo.com/blog/the-onion-architecture-part-3/) | 1 | IoC happens at the outer edge, not inside the layers. |
| O4 | [part 4 — after four years](https://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/) | 1 | The author's own retrospective; used as a check against over-claiming. |
| O5 | [Palermo — onion-architecture tag index](https://jeffreypalermo.com/tag/onion-architecture/) | 1 | Series index. |

### C. Clean and hexagonal — the sibling formulations

| # | Source | Tier | What we take from it |
|---|---|---|---|
| C1 | [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) | 1 | The Dependency Rule: "Source code dependencies can only point inwards. Nothing in an inner circle can know anything at all about something in an outer circle." Also the rule that data crossing a boundary must be a simple isolated structure, never an entity or a database row → `SKILL.md` §3.5, the "no `*Row` leaves its module" rule. |
| H1 | [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) | 1 | Port vs adapter; driving/primary vs driven/secondary. The intent statement — "developed and tested in isolation from its eventual run-time devices and databases" — is the justification used for ports throughout, rather than technology-swapping. |
| G1 | [Herberto Graça — Onion Architecture](https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85) | 2 | Onion = Ports & Adapters plus internal layers. Crucially: an outer layer may call **any** inner layer directly, no proxy methods — which is why a route calling a pure helper without going through the service is fine. |
| E3 | [Wikipedia — Hexagonal architecture](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)) | 3 | Neutral vocabulary check for port / adapter / driving / driven. |
| E8 | [dyarleniber — Hexagonal and Clean Architecture, with examples](https://dev.to/dyarleniber/hexagonal-architecture-and-clean-architecture-with-examples-48oi) | 3 | Reconciles the three vocabularies; used to pick one set of names and stick to it. |
| E7 | [Bitloops — Onion Architecture](https://bitloops.com/docs/bitloops-language/learning/software-architecture/onion-architecture) | 3 | Layer-naming cross-check. |

### S. Composition root and dependency injection

| # | Source | Tier | What we take from it |
|---|---|---|---|
| S1 | [Mark Seemann — Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) | 1 | "A (preferably) unique location in an application where modules are composed together", one per application, at the entry point. Service Locator is acceptable *only* inside it. This is the whole justification for `platform/container.ts` importing `modules/` not being a cycle to fix, and for `SKILL.md` §3.3's constructor seam. |
| S2 | [Mark Seemann — Pure DI (via InfoQ interview)](https://www.infoq.com/articles/DI-Mark-Seemann/) | 2 | A DI container is optional infrastructure; once composition is isolated in the root, container-or-not stops being an architectural commitment. Backs the hand-written `Container` over adopting Awilix/InversifyJS. |
| R4 | [Remo Jansen — SOLID and the onion architecture in Node.js with TypeScript and InversifyJS](http://blog.wolksoftware.com/implementing-solid-and-the-onion-architecture-in-node-js-with-typescript-and-inversifyjs) | 2 | The canonical Node/TS treatment. Read as the case *for* a DI framework; rejected here per S2 — decorators and a container library would be more machinery than 219 lines of `container.ts`. |

### F. Functional core, and parsing at the edge

| # | Source | Tier | What we take from it |
|---|---|---|---|
| FC | [Gary Bernhardt — Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) | 1 | Pure core gets unit tests; the imperative shell gets integration tests and is kept thin so there is less of it. The organising idea behind `testing-the-rings.md` and behind treating `reviewer-core` as the core rather than as "a library we happen to have". |
| PK | [Alexis King — Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) | 1 | "Get your data into the most precise representation you need as quickly as you can. Ideally, this should happen at the boundary of your system, before any of the data is acted upon." → `SKILL.md` §3.6: parse once, at the edge, never re-validate inside a service. |

### D. Enforcement tooling

| # | Source | Tier | What we take from it |
|---|---|---|---|
| FF | [Neal Ford, Rebecca Parsons, Patrick Kua — Building Evolutionary Architectures](https://nealford.com/books/buildingevolutionaryarchitectures.html) | 1 | "Architectural fitness function": an objective integrity assessment of an architectural characteristic, automated in the deployment pipeline. The reason the gate exists rather than a longer document. |
| D1 | [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | 1 | `from`/`to`, `path`/`pathNot`, `severity`, `dependencyTypes`; the `$1` capture-group backreference that expresses "module A may not import module B". Note `$1`, not a regex `\1` — getting this wrong flags every same-module import. |
| D2 | [dependency-cruiser — CLI](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md) | 1 | `depcruise-baseline` writes `.dependency-cruiser-known-violations.json`; `depcruise --ignore-known` consumes it. Both verified against the installed v17.4.3 CLI. |
| D3 | [dependency-cruiser — options reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) | 1 | `doNotFollow` vs `exclude` (the former keeps the edge, the latter deletes it), `tsConfig` for path-alias resolution, `tsPreCompilationDeps` for `import type` edges. All three are load-bearing; the reasoning is in the `options` block of `server/.dependency-cruiser.cjs`. |
| E1 | [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) | 2 | The rejected alternative: better in-editor feedback, but the repo has no ESLint at all, so adopting it means adopting a linter first. |
| E2 | [Xebia — Taking frontend architecture seriously with dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) | 2 | Practical config ergonomics, and the "a linter is instant, a cruiser is CI" division of labour. |

### R. Reference implementations in this stack

| # | Source | Tier | What we take from it |
|---|---|---|---|
| R1 | [Sairyss — Domain-Driven Hexagon](https://github.com/Sairyss/domain-driven-hexagon) | 2 | "In Application Core dependencies point inwards." Modules organised as vertical slices. Its explicit warning against over-abstracting the repository — "most projects never change database technology" — is what keeps `SKILL.md` §3.2 modest, and is quoted in §6. |
| R2 | [marcoturi — fastify-boilerplate](https://github.com/marcoturi/fastify-boilerplate) | 2 | The closest prior art: Fastify 5 + clean architecture + DDD + vertical slices, with layering enforced by **dependency-cruiser** (`.dependency-cruiser.cjs`, a `deps:validate` script). Direct precedent for the gate. |
| R3 | [goldbergyoni — Node.js Best Practices §1](https://github.com/goldbergyoni/nodebestpractices) | 2 | 1.1 "Structure your solution by business components"; 1.2 "Layer your components with 3-tiers, keep the web layer within its boundaries". Its entry-points / domain / data-access split maps exactly onto routes / service / repository. |
| R5 | [borjatur — clean-architecture-fastify-mongodb](https://github.com/borjatur/clean-architecture-fastify-mongodb) | 3 | A second Fastify core/infrastructure split, used to compare folder naming. |
| R6 | [Melzar — onion-architecture-boilerplate (Node + TS)](https://github.com/Melzar/onion-architecture-boilerplate) | 3 | OOP-variant layer naming reference. |

### V. The counterargument

Kept because a skill that only cites its own side is advocacy, not guidance. These shape
`SKILL.md` §6.

| # | Source | Tier | What we take from it |
|---|---|---|---|
| V1 | [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) | 2 | His team started on onion and moved off it: business logic went into services and data access into repositories, and the services "still got big and nasty" — layers alone do not prevent a big ball of mud. |
| V2 | [CSA — Architectures in comparison: Onion or Vertical Slice?](https://www.csa.ch/en/blog/architectures-in-comparison-onion-or-vertical-slice) | 2 | Side-by-side trade-offs. Supports the hybrid this repo actually uses: slices outside, rings inside. |
| V3 | [Rico Fritzsche — Why vertical slices won't evolve from clean architecture](https://ricofritzsche.me/why-vertical-slices-wont-evolve-from-clean-architecture/) | 2 | The two are not a migration path — which is why the hybrid is stated explicitly instead of drifting between them. |
| V4 | [codewithmukesh — Repository Pattern: do you really need it?](https://codewithmukesh.com/blog/repository-pattern-do-you-really-need-it/) | 2 | When a repository over an ORM is dead weight. Argues §3.2 down from "database swappability" to "SQL isolation plus a test seam". |
| E6 | [Onion Architecture in TypeScript — a practical guide with tradeoffs](https://dev.to/cheru94/onion-architecture-in-aws-lambdas-with-typescript-a-practical-guide-with-tradeoffs-29h3) | 3 | Honest cost accounting for small services. |

### T. Stack documentation

| # | Source | Tier | What we take from it |
|---|---|---|---|
| F1 | [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) | 1 | Child contexts inherit from parents and never the reverse; decorators and hooks are scoped. Why `app.decorate('container', …)` must happen at the root before the module loop. |
| F2 | [Fastify — Plugins guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) | 1 | Encapsulation "will completely avoid cross dependencies and will help you structure your code into cohesive blocks"; `fastify-plugin` is the deliberate escape hatch. Supports one-plugin-per-module registration. |
| F3 | [Fastify — Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) | 1 | Sharing the container via `decorate`, and the `declare module 'fastify'` augmentation that types it. |
| DZ1 | [Drizzle — Transactions](https://orm.drizzle.team/docs/transactions) | 1 | `tx` is a `Db`-shaped client supporting the full query surface, so a repository method can take `db: Db \| Tx = this.db` and several repositories can share one transaction. The basis for `layering.md` §5. |
| E4 | [Paul Serban — Drizzle ORM best practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) | 2 | Do not leak query builders or driver error types past the repository; translate to domain errors at the boundary. Maps onto `platform/errors.ts`. |
| E5 | [Repository pattern with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) | 3 | Concrete Drizzle repository shape. |

### Skill-authoring sources

- [Agent Skills specification](https://agentskills.io/specification) — the six allowed
  frontmatter keys; `name` must match the directory; no top-level `version`.
- [Anthropic — Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  — keep `SKILL.md` under 500 lines, keep file references one level deep.
- `.claude/skills/README.md` §"Creating New Skills" — the house layout, and the
  measure-the-baseline-before-shipping rule.
- `.claude/skills/frontend-architecture/` — the reference implementation this skill mirrors.

## 6. Related skills, and who owns what

| Skill | Answers | Owns |
|---|---|---|
| **onion-architecture** (this) | *Which ring, and which way does it point?* | Placement, layering, ports, the composition root, the gate |
| `fastify-best-practices` | *How does the framework do it?* | Hooks, plugin registration, serialization, rate limiting, the request lifecycle |
| `drizzle-orm-patterns` | *How do I write this query?* | Schema definition, relations, transactions, migrations |
| `postgresql-table-design` | *How should the table look?* | Types, indexes, constraints, performance |
| `zod` | *How do I write this schema?* | Validation, parsing, error handling, inference |
| `frontend-architecture` | *Where does frontend code go?* | The same question, `client/` side |

The overlap worth naming: `drizzle-orm-patterns` will happily show you a query inside a route
handler, because it is a general Drizzle skill with no opinion about this repo. This skill
overrides that — the query goes in a repository.

`fastify-best-practices` is a locked upstream copy (listed in `skills-lock.json`) and was
deliberately **not** edited to cross-link here.

## 7. Conflicts this skill resolves

1. **"Do not query the DB from a route" vs four modules that do.** `server/AGENTS.md` stated
   the rule; `pulls`, `polling`, `settings` and `workspace` ignore it. → The rule stands; the
   four are frozen in the baseline as a backlog, and `server/AGENTS.md` now points here instead
   of restating a rule it could not enforce.

2. **`platform/container.ts` imports `modules/`, which looks like a layering violation.**
   → It is the composition root `[S1]`, definitionally the one place that names concrete types.
   Stated explicitly in `SKILL.md` §1 and in the `no-circular` rule's comment, because the
   alternative is someone "fixing" it.

3. **Onion says layers; this repo is vertical slices.** → Both. Slices at the top level
   (`modules/<feature>/`), rings inside each slice. Named as a deliberate hybrid `[V2][V3]`
   rather than letting the codebase drift between the two.

4. **A repository is often dead weight over an ORM `[V4][R1]`.** → Accepted. The justification
   here is SQL isolation and a test seam, not database portability. That is why `SKILL.md` §3.2
   is about *what a repository may contain* rather than about abstracting Drizzle away.

5. **Every service takes the whole `Container`, which is Service Locator `[S1]`.** → Not
   retro-fixed. New services add one default parameter for the repository; the container stays
   as the way to reach adapters, because rewriting eight services with no test behind the change
   would be churn.

## 8. Version and changelog

### 1.0.0 — 2026-08-01

**Added**
- `SKILL.md`, four topic files, this card.
- `server/.dependency-cruiser.cjs` — twelve rules, `severity: error`.
- `.dependency-cruiser-known-violations.json` — 20 frozen violations.
- `server/package.json` scripts `arch`, `arch:strict`, `arch:baseline`.
- `.github/workflows/server-arch.yml`.

**Corrected during authoring** (both were green-but-meaningless configs)
- `exclude: node_modules` → `doNotFollow`. `exclude` deletes the module *and every edge to it*,
  which disarmed all four rules keyed on an npm package. Caught only because the ratchet probes
  in §9 reported zero when they should not have.
- `no-cross-module` used a regex `\1` backreference; dependency-cruiser wants `$1`. With `\1` the
  rule flagged 35 same-module imports as violations.
- `^node:fs` matched nothing — the resolver strips the `node:` prefix.

**Changed**
- `server/AGENTS.md` — the Layering section shrank to a pointer plus the `pnpm arch` command.

**Cut by the RED/GREEN baseline** (§9)
- `enforcement.md` (128 lines) deleted — an agent reconstructed nearly all of it from
  `.dependency-cruiser.cjs`, `package.json` and `INSIGHTS.md` unaided. The escalation order moved
  to `SKILL.md` §2; the graph commands moved to the config header.

**Corrected by the RED/GREEN baseline** (§9)
- `ports-and-adapters.md` §2 listed three homes for a port interface without noting that two of
  them are unreachable when the consumer is a `service.ts` or `*-executor.ts` — both
  `no-adapter-to-module` and `no-service-to-adapter-impl` catch `import type` edges. §2 now
  leads with that constraint, verified by probe.

## 9. How this skill was tested

### The gate

Verified empirically, in this order:

| Check | Result |
|---|---|
| Each of the 9 firing rules reports the files predicted from a manual read | ✅ 20 violations; `pnpm arch:strict` prints the current distribution |
| The 3 silent rules (`core-stays-pure`, `contracts-stay-pure`, `not-to-dev-dep`) are armed, not dead | ✅ inverted probes reported 2, 11 and 1 matches respectively — the selectors reach real edges |
| Baseline freezes, `pnpm arch` exits 0 | ✅ 20 entries |
| A new violation fails | ✅ added a `db/client` import to `agents/routes.ts` → exit 1, `no-db-from-routes` named; reverted → exit 0 |
| Nothing else broke | ✅ `pnpm typecheck` clean, 16 test files / 108 tests pass |

The probe step is the one worth repeating whenever a rule is added. A rule whose regex matches
nothing is indistinguishable from a rule that passes.

### The skill text

Run 2026-08-01. Four scenarios, each given to a fresh agent twice: **RED** with the skill
directory moved out of the tree and `server/AGENTS.md` reverted to its pre-skill wording, then
**GREEN** with both restored. The gate config stayed in place for both — it is infrastructure,
and scenario 4 is meaningless without it.

#### The headline result: the skill changed cost, not correctness

**All four RED agents got the right answer unaided.** No exceptions, no near-misses. The skill
did not rescue a single wrong decision.

What it changed is how much work the answer took:

| # | Scenario | RED tokens | GREEN tokens | RED tool calls | GREEN tool calls | RED time | GREEN time |
|---|---|---|---|---|---|---|---|
| S1 | Findings-count endpoint | 105,725 | 47,980 | 48 | 20 | 6m36s | 4m08s |
| S2 | Slack notifier | 129,303 | 72,614 | 45 | 20 | 7m15s | 4m50s |
| S3 | Unit-test `AgentsService.list` | 100,927 | 32,721 | 49 | 9 | 8m33s | 2m02s |
| S4 | `no-cross-module` failure | 81,366 | 31,609 | 35 | 10 | 5m31s | 2m39s |
| | **Mean** | **104,330** | **46,231** | **44.3** | **14.8** | **6m59s** | **3m25s** |
| | **Change** | | **−56%** | | **−67%** | | **−51%** |

S3 is the clearest case: 49 tool calls down to 9 for the same conclusion. The skill's job is to
stop an agent re-deriving settled placement from twenty files.

#### Why RED did so well: the gate config is the real teacher

Every one of the four RED agents read `server/.dependency-cruiser.cjs` and cited it as decisive.
S1 called it exactly that — the rules "are what actually pin the SQL to `repository.ts`". S3
lifted its justification for constructor injection straight out of the `no-fs-in-service`
comment. S4 reconstructed the entire baseline policy from the config header, the workflow header
and `INSIGHTS.md`, and refused to re-freeze.

That is a finding about where to put architectural prose: **dependency-cruiser prints a rule's
`comment` field alongside the violation**, so a comment there is documentation delivered exactly
when it is needed. It is doing more work than any paragraph in this skill.

#### Two places the skill changed the decision, not just the cost

- **S1** — GREEN added the constructor seam to `RepoService` (rule 3 + `testing-the-rings.md`
  §3) as part of the change. RED did not; it planned the endpoint and left the service
  untestable.
- **S4** — RED picked the port (escape #3 in `layering.md` §7). GREEN picked `_shared/`
  (escape #1) and, because `repos/service.ts` imports *only* those constants, that choice also
  cleared a pre-existing baseline entry: 20 → 19. Both answers are legitimate; the ordered
  preference list steered to the one that shrinks the backlog.

#### What the baseline corrected

GREEN S2 found `ports-and-adapters.md` §2 was **wrong**. It offered three homes for a port
interface without saying that two of them are unreachable when the consumer is a `service.ts` or
`*-executor.ts`: `no-adapter-to-module` and `no-service-to-adapter-impl` both catch `import type`
edges. Confirmed by probe — a type-only import in each direction trips its rule — and §2 now
leads with that constraint. The skill was corrected by the test it was supposed to pass.

#### What the baseline cut

**`enforcement.md`, 128 lines, deleted.** RED S4 rebuilt almost all of it with no skill at all —
the rule semantics from `.dependency-cruiser.cjs`, the three `pnpm arch*` commands from
`package.json`, the "only shrinks" policy from the config header, the workflow header and
`INSIGHTS.md`, and the two silent-green traps from `server/INSIGHTS.md`. Re-stating any of that
in a skill file was pure context cost.

Two parts of it did not exist elsewhere and were moved rather than dropped:

- **The escalation order** (move > narrow > baseline, no inline-ignore) → `SKILL.md` §2. This is
  the only part with evidence behind it: it is what steered GREEN S4 to `_shared/` and a
  shrinking backlog.
- **The graph-rendering commands** → the header of `server/.dependency-cruiser.cjs`, which is
  where the baseline says operational prose belongs.

#### Regression check on the cut

Deleting `enforcement.md` moved its one load-bearing part — the escalation order — into
`SKILL.md` §2. S4 was the only scenario that had cited the deleted file, so it was re-run alone
against the cut skill, with the pass criteria fixed in advance: pick `_shared/`, refuse to
re-freeze, stay near 10 tool calls.

| | RED (no skill) | GREEN (5 files) | GREEN (4 files, after the cut) |
|---|---|---|---|
| Choice | the port | `_shared/` | `_shared/` |
| Re-freeze the baseline? | refused | refused | refused |
| Tool calls | 35 | 10 | 12 |
| Tokens | 81,366 | 31,609 | 33,562 |

Passed. The +2 tool calls are noise against RED's 35, and the run cited `SKILL.md` for "the
escalation ladder" and "the already-frozen-from-another-file heuristic" — the moved content, doing
its job from its new home.

It also turned up two facts the skill did not have. Both were verified by probe rather than
taken on the agent's word, and one of its explanations was wrong:

- **`repo-intel/constants.ts` is the target of 3 of the 20 frozen violations** — one
  `no-cross-module` and two `no-adapter-to-module`. A single misplaced file is 15% of the backlog.
- **A re-export barrel cannot clear a `no-cross-module` edge.** The agent's reasoning was that
  dependency-cruiser resolves through to the symbol's origin; it does not. The violation is
  reported against the file you actually import, so a barrel inside the foreign slice just
  relocates the edge onto the barrel. Right conclusion, wrong mechanism. The correct statement
  now lives in that rule's `comment` field, where it prints alongside the failure.

#### What survived, and the honest caveat

`.claude/skills/README.md` says to cut every rule the baseline agent already follows unaided. On
a strict reading that is *all of them*. The remaining four files survive on one argument with
evidence and one without:

- **With evidence:** the compression is real and large (−56% tokens, −67% tool calls, four for
  four). An answer an agent reaches unaided in 49 tool calls is not free.
- **Without evidence:** the ring vocabulary and §6's cost argument are aimed at a human reading
  the code, and this baseline only measured agents. Unproven either way.

Next most likely to go is `layering.md` (216 lines, the longest). No RED agent misplaced a file,
so its marginal value is the same compression argument and nothing stronger. A baseline that
tested a *human* reader, or a scenario where an agent gets placement wrong, would settle it
either way; neither has been run.

# 02 — onion-architecture, a skill with a gate

**Status:** implemented 2026-08-01.

## Problem

`server/AGENTS.md` had stated the layering since the context layer landed: `routes.ts →
service.ts → repository.ts`, "Do not query the DB from a route." Nothing measured it, and the
drift was already substantial when the first check ran:

- **Four of eight modules have no service and no repository.** `pulls/routes.ts` is 420 lines
  with 16 direct `container.db` calls. `polling`, `settings`, `workspace` are the same shape.
- **`adapters/` imports `modules/`** in three places — a driven adapter reaching into a feature.
- **Three services have no hermetic tests**, because each builds its own repository in its
  constructor and so offers no seam. The two tests that do fake a repository reach it by
  overwriting a private field.

A prose rule nobody measures decays into a rule nobody follows. Restating it more loudly was not
going to help.

## Approach

Two artifacts. The skill supplies the judgement (which ring, which direction, why); the gate
supplies the measurement.

### The skill

`.claude/skills/onion-architecture/`, locally authored, **not** added to `skills-lock.json`.
Mirrors `frontend-architecture/`, the declared reference layout: a thin `SKILL.md` that loads on
every activation, four topic files that load only when the question needs them, and a README
card carrying the sources.

| Part | Why it is there |
|---|---|
| Ring table | Names the four rings on the folders that already exist |
| Four-step procedure | Turns "where does this go" into a lookup, not an essay |
| Eight rules | One per arrow the gate checks, with the repo's own counter-examples |
| Sibling-skill boundary | `drizzle-orm-patterns` will happily show a query in a handler; this overrides it |
| §6 "What this costs" | The counterargument, cited, so the skill is guidance and not advocacy |
| Red flags + checklist | The two formats an agent actually acts on |

### The gate

`server/.dependency-cruiser.cjs` — twelve rules at `severity: error`, run by `pnpm arch` and by
`.github/workflows/server-arch.yml`. `dependency-cruiser` was already a dependency of `server/`
(the `depgraph` adapter cruises user repos with it), so the gate cost no new package.

Nine rules fire today. Three (`core-stays-pure`, `contracts-stay-pure`, `not-to-dev-dep`) are
ratchets: armed, matching real edges, reporting zero because the code is genuinely clean there.

### The baseline

`.dependency-cruiser-known-violations.json` freezes the 20 violations that existed at switch-on,
so CI was green from the first commit. It is a backlog that only shrinks; `pnpm arch:strict`
prints it in full.

## Decisions and their alternatives

**Map the rings onto existing folders; do not create `domain/ application/ infrastructure/`.**
The canonical Onion tree would move ~80 files and break `tsconfig` paths, the duplicated vitest
aliases, the twice-vendored `shared/`, and reviewer-core's alias into `server/src/vendor/shared`.
A course repo becomes harder to read, not easier. The rings are named where the code already
sits.

**dependency-cruiser, not eslint-plugin-boundaries.** The ESLint plugin gives better in-editor
feedback, which genuinely matters. But this repo has **no ESLint at all**, so adopting it means
adopting and configuring a linter first. dependency-cruiser was already installed.

**Freeze a baseline instead of failing red or warning.** `severity: warn` produces a rule nobody
reads. Failing immediately blocks the branch behind a multi-hour refactor of four modules. The
baseline makes the backlog explicit and countable, and the file shrinking is the evidence it is
being paid down.

**The composition root is exempt, and says so.** `platform/container.ts` imports `modules/`,
which reads as a layering violation and shows up in `no-circular`. It is the composition root —
definitionally the one place that names concrete types. Stated in `SKILL.md` §1 and in the
rule's `comment` field, because the alternative is someone "fixing" it.

**The repository is justified by SQL isolation and a test seam, not portability.** Domain-Driven
Hexagon and others argue a repository over an ORM is often dead weight, and they are right about
the swappability argument. The rule is therefore about what a repository may *contain*, not
about abstracting Drizzle away.

**Services keep taking `Container`.** Retro-fitting constructor injection across eight services
with no test behind the change is churn. New services add one default parameter for the
repository; the container remains the way to reach adapters.

**`fastify-best-practices` was not edited to cross-link here.** It is a pinned upstream copy in
`skills-lock.json`. The hand-off lives in the catalog description and in this skill's README
instead.

## Known weakness

**The skill adds no correctness, only speed.** The RED/GREEN baseline ran on 2026-08-01 (full
numbers in the skill's README §9) and all four RED agents — no skill, `server/AGENTS.md` reverted
— reached the right answer unaided. The skill cut the mean cost of getting there by 56% of tokens
and 67% of tool calls, and in two scenarios steered to a better decision, but it rescued nothing.

On a strict reading of `.claude/skills/README.md` ("rules an agent already follows unaided are
context cost — cut them") this skill should be one page pointing at the config. **`enforcement.md`
was cut on exactly that evidence** — 128 lines an agent had reconstructed unaided — leaving four
files and 1003 lines. The rest was kept because the compression is large and measured; the ring
vocabulary and the cost argument in §6, aimed at human readers, remain unproven either way since
the baseline only measured agents. `layering.md` is the next candidate.

**The gate config turned out to be the better carrier for architectural prose.** Every RED agent
cited `.dependency-cruiser.cjs` as decisive, because dependency-cruiser prints a rule's `comment`
alongside the violation — documentation delivered exactly when it is needed, to someone who has
already hit the problem. Worth remembering before writing the next long guidance document.

**The gate only sees static imports.** Anything reached through a string, a dynamic `import()`,
or the container at runtime is invisible to it. The container is the obvious hole: a service can
reach any adapter through `container.*` without an import that dependency-cruiser can see. That
is the trade for having a composition root at all.

**Four rules were silently dead in the first draft.** `exclude: node_modules` removes the module
*and every edge pointing at it*, so every rule keyed on an npm package matched nothing and
reported green. A rule that matches nothing is indistinguishable from a rule that passes. The
mitigation is procedural — probe every new rule by pointing it at something known-present — and
it lives in `server/INSIGHTS.md` and the root `INSIGHTS.md` rather than being enforceable itself.

## Acceptance

- `cd server && pnpm arch` exits 0; `pnpm arch:strict` reports exactly the 20 baseline entries.
- Adding a `db/client` import to `modules/agents/routes.ts` fails the gate naming
  `no-db-from-routes`; reverting makes it pass.
- Each of the three silent rules reports matches when its `to` is deliberately inverted.
- `pnpm typecheck` clean and the 16 hermetic test files (108 tests) still pass.
- `SKILL.md` under 500 lines, file references one level deep, `name` matches the directory, no
  top-level `version` in the frontmatter.
- Every source link in `README.md` §5 was fetched and read, and carries what was taken from it.
- The RED/GREEN baseline is run and recorded in `README.md` §9, with the RED condition being a
  genuinely absent skill (directory moved out of the tree, `server/AGENTS.md` reverted) rather
  than an instruction not to use it.
- No Cyrillic in any committed file.

# Routing — which subagent opens which skill

Step 3 of [SKILL.md](SKILL.md) dispatches one subagent per domain. This file says what each one
is given to read.

**This file copies no rules.** For a skill that ships a review checklist, it points at the
checklist. For a skill that does not, it carries three to six *questions* aimed at a named
section — a pointer, never the rule itself. A third copy of a rule is a third thing to drift,
and this repo already pays that bill twice over in `vendor/shared/`.

## 1. Domains

`scope.sh` does the routing, in its `domains_for` function. **That function is the executable
copy; the table below is the readable one. If they disagree, the script is right.**

| A path matching | Domain | Opens |
|---|---|---|
| `client/**/*.test.ts(x)` | `frontend-tests` | `react-testing-library` |
| `client/src/**/*.ts(x)` | `frontend` | `frontend-architecture`, `react-best-practices`, `next-best-practices` *(only when `app/`, `layout`, `page` or `'use client'` is in the diff)* |
| `server/src/{modules,adapters,platform}/**` | `backend` | `onion-architecture`, `fastify-best-practices` *(only when a `routes.ts` or a plugin is touched)* |
| `server/src/db/**`, `**/schema.ts`, `server/drizzle/*.sql` | `data` | `drizzle-orm-patterns`, `postgresql-table-design` *(only for a new migration or a schema change)* |
| `reviewer-core/src/**` | `core` | `onion-architecture` — **Core-ring rules only** (§1, §3.8) |
| `**/contracts/**`, `**/*.schema.ts` | `contracts` | `zod`, `typescript-expert` |
| every routed file | `security` | `security` |

Two properties of that table are deliberate and easy to break:

- **`security` is appended to every routed file**, so it is the one agent that is not
  partitioned. It sees the whole reviewed diff and is the only agent that can spot a
  cross-file problem.
- **A test file gets `frontend-tests` and not `frontend`.** The first match wins in
  `domains_for`. Do not "fix" that by giving test files both — a test is not a component.

Files that reach no domain land in `checklist[]`: `.github/workflows/**`, `scripts/**`,
`docker-compose.yml`, `*.env.example`, `docs/**`, `specs/**`, `*.md`. Read them, no subagent.
The one thing worth raising from that list: `docs/architecture.md` in the diff earns a `note`
asking whether its diagram still holds.

## 2. Skills that ship a checklist — run it

Three of the thirteen end in a checklist written to be run against a diff. Open the skill and
work the list; nothing here restates it.

| Skill | Section | Given to |
|---|---|---|
| `frontend-architecture` | §Review checklist | `frontend` |
| `onion-architecture` | §7 Review checklist | `backend`, `core` |
| `typescript-expert` | §Code Review Checklist | `contracts` |

## 3. Skills with no checklist — what to look for

Eight of the ten checklist-less skills take part in a review. Each block below points at
sections *of that skill*; open the section before reporting against it. The other two —
`mermaid-diagram` and `engineering-insights` — take no part at all, and are in §5.

### `react-best-practices` → `frontend`

- §Derive, Don't Store — is anything in `useState` computable from props or query data?
- §Hooks — does a new hook obey the rules there, and is anything named `use*` that is not one?
- §Render Factories — is a component defined inside another component's body?
- §Key Prop Patterns — does a new list key off an index or something unstable?
- §Conditional Rendering — does `&&` guard a number or a possibly-empty string?
- §Severity Levels — its CRITICAL / HIGH / MEDIUM labels are **its own**, not ours. Map every
  finding through [severity.md](severity.md) before reporting it.

### `next-best-practices` → `frontend`, only when `app/`, `layout`, `page` or `'use client'` moved

- §RSC Boundaries — did `'use client'` move up a tree that did not need it?
- §Async Patterns — are `params`, `searchParams`, `cookies()` and `headers()` awaited?
- §Data Patterns and §Route Handlers — is the fetch where that section puts it?
- §Hydration Errors — does the diff introduce one of the causes listed there?
- §Metadata & OG Images — does a new route export what the section requires?

### `react-testing-library` → `frontend-tests`

- §Query Priority — is the query the highest-priority one actually available?
- §userEvent — is `fireEvent` used where `userEvent` applies?
- §Async Testing — a `waitFor` wrapped round a `getBy`, or a `findBy` that should have been one?
- §Anti-Patterns — does the test assert on implementation rather than behaviour?
- §What to Test / What to Skip — is the new test in the "skip" column?

### `fastify-best-practices` → `backend`, only when a `routes.ts` or a plugin moved

Its content lives in `rules/*.md`, not in `SKILL.md`. Open the named file, not the index.

- `rules/schemas.md` — does the route declare `schema`, response schema included?
- `rules/plugins.md` — does a new plugin respect encapsulation? *(Whether it is registered in
  `modules/index.ts` is ours, not Fastify's — see [severity.md](severity.md).)*
- `rules/hooks.md` — is a hook doing work that belongs to a handler, or the reverse?
- `rules/error-handling.md` — is an error swallowed, or re-thrown with its type lost?
- `rules/testing.md` — is a new route exercised through `inject()`?

### `drizzle-orm-patterns` → `data`

Read the precedence rule in [SKILL.md](SKILL.md) §5 before this one — it decides every conflict
between this skill and `onion-architecture`.

- §Best Practices — do the new queries follow it?
- §Constraints and Warnings — does the diff hit one of them?
- §Quick Reference — right dialect? This repo is Postgres: `pgTable`, `drizzle-orm/pg-core`.
- §Examples — Example 1 builds the client and runs `db.select()` at module scope, in the same
  file as the schema. `onion-architecture` §3.2 puts every query in a `repository.ts`, so that
  example is a source of false findings here, not a standard.

### `postgresql-table-design` → `data`, only for a new migration or a schema change

- §Core Rules and §Constraints — does a new column carry the constraint that section asks for?
- §Data Types — is the type that section's choice for this shape of value?
- §Indexing — does a new foreign key or filtered column have an index?
- §PostgreSQL “Gotchas” — does the migration walk into one? (curly quotes in the real heading)
- §JSONB Guidance — is JSONB standing in for a column that should exist?

### `zod` → `contracts`

- §1 Schema Definition and §2 Parsing & Validation — is the schema at the edge, parsed once?
- §3 Type Inference — is a type hand-written next to a schema instead of inferred from it?
- §4 Error Handling — is `parse` used where the failure is ordinary user input?
- §5 Object Schemas — was strict / passthrough decided, or defaulted into?
- Its CRITICAL / HIGH / MEDIUM priorities are its own; map through [severity.md](severity.md).

### `security` → every domain

- §A01 Broken Access Control — is a tenancy or ownership check missing on a new route?
- §A05 Injection — SQL, shell or path built by string concatenation?
- §Secret Detection — a key, a token, or a URL carrying credentials in the diff?
- §File Upload Security — does a new path join stay inside its root? Commit `1d5348d` is this
  repo's own case: a finding link whose path resolved out of the repo.
- §Core Philosophy — Confidence-Based Review — its confidence bar and our adversarial verifier
  ([SKILL.md](SKILL.md) §3.4) both apply. A critical must clear both.
- §Framework Security Quirks — its MongoDB, Mongoose and Express subsections describe a stack
  this repo does not have. Do not report against them.

## 4. Skills from outside `.claude/skills/`

They come from the plugin cache and the built-ins. There is no `~/.claude/skills/`.

| Skill | Used for |
|---|---|
| `superpowers:dispatching-parallel-agents` | the step-3 fan-out — one message, many agents |
| `superpowers:verification-before-completion` | the report's evidence rule: no claim without the command that proves it |
| `superpowers:test-driven-development` | supplies "new behaviour with no test is major" |
| `superpowers:receiving-code-review` | what the user does with the report, after |
| `superpowers:finishing-a-development-branch` | what happens once the verdict is a pass |
| `engineering-insights` | **after** a run, when a finding turned out to be worth recording. Never during one — it writes, and a review does not. |

## 5. Deliberately unused

Listed so the next editor does not add "the missing one".

| Not used | Why |
|---|---|
| `mermaid-diagram` | generative, not analytic. Nothing in a review produces a diagram. |
| `claude-api` | skipped **by its own rule**: its SKIP clause defers to whichever provider the project already uses, and `reviewer-core` depends on `openai`. |
| `superpowers:requesting-code-review` | superseded here — [SKILL.md](SKILL.md) §6. Running both duplicates every finding. |
| the rest of `superpowers` — `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `systematic-debugging`, `using-git-worktrees`, `using-superpowers`, `writing-skills` | authoring and process skills. A review reads; it does not plan, debug or write. |
| all of `chrome-devtools-mcp` | needs a live browser. The e2e suite owns that, and `e2e/specs/*.flow.json` is Tier 2 — flagged, never opened. |
| everything else in the plugin cache and the built-ins — `dataviz`, `artifact-design`, `run`, `init`, `loop`, `schedule`, `update-config`, … | not review skills. |

## 6. Where this drifts

Five of the eight skills in §3 — `next-best-practices`, `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design`, `zod` — are pinned upstream in
`skills-lock.json` and cannot be edited to grow a checklist of their own. So §3 holds *our*
pointer into *their* section heading, and
nothing detects it when they rename one. If a subagent reports that a named section does not
exist, that is a defect in this file — fix the pointer, do not guess at the content.

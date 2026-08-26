# Layering checklist

`server/` is `routes.ts → service.ts → repository.ts`, with every external
dependency behind a port. Twelve dependency-cruiser rules enforce part of it and
`pnpm arch` fails on a new violation — so this rubric is only about what those
rules **cannot** see. Check each item against the changed lines.

## What the gate cannot catch

- **`container.db` in a route.** Drizzle belongs in a `repository.ts`. Nineteen
  edges are frozen in `.dependency-cruiser-known-violations.json`, and a frozen
  edge silences that edge *entirely* rather than counting new violations on it —
  so a route already on the list can grow a new query with the gate still green.
- **A row shape crossing a module.** `AgentRow` belongs to `modules/agents`; a
  `pull_requests` row belongs to `db/`. A slice that needs one declares the
  minimal shape it reads in its own `types.ts` — and **maps to it**. A struct
  literal built with property shorthand does not narrow anything at runtime:
  excess-property checking does not fire on a shorthand, so the whole row travels
  on and only the type view is narrow.
- **Filesystem or network reached through an indirection.** `no-fs-in-service`
  matches a direct `node:fs` edge from a `service.ts`. A service calling a loader
  module that reads for it passes the rule and breaks what it stands for.
- **A new external dependency with no port.** Every one needs an interface in
  `vendor/shared/adapters.ts`, an implementation under `adapters/`, a mock in
  `adapters/mocks.ts`, and a container slot. Missing the mock is the common half.
- **A module registered anywhere but `modules/index.ts`.** Registration is by
  hand, deliberately; filesystem autoload is not used.
- **A contract changed in one vendored copy.** `@devdigest/shared` exists twice.
  Each package compiles against its own copy, so a one-sided edit type-checks on
  both sides and is wrong on one.

## Severity

- A row type, a query or an `fs` call crossing a boundary → **WARNING**.
- A missing port, or a mock that returns more than the real adapter would →
  **WARNING**; a mock that hides an unbounded read is how it passes every test.
- A one-sided `vendor/shared` edit → **CRITICAL**: nothing else detects it.

Cite the changed line and name the rule. "This feels like the wrong layer" is not
a finding; name the rule it breaks and what the gate cannot see about it.

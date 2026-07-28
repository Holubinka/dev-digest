# Insights — e2e/

Failures and surprises specific to the browser suite. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

_Nothing recorded yet._

## What Doesn't Work

### Tempted to reach for the `chat` command

**Symptom.** A locator is awkward to express, and `agent-browser`'s LLM-driven `chat`
command would solve it in one line.

**Cause.** It is genuinely more convenient.

**Fix.** Do not. It would make the suite non-deterministic and require an API key in
CI — the two properties this suite exists to avoid. Restructure the locator, or add a
stable `data-*` hook in the client instead.

## Codebase Patterns

_Nothing recorded yet._

## Tool & Library Notes

_Nothing recorded yet._

## Recurring Errors & Fixes

### The suite passes locally and fails in CI, or vice versa

**Symptom.** `../scripts/e2e.sh` is green, the `e2e-web` workflow is red, and nothing in
the diff explains it.

**Cause.** They are not the same harness. `scripts/e2e.sh` builds an isolated stack on
Postgres 5433 / API 3101 / web 3100 with an ephemeral container. CI does not call that
script at all — `e2e-web.yml` stands up its own stack on 5432 / 3001 / 3000 and invokes
`run.ts`. Anything port- or volume-dependent can differ between them.

**Fix.** Reproduce the CI path directly (start the stack on the standard ports, then
`npm test`) before concluding a flow is flaky.

### A flow fails right after a seed or UI-copy change

**Symptom.** `wait --text` times out on a string that is visibly on the page, or a
`find` matches nothing.

**Cause.** Flows assert against seeded fixtures — the demo repository
`acme/payments-api` and PR #482 — and against literal visible text. Renaming a label or
editing the seed silently invalidates them.

**Fix.** Update the flow JSON alongside the change. Treat these files as part of the
UI's contract, not as an afterthought.

## Session Notes

_Nothing recorded yet._

## Open Questions

_Nothing recorded yet._

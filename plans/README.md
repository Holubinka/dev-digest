# plans/ — implementation plans

**How** we are about to build something. Written by the
[`implementation-planner`](../.claude/agents/implementation-planner.md) agent against an
approved spec, executed by `implementer`, graded by `plan-verifier`.

**Goes here:** the requirements as the planner understood them, the constraints with the file
that mandates each, the steps or work packages, tests, gates, verification.

**Does not go here:** *what* we are building and *why*, or the alternatives behind that
decision — that is [`../specs/`](../specs/README.md). How the system already works — that is
[`../docs/`](../docs/README.md). Post-mortems — [`../INSIGHTS.md`](../INSIGHTS.md).

One folder serves every package; the plan's `**Scope:**` header records which packages it
touches. Naming: `NN-topic.md`, the next free two-digit number.

A plan is finished when someone with a clean context window could execute it without asking the
planner a question. Once the work ships, leave the plan as a record — the implementer flips its
status row and does not rewrite the text to match what was built.

When a plan is written against a spec, its `## Requirements as understood` table cites the
criterion — `specs/SPEC-03-digest.md § AC-7`, not the file alone — and **every `AC` in that spec
becomes an `R#` here or is named by its number under `## Out of scope`.** The spec is not read
again downstream: `plan-verifier` grades this document, so a criterion that never crossed over
produces a report of all-`MET` rows for a feature that is missing something a human approved.
`plan-verifier` checks the same crossing from its side and reports a lost `AC` as a remark about
the plan.

The ten rows below moved here from `specs/` on 2026-08-12. They were written under the older
regime, where one document carried both the requirements and the steps, so their `Scope` is the
one the old folder implied — work spanning more than one package — and they predate the
single-agent / multi-agent execution split. Their filenames keep the numbering they shipped
with, `LNN-` included; a new plan takes the next free `NN`.

| Plan | Scope | Execution | Status |
|---|---|---|---|
| [`L01-context-layering.md`](L01-context-layering.md) | repo-wide | legacy | Implemented 2026-07-27 |
| [`L02-engineering-insights.md`](L02-engineering-insights.md) | repo-wide | legacy | Implemented 2026-07-27 |
| [`L04-findings-on-the-pr-list.md`](L04-findings-on-the-pr-list.md) | repo-wide | legacy | Implemented 2026-07-28 |
| [`01-agents-md-migration.md`](01-agents-md-migration.md) | repo-wide | legacy | Implemented 2026-08-01 |
| [`02-onion-architecture-skill.md`](02-onion-architecture-skill.md) | repo-wide | legacy | Implemented 2026-08-01 |
| [`03-pr-self-review-skill.md`](03-pr-self-review-skill.md) | repo-wide | legacy | Implemented 2026-08-02 |
| [`04-agents-for-tests-review-and-docs.md`](04-agents-for-tests-review-and-docs.md) | repo-wide | legacy | Planned 2026-08-05 |
| [`05-intent-layer.md`](05-intent-layer.md) | repo-wide | legacy | Implemented 2026-08-05 |
| [`06-mcp-server.md`](06-mcp-server.md) | repo-wide | legacy | In progress 2026-08-08 |
| [`07-blast-radius.md`](07-blast-radius.md) | repo-wide | legacy | In progress 2026-08-09 |
| [`08-project-context.md`](08-project-context.md) | repo-wide | single-agent | Planned 2026-08-13 |
| [`09-project-context-authoring.md`](09-project-context-authoring.md) | server · client | multi-agent | Planned 2026-08-14 |
| [`10-pr-why-risk-brief.md`](10-pr-why-risk-brief.md) | server · client | multi-agent | Planned 2026-08-16 |

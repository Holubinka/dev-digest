# client/specs/

Design specifications for work confined to the web app. Anything spanning packages
belongs in [`../../specs/`](../../specs/README.md).

**Goes here:** what we are about to build in this package and why, alternatives
considered, acceptance criteria. UI specs benefit from a sketch — a Mermaid diagram or
an ASCII wireframe beats a paragraph.

**Does not go here:** how we will build it — steps, tests and gates (that is
[`../../plans/`](../../plans/README.md), one folder for every package), how the UI already works
(that is [`../docs/`](../docs/README.md) and [`../README.md`](../README.md)), or post-mortems
(that is [`../INSIGHTS.md`](../INSIGHTS.md)).

Written by the [`spec-creator`](../../.claude/agents/spec-creator.md) agent, approved by a human.

Naming: `SPEC-NN-topic.md`, the next free two-digit number here. The two `LNN-` files below
predate that convention and keep their names. Status moves `Draft` → `Approved` → `Implemented`.

| Spec | Status |
|---|---|
| [`L03-findings-severity-filter.md`](L03-findings-severity-filter.md) | Implemented 2026-07-28 |
| [`L05-findings-on-the-run-row.md`](L05-findings-on-the-run-row.md) | Implemented 2026-07-30 |

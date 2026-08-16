# reviewer-core/specs/

Design specifications for work confined to the review engine. Anything spanning packages
belongs in [`../../specs/`](../../specs/README.md).

**Goes here:** what we are about to build in the engine and why, alternatives
considered, acceptance criteria. Specs that change what reaches the user through the
grounding gate should state the expected before/after on a concrete diff.

**Does not go here:** how we will build it — steps, tests and gates (that is
[`../../plans/`](../../plans/README.md), one folder for every package), how the pipeline already
works (that is [`../docs/`](../docs/README.md) and [`../README.md`](../README.md)), or
post-mortems (that is [`../INSIGHTS.md`](../INSIGHTS.md)).

Written by the [`spec-creator`](../../.claude/agents/spec-creator.md) agent, approved by a human.

Naming: `SPEC-NN-topic.md`, the next free two-digit number here. Status moves `Draft` →
`Approved` → `Implemented`.

No specs yet. The table below is the register; the first engine-scoped spec appends its own
row and leaves the header alone. There is no `Modules` column here — the folder is the module.

| Spec | Status |
|---|---|

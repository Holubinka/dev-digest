# specs/ — repo-wide

Requirements for work that spans more than one package. Work confined to a single package
belongs in [`<module>/specs/`](../client/specs/README.md).

**Goes here:** what we are about to build, for whom, why, the acceptance criteria anyone can
check it against, and the corner cases the design left out.

**Does not go here:** how we will build it — steps, work packages, tests and gates (that is
[`../plans/`](../plans/README.md)), how the system already works (that is
[`../docs/`](../docs/README.md)), agent conventions (that is [`../AGENTS.md`](../AGENTS.md)),
or post-mortems (that is [`../INSIGHTS.md`](../INSIGHTS.md)).

Written by the [`spec-creator`](../.claude/agents/spec-creator.md) agent, approved by a human,
then planned against by [`implementation-planner`](../.claude/agents/implementation-planner.md).
A `PreToolUse` hook in `spec-creator`'s frontmatter refuses every write it makes outside these
folders; `scripts/spec-creator/write-gate.sh` is the script, and it is the only enforced
boundary either agent has.

Naming: `SPEC-NN-topic.md`, the next free two-digit number in this folder. The document carries
the same id in its `**Spec ID:**` header. Headings are English, prose is Ukrainian.

**Status** moves `Draft` → `Approved` → `Implemented`. `spec-creator` only ever writes `Draft`;
approval is the human's act, `implementation-planner` records it when it starts planning, and
the implementer flips the last one when the code lands.

A spec is finished when someone else could plan it without asking you questions. Once the work
ships, leave it as a record — do not rewrite history to match the implementation; note the
divergence instead.

`AC-N` numbers are stable identifiers, not decoration. The plan cites them in its requirement
table and must account for every one of them — as an `R#`, or by number under its `## Out of
scope` — and `plan-verifier` checks that it did. Renumbering the criteria of a spec that has
already been planned against silently breaks both.

Ten documents that used to live here moved to [`../plans/`](../plans/README.md) on 2026-08-12.
They were written under the older regime, where one file carried both the requirements and the
steps, and they read as plans.

No specs yet. The table below is the register; the first spec appends its own row and leaves
the header alone. `Modules` is the same list the spec carries in its `**Modules:**` header.

| Spec | Modules | Status |
|---|---|---|

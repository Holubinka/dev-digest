# docs/ — repo-wide

Deep explanations of how things work, written for a human reader and linked from
[`../CLAUDE.md`](../CLAUDE.md) rather than inlined into it.

**Goes here:** cross-package architecture, end-to-end flows, decision records, guides
that outlive a single change.

**Does not go here:** module-specific detail (use `<module>/docs/`), agent conventions
(use [`../CLAUDE.md`](../CLAUDE.md)), debugging war stories (use
[`../INSIGHTS.md`](../INSIGHTS.md)), or anything already explained in a package
README — link to it instead of copying it.

| File | What it covers |
|---|---|
| [`architecture.md`](architecture.md) | How a review is produced end to end, and how the packages talk |
| [`agent-prompts/`](agent-prompts/README.md) | The built-in reviewer prompts and how to choose a model |

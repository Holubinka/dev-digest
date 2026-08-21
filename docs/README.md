# docs/ — repo-wide

Deep explanations of how things work, written for a human reader and linked from
[`../AGENTS.md`](../AGENTS.md) rather than inlined into it.

**Goes here:** cross-package architecture, end-to-end flows, decision records, guides
that outlive a single change.

**Does not go here:** module-specific detail (use `<module>/docs/`), agent conventions
(use [`../AGENTS.md`](../AGENTS.md)), debugging war stories (use
[`../INSIGHTS.md`](../INSIGHTS.md)), or anything already explained in a package
README — link to it instead of copying it.

| File | What it covers |
|---|---|
| [`architecture.md`](architecture.md) | How a review is produced end to end, and how the packages talk |
| [`agent-prompts/`](agent-prompts/README.md) | The built-in reviewer prompts and how to choose a model |
| [`project-context.md`](project-context.md) | How a `.md` file in a cloned repo is written, becomes text in a review prompt, and is traced afterward |
| [`onboarding-tour.md`](onboarding-tour.md) | How a repository's index becomes a five-section tour in one grounded model call, end to end across server, contract and client |

# server/docs/

Deep explanations specific to the API package, linked from [`../AGENTS.md`](../AGENTS.md)
rather than inlined into it.

**Goes here:** module-level design notes, data-flow walkthroughs, adapter contracts,
migration strategy, anything too long for `AGENTS.md` but too API-specific for
[`../../docs/`](../../docs/README.md).

**Does not go here:** the API route map (that is [`../README.md`](../README.md)),
cross-package architecture (that is [`../../docs/architecture.md`](../../docs/architecture.md)),
conventions the agent must follow (that is [`../AGENTS.md`](../AGENTS.md)), or debugging
notes (that is [`../INSIGHTS.md`](../INSIGHTS.md)).

| File | What it covers |
|---|---|
| [`skill-injection-detection.md`](skill-injection-detection.md) | what `detectInjection` flags, and exactly what `create`/`update`/prompt-assembly each do with a flagged skill body |

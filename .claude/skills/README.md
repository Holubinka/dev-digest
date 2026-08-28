# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Which ring code goes in: layering, ports and adapters, the composition root, and the `pnpm arch` gate |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [frontend-architecture](frontend-architecture/SKILL.md) | Frontend | Where code goes: folder structure, component splitting, logic placement, Server/Client boundary |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Repo | Capture what a session learned into the right module's `INSIGHTS.md` |
| [pr-self-review](pr-self-review/SKILL.md) | Repo | Review every open change against the repo's skills and gates before a PR; blocks on a critical |
| [implement](implement/SKILL.md) | Repo | Carry an approved plan from `plans/` through build, run, verify, review and a bounded fix loop |
| [run-retrospective](run-retrospective/SKILL.md) | Repo | What a multi-agent run cost and what it taught: billed tokens, dispatch order, what the agents duplicated |
| [dependency-checker](dependency-checker/SKILL.md) | Repo | External npm deps (size, type, drift, unused) and the internal no-workspace package graph; graded findings and a prioritized summary |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

**This repo has no commands.** `.claude/commands/` was deleted on 2026-08-13: a skill is already
invocable as `/<name>`, so a command wrapping one added nothing but a second place for its
arguments to drift — which is exactly what had happened to `pr-self-review`'s. Anything you would
reach for a slash command to do belongs in `.claude/skills/` under the layout below, and gets the
registry gate's checks for free.

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `<topic>.md` — One file per question the skill answers, linked from `SKILL.md`. Keep
  good/bad examples inside the topic file they belong to rather than a separate `examples.md`,
  so a rule and its example are never more than one hop apart.
- `README.md` — The skill card: focus, file map, coverage, related skills, sources, version,
  how it was tested (recommended for skills we author)
- `references.md` — Sources and rationale, when they are too large for the README (optional)

Keep `SKILL.md` itself thin — it loads in full whenever the skill activates, so it should
carry only what routes a question: the principles, the decision procedure, the boundary with
sibling skills, and links to the topic files.

### Frontmatter

Only `name` and `description` are required, and `name` **must match the directory name**.
The [Agent Skills spec](https://agentskills.io/specification) has **no top-level `version`
field** — put it under `metadata`, which also takes free-form keys:

```yaml
---
name: frontend-architecture
description: "What it does, and when to use it. Max 1024 characters."
metadata:
  version: "1.0.0"
  tags: react, nextjs, folder-structure
---
```

Keep the `SKILL.md` body under 500 lines and keep file references one level deep, per
[Anthropic's authoring guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

`frontend-architecture/` is the reference implementation of this layout.

### Before calling a skill done

Measure the baseline: run the scenarios the skill is meant to handle against an agent that
does **not** have it. Rules an agent already follows unaided are context cost, not guidance —
cut them. Record the result in the skill's `README.md` so the next editor knows which rules
are evidence-backed.

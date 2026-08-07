# `api-contract-reviewer` — a Claude Code plugin

The five skills DevDigest's **API Contract Reviewer** agent runs, packaged so
Claude Code can run them too. Same bodies, same question each one asks:

| Skill | The question it asks |
|---|---|
| `breaking-change-taxonomy` | how bad this change is for a caller |
| `response-schema-contract` | what the reply's shape looked like before and after |
| `route-signature-checklist` | whether a route's three places moved together |
| `semver-discipline` | whether the break carries a version marker |
| `deprecation-policy` | whether the old thing survived one release |

## Install

```sh
/plugin marketplace add Holubinka/dev-digest
/plugin install api-contract-reviewer@devdigest
```

## `skills/` is generated

The canonical bodies live in [`docs/skills/`](../../docs/skills); the `SKILL.md`
files here are written from them by `scripts/sync-seed-skills.mjs`, which also
generates the database seed. Edit the doc, re-run the script, and the three
copies stay one text. Editing a `SKILL.md` here is editing a build artifact.

The bodies are written against **this** repository — Fastify 5 routes with Zod
schemas, a vendored `@devdigest/shared` that exists as two copies, and a web
client that does not validate responses. Read them before pointing them at
another codebase; the examples name real files.

---
name: semver-discipline
description: "For each versioned surface the diff breaks, check that the version marker moved with it."
---

# Semver discipline

A breaking change is allowed. A breaking change that arrives without a version
marker is not: the consumer has no way to notice, and no way to pin.

This repository has four versioned surfaces. For each one the diff touches, check
that a break carries its marker.

## The four surfaces, and what a break costs on each

| Surface | Where the version lives | A break must |
|---|---|---|
| A published package | `package.json` `version` | bump MAJOR in the same diff |
| A Claude Code plugin | `.claude-plugin/plugin.json` `version` | bump MAJOR, and say what broke |
| An applied DB migration | `src/db/migrations/*.sql` | add a NEW migration, never edit an applied one |
| A skill or agent body | the `version` column, bumped by the service | leave the bump to the service — a hand-set version in a payload is the finding |

## What counts as a break, per surface

- **Package**: a removed export, a renamed export, a narrowed parameter type, a
  changed return shape. Adding an export is MINOR.
- **Plugin**: a skill removed or renamed, or a rule rewritten to mean the opposite.
  Adding a skill is MINOR.
- **Migration**: any statement that changes a column an applied migration created.
  Editing a file that has already run means the two databases disagree forever —
  yours has the new definition, everyone else's has the old one, and
  `_journal.json` says both are up to date. This is CRITICAL every time.
- **Skill/agent body**: `SkillsService.update` bumps `version` when the body
  changes. A diff that writes `version` itself is claiming a history that did not
  happen.

## Examples

**Bad** — the export is gone and the version says nothing happened:

```jsonc
// package.json — unchanged
{ "name": "@devdigest/reviewer-core", "version": "1.4.0" }
```
```ts
// index.ts
- export { assemblePrompt, groundFindings } from './prompt.js';
+ export { assemblePrompt } from './prompt.js';
```

Report: `groundFindings` was removed while the version stayed `1.4.0`; a consumer
on `^1.4.0` gets the break on its next install.

**Bad** — an applied migration edited in place:

```sql
-- 0007_glorious_wolverine.sql, already in _journal.json
- ALTER TABLE "skills" ADD COLUMN "source" text NOT NULL;
+ ALTER TABLE "skills" ADD COLUMN "source" text NOT NULL DEFAULT 'manual';
```

**Good** — the break is announced, or it is not a break:

```jsonc
{ "name": "@devdigest/reviewer-core", "version": "2.0.0" }
```

or the old export stays as a re-export until the next major.

## Scope

Only report a missing bump for a surface this diff actually breaks. A private,
unpublished package (`"private": true`, `version: 0.0.0`) has no consumer to
protect — say so and move on rather than inventing a bump for it.

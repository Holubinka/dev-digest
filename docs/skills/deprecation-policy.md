---
name: deprecation-policy
description: Use when a diff removes or renames something callers can reach — a response field, a route, an exported function — to check it was deprecated first rather than deleted silently.
---

# Deprecation policy

Removing something a caller reaches is allowed. Removing it without a period in
which both the old and the new thing work is what breaks people, and it is the
only part of a rename that costs nothing to get right.

For every public thing this diff removes or renames, check the three steps below.
Report the first one that is missing, anchored to the changed line that removed it.

## The three steps a removal owes

1. **The old name still works.** Emit the old field alongside the new one; keep the
   old route as an alias; re-export the old symbol. One release with both.
2. **It is marked.** `@deprecated` on the type or export, with what to use instead.
   A comment a caller cannot see — one in the handler body, say — does not count.
3. **The removal has a date or a version.** "Removed in 2.0" or "after 2026-09-01".
   "Soon" is not a plan.

## Examples

**Bad** — a rename that deletes the old name in the same breath:

```ts
// modules/skills/helpers.ts
export function toSkillListItemDto(row: SkillWithUsage): SkillListItem {
  return {
    ...
-   agent_count: row.agentCount,
+   agents: row.agentCount,
  };
}
```

`client/src/app/skills/_components/SkillCard/SkillCard.tsx` reads
`sk.agent_count`. It does not fail at the boundary — `api.ts` does not validate —
so it renders `undefined` in the card and nothing anywhere says why.

**Good** — both names for one release, and a marker that travels with the type:

```ts
return {
  ...
  agents: row.agentCount,
  /** @deprecated Renamed to `agents`; removed after 2026-09-01. */
  agent_count: row.agentCount,
};
```

**Bad** — a route that changes shape under the same path:

```ts
- app.get('/skills/:id/stats', ...)
+ app.get('/skills/:id/usage', ...)
```

**Good** — the old path stays and forwards, until the removal date:

```ts
app.get('/skills/:id/usage', handler);
/** @deprecated Use /skills/:id/usage. Removed after 2026-09-01. */
app.get('/skills/:id/stats', handler);
```

## Severity

- Removed with no deprecation period → **CRITICAL**, and name the caller that
  breaks.
- Deprecated but unmarked, or marked with no removal date → **WARNING**.
- Marked, dated, and still working → not a finding. Say nothing.

## Scope

Only what a caller outside the module can reach: a response field, a route, an
exported symbol, a skill name, a settings key. A private helper renamed inside one
module is not a deprecation question, however public it looks.

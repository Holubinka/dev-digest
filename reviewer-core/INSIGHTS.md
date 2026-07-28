# Insights — reviewer-core/

Failures and surprises specific to the review engine. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

_Nothing recorded yet._

## What Doesn't Work

_Nothing recorded yet._

## Codebase Patterns

### `pnpm build` produces no output

**Symptom.** You run the build, it succeeds, and `dist/` never appears.

**Cause.** Not a bug. `build` is aliased to `tsc --noEmit` on purpose — this package is
consumed as TypeScript source through a path alias, so emitting JavaScript would create
a second, stale copy.

**Fix.** Nothing. If you need to verify consumers still compile, run the server's
`pnpm typecheck` instead.

### Findings vanish between the LLM response and the result

**Symptom.** The model clearly returned a finding, and it is not in the output.

**Cause.** Working as designed. `groundFindings` in `src/grounding.ts` drops any finding
whose `[start_line, end_line]` does not intersect a real hunk of the same file in the
diff — this is what stops hallucinated line references from reaching the user.

**Fix.** Check `groundingSummary()` for the "N/M passed" trace before assuming a
regression. If a finding kind legitimately is not line-anchored, it belongs in
`FULL_FILE_KINDS`, which requires only that the file appear in the diff.

### Dependency count is a design constraint, not an oversight

**Symptom.** You want to read a config file, cache to disk, or query the DB from here.

**Cause.** The package deliberately ships only `openai` and `zod` so that both consumers
— the server and a future CI runner — can use it without dragging in infrastructure.

**Fix.** Take the value as a parameter and let the caller supply it. `estimateCost` is
the pattern to copy: injected as a callback so the engine holds no pricing table.

## Tool & Library Notes

_Nothing recorded yet._

## Recurring Errors & Fixes

### A change here breaks the server with no build error

**Symptom.** Everything type-checks in this package, and the server crashes at runtime
or fails its own typecheck.

**Cause.** There is no build boundary between the two. The server compiles against
`../reviewer-core/src`, so an exported signature change propagates instantly and
silently.

**Fix.** After changing anything exported, run `cd ../server && pnpm typecheck`. CI
encodes this too: `reviewer-core/**` changes trigger the `server-unit` workflow.

## Session Notes

_Nothing recorded yet._

## Open Questions

_Nothing recorded yet._

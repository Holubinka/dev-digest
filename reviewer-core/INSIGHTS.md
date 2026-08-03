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

### Nested retry loops multiply, and nothing here bounded the call itself

**Symptom.** A review run sits in `running` for over half an hour with `tokens_in` null
and `error` null, while the same prompt completed in 13-331s an hour earlier. Measured on
2026-08-03 across five runs on PR #7.

**Cause.** Three limits, all per-part, none over the whole:
`new OpenAI({ timeout: 90_000, maxRetries: 2 })` bounds one HTTP request and retries it
three times; `completeStructured`'s schema-repair loop then runs the whole thing up to
three times more. 3 x 3 x 90s of timeouts before anything gives up, plus SDK backoff, and
the repair loop re-sends the entire prompt each time — which is why one run recorded
`tokens_in: 288906` on a 144k-token diff.

**Fix.** `deadlineMs` (default 600_000) is a wall-clock budget over the whole
`completeStructured`. It is checked before each attempt so a spent budget does not send
another 143k-token request, and enforced during one with an `AbortSignal` so a hanging
request is actually cut — `Promise.race` would reject the wrapper and leave the socket
open with the tokens still being paid for. Exceeding it throws `DeadlineExceededError`,
which is what lets a caller record `failed` with a reason instead of `running` forever.

Two properties are worth keeping when touching this: the budget covers the whole call and
not each attempt (per-attempt is what multiplied in the first place), and a real provider
error still propagates unchanged — the clock only takes the blame when the clock ran out.

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

### 2026-08-03

- Added the wall-clock deadline above. It fired in production the same evening: Test
  Quality Reviewer went `failed` at 600s with `OpenRouter gave up on Review after 600s
  (1 attempt(s))`, where an hour earlier the same agent had sat in `running` indefinitely.
  The provider (OpenRouter, `deepseek/deepseek-v4-flash`) intermittently does not answer
  large prompts at all while `/models` and short completions stay fast — so this is not a
  bug to fix upstream, it is a condition to survive.

## Open Questions

_Nothing recorded yet._

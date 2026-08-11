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

### A loop over a number the model wrote is a loop the attacker controls

**Symptom.** One review request blocks the whole API for seconds. Measured 2026-08-09 on a
one-line diff: a single finding with `end_line: 100000000` blocked the event loop for 664 ms,
`end_line: 2000000000` for 13385 ms, and eight such findings (one per enabled agent) for 54.6 s.

**Cause.** `rangeIntersects` in `src/grounding.ts` walked every integer from `start_line` to
`end_line`. Both are model output, `Finding` declares them `z.number().int()` with no upper
bound (`server/src/vendor/shared/contracts/findings.ts:53`), and the model's input is the
attacker-supplied diff body of `POST /reviews/diff`. Cost followed the number the model claimed,
not the diff.

**Fix.** Iterate the hunk line set and test membership of the range —
`for (const n of lines) if (n >= lo && n <= hi) return true;`. Same predicate, cost bounded by
the diff. Verified equivalent over 400k random cases plus NaN/±4e9 edges before landing;
`test/grounding.test.ts` pins both the semantics and a 250 ms budget on the miss path. The
general rule for this package: an unbounded model integer may be compared, never counted to.
A synchronous loop like that one also ignores `testTimeout` — vitest reported the failure only
after the full 54.6 s, so a "slow test" here can be a blocked event loop, not a slow provider.

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

### One OpenRouter slug is several backends, and they do not share a feature set

**Symptom.** A structured call intermittently fails with "lack of support" for
`response_format: json_schema`, at a rate nothing in this repo controls.

**Cause.** OpenRouter load-balances one model id across provider endpoints that advertise
different capabilities. `z-ai/glm-4.7-flash` — the `review_intent` default since 05 — was
served by DeepInfra, Venice, Cloudflare and Novita on 2026-08-05, and Novita reports
`structured_outputs: false`. Which one you get is decided per request.

**Fix.** `openrouter.ts` sends `provider: { require_parameters: true }` on every OpenRouter
request, in the same `this.id === 'openrouter'` block as `session_id` and `usage`. It
restricts routing to endpoints that support every parameter in the body.

Two things to keep. It is unconditional across the review path and the CI runner on purpose:
a review whose schema was quietly dropped is worse than one that fails loudly. And the
alternative — pinning `provider: { order: [...] }` per call — hardcodes vendor names that rot
the next time OpenRouter changes its fleet. `test/openrouter-routing.test.ts` asserts the
field is on the outgoing body, including on repair attempts, and absent under `id: 'openai'`.

### Reasoning tokens bill at the output rate, and a short extraction has no use for them

The same intent classification, measured against OpenRouter on 2026-08-05 with the real
`server/src/prompts/intent.system.md` and the same JSON-schema request:

| config | routed to | reasoning chars | content chars | completion tokens |
|---|---|---|---|---|
| as shipped | Cloudflare | 3983 | 403 | 1078 |
| `reasoning: { enabled: false }` | DeepInfra | 0 | 436 | **113** |
| `max_tokens: 2000` | DeepInfra | 718 | **0** | fails — see Recurring Errors |
| `deepseek/deepseek-v4-flash` | StreamLake | 2561 | 361 | ok |

Same answer, roughly a tenth of the completion tokens. `StructuredRequest.reasoning?: boolean`
(`vendor/shared/adapters.ts`, both copies) carries it, and `openrouter.ts` sends
`reasoning: { enabled: false }` only when the caller passes `false` and only on OpenRouter —
absent by default, so no existing call changed shape. `IntentService.derive` is the only caller
that sets it. Do **not** reach for `max_tokens` as a cost control instead: that is the row that
pushed the whole answer into `reasoning` and broke the call.

## Recurring Errors & Fixes

### A change here breaks the server with no build error

**Symptom.** Everything type-checks in this package, and the server crashes at runtime
or fails its own typecheck.

**Cause.** There is no build boundary between the two. The server compiles against
`../reviewer-core/src`, so an exported signature change propagates instantly and
silently.

**Fix.** After changing anything exported, run `cd ../server && pnpm typecheck`. CI
encodes this too: `reviewer-core/**` changes trigger the `server-unit` workflow.

### "failed schema validation" when the schema was never the problem

**Symptom.** `POST /pulls/:id/intent` returns 502 `OpenRouter structured output failed schema
validation for Intent` on some PRs and not others, and re-running the same PR sometimes works.

**Cause.** Not the schema. Some OpenRouter backends answer with `message.content: null` and put
the complete, valid JSON in `message.reasoning` — observed 2026-08-05 with DeepInfra serving
`z-ai/glm-4.7-flash` under a `max_tokens` cap, where the reasoning string literally began
`{"intent": "Fixes the GitHub API import logic…`. `openrouter.ts` read `content` only, handed
`parseWithRepair` an empty string, retried, failed again, and threw the message at the end of
the loop — which names schema validation whatever the real reason was. Which backend OpenRouter
routes to varies per request, so it fails intermittently.

**Fix.** `answerText()` (`src/llm/openrouter.ts`) falls back to `message.reasoning` when
`content` is empty or whitespace, and only then. Covered by
`test/openrouter-reasoning.test.ts`. When debugging a schema-validation error here, check
whether the raw text was empty **before** touching the Zod schema: the final `throw` is the
loop's exit, not a diagnosis.

## Session Notes

### 2026-08-03

- Added the wall-clock deadline above. It fired in production the same evening: Test
  Quality Reviewer went `failed` at 600s with `OpenRouter gave up on Review after 600s
  (1 attempt(s))`, where an hour earlier the same agent had sat in `running` indefinitely.
  The provider (OpenRouter, `deepseek/deepseek-v4-flash`) intermittently does not answer
  large prompts at all while `/models` and short completions stay fast — so this is not a
  bug to fix upstream, it is a condition to survive.

## Open Questions

- `buildLineIndex` (`src/grounding.ts:33`) still trusts a hunk header. When a hunk carries no
  body lines, `newLineNumbers` is empty and the fallback fills the index from the header's
  declared `newLines`, which `parseUnifiedDiff` copies verbatim
  (`server/src/adapters/git/diff-parser.ts:50`). Measured 2026-08-09: an 84-byte diff body ending
  in `@@ -1,0 +1,5000000 @@` cost 355 ms and 321 MB of heap, and at `+1,20000000` it threw
  `RangeError: Set maximum size exceeded` from inside `buildLineIndex`. It also grounds findings
  against lines no hunk contains, so the fake index keeps a finding it should drop. Left unfixed
  on 2026-08-09 because the task was scoped to `rangeIntersects`; the fix needs a policy decision
  (clamp `newLines` to the lines actually parsed, or drop the fallback and treat an empty hunk as
  covering nothing).

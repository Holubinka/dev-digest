# Insights — reviewer-core/

Failures and surprises specific to the review engine. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

_Nothing recorded yet._

## What Doesn't Work

### An assertion written in the implementation's own vocabulary cannot fail on the gap

**Symptom.** `test/prompt.test.ts` enumerated seven hostile attempts to close the `<untrusted>`
fence and all seven passed, while `</UNTRUSTED>`, `</Untrusted>`, `</untrusted >`, `</ untrusted>`,
`< /untrusted>` and `</untrusted\t>` reached the model verbatim. Found by review on 2026-08-16,
not by the suite.

**Cause.** `escapeUntrusted` matched the byte-exact literal `</untrusted>`, and the assertion that
checked it — `wrapped.match(/<\/untrusted>/g)` — was byte-exact too. Every fixture was lowercase,
so the escape and its test agreed with each other about a spelling the model does not care about.
The suite read as coverage of fence-breaking and could not fail on a single variant; a test shaped
like the code it guards proves the code is self-consistent, not that it is right.

**Fix.** Write the assertion in the ATTACKER's vocabulary, not the implementation's — here
`/<\s*\/\s*untrusted\s*>/gi` against a rule that is now `content.replace(/<\s*\/\s*untrusted\s*>/gi,
'<\\/untrusted>')`. Verify by running the new cases against the OLD body first: on 2026-08-16 that
took one temporary revert and showed 9 red / 7 green, which is the only evidence that a new case
tests anything. It stays a delimiter rule and never becomes a keyword blocklist (`AGENTS.md`) —
what widened is which spellings of OUR fence are recognised, not the vocabulary being scanned for.

## Codebase Patterns

### `pnpm build` produces no output

**Symptom.** You run the build, it succeeds, and `dist/` never appears.

**Cause.** Not a bug. `build` is aliased to `tsc --noEmit` on purpose — this package is
consumed as TypeScript source through a path alias, so emitting JavaScript would create
a second, stale copy.

**Fix.** Nothing. If you need to verify consumers still compile, run the server's
`pnpm typecheck` instead.

### `escapeUntrusted` may now SHRINK its input, not only grow it

**Symptom.** Nothing yet — this is the trap the next optimisation walks into.

**Cause.** Since 2026-08-16 the rule normalises every spelling of the fence to the one escaped
form, so `< / untrusted >` (15 code points) ships as `<\/untrusted>` (13). Worst-case GROWTH is
unchanged at 12 → 13 (+8.3%), which is the figure `server/INSIGHTS.md` quotes, but the transform
is no longer monotone.

**Fix.** Never assume `escapeUntrusted(x).length >= x.length`. The budget contract is unaffected
because `server/src/modules/brief/helpers.ts` measures the ESCAPED form and ships it; the property
it actually rests on is idempotence, and that survives because the replacement's `<` is followed by
`\` where the pattern demands `/`, so a rewrite can never re-match. Checked on 2026-08-16 over
200 000 generated strings drawn from `< > / \ ␣ \t \n untrusted` fragments: zero non-idempotent,
zero residual fences.

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

### A verbatim, correctly-copied MULTI-LINE quote was silently dropped 100% of the time since the quote feature shipped

**Symptom.** Investigating Performance Reviewer's near-zero recall (2026-08-24), a diagnostic
script that called `reviewPullRequest` directly (bypassing the batch executor, which discards
`outcome.dropped` down to a bare count) showed the model repeatedly reporting a real, correctly
located finding — right file, right lines, and a `quote` that was, byte for byte, an exact copy of
3-4 real diff lines — and grounding dropping every one of them with `"the quote was not found
anywhere ... citation unverifiable"`.

**Cause.** `buildLineText` (`src/grounding.ts`) maps EACH new-side line number to its OWN single
line of text — `Map<number, string>`, one line per entry, by construction. `locateQuote` checked
`text.includes(q)` per entry: one line's text against the FULL quote. A quote spanning more than one
line necessarily contains an embedded `\n`, and a single line's text can never `.includes()` a
string that itself contains a newline — so ANY multi-line quote matched ZERO lines, always, on
every diff, for every agent, regardless of how exactly it was copied. Single-line quotes (the shape
every existing test used — see the 2026-08-23 entry above) worked fine and hid this completely; nothing
before this session had ever fed the gate a genuinely multi-line one. Verified live: the same case
run 4 times before the fix dropped 3/4 (one with the leading-whitespace-trimmed variant covered
below, two with the multi-line quote itself); the same case run 4 times after the fix kept 4/4.

**Fix.** Rewrote `locateQuote` to group `buildLineText`'s per-line map into CONTIGUOUS runs of
covered line numbers first (never joining across a gap between two hunks — a quote claiming two
lines are adjacent when 48 unrelated lines sit between them in the real file must not heal), join
each run's lines with `\n`, and search for the quote as a substring of the WHOLE run, mapping a hit
back to a `{start, end}` line range instead of a single line number. `groundFindings`'s healing now
sets `start_line`/`end_line` to that range rather than forcing both to the same point. Covered by
two new tests in `test/grounding.test.ts`: a real multi-line heal (falsified first — failed against
the pre-fix code with `dropped.length === 1`, passed after), and a same-shape quote that spans an
inter-hunk gap, which must still be rejected (guards against over-correcting the fix into joining
lines that were never actually adjacent).

**A related, separate contributor to the same symptom worth knowing**, found first and partly
addressed before the code bug was found: `Finding.quote` (`@devdigest/shared` contracts) had NO
`.describe()` — unlike `Review.score`, which does, and which is the ONLY field in this schema that
reached the model with any instruction about its meaning. A model given a field literally named
`quote` and zero guidance reasonably inferred "a representative excerpt", not "an exact substring",
and reliably produced quotes using `"..."` as an elision or dropping the first line's leading
whitespace — cosmetically different failures with the SAME root: nothing told the model the field
had to be copy-paste exact. Added a `.describe()` explaining the exact-copy requirement, the
`MAX_QUOTE_CHARS` ceiling (500, `src/grounding.ts:31`), and that a failed quote drops the whole
finding silently. This alone measurably reduced (not eliminated) the leading-whitespace variant of
the drop before the multi-line matching bug was found underneath it — worth doing on its own
merits, but not sufficient by itself, because it could not fix a matcher that structurally could
never succeed on a multi-line copy no matter how exact.

**Net effect, Performance Reviewer's 15-case eval set, `deepseek/deepseek-v4-flash`, 3 batches
before vs 3 after (same agent/prompt version, nothing else changed between them):** citation_accuracy
0%/0%/0% → 83.3%/66.7%/0%; recall 0%/14.3%/0% → 33.3%/20%/0%. Still noisy — this model drops to
fully silent on roughly 1 run in 3-4 regardless of any fix made this session — but the ceiling moved
for the first time all session, and this fix applies to every reviewing agent in production, not
just the one whose eval set happened to surface it.

## Session Notes

### 2026-08-03

- Added the wall-clock deadline above. It fired in production the same evening: Test
  Quality Reviewer went `failed` at 600s with `OpenRouter gave up on Review after 600s
  (1 attempt(s))`, where an hour earlier the same agent had sat in `running` indefinitely.
  The provider (OpenRouter, `deepseek/deepseek-v4-flash`) intermittently does not answer
  large prompts at all while `/models` and short completions stay fast — so this is not a
  bug to fix upstream, it is a condition to survive.

### 2026-08-23

- **A finding's line-range check can pass while the line is still wrong, when the wrong
  line sits in the same hunk as the right one.** `rangeIntersects` (`src/grounding.ts`)
  only asks "does any covered line fall in `[start_line, end_line]`" — a coarse,
  intentionally cheap check. Measured live on `gpt-4o-mini`: a finding cited line 9 for a
  secret that was actually on line 10, and passed grounding anyway, because both 9 and 10
  belong to the same hunk. The number was wrong; the gate said fine. Added `Finding.quote`
  (optional, `@devdigest/shared`) and a second check in `groundFindings`: when a finding
  carries a quote, `locateQuote` searches the diff's own text (re-derived from `raw`, not a
  new adapter dependency — `core stays pure`) for a covered line containing it. A unique
  match REPLACES the declared `start_line`/`end_line` — self-healing, not just filtering —
  because copying text turned out to be a task the model gets right far more often than
  counting lines: in the same live batch, the finding's `rationale` quoted line 10's exact
  text while its own `start_line` field said 9. A quote matching zero lines drops the
  finding (stronger signal than a bare wrong number — the model named text that is not in
  the diff at all); a quote matching more than one line falls back to the plain check,
  unchanged, since it cannot disambiguate on its own. Real result on the same 14-case eval
  set, same cheap model, same clean prompt, two repeats each: precision 9-14% before this
  existed → a stable 50%/50% after, once the prompt was also told to fill `quote`. This
  followed two prompt-only attempts at the identical underlying problem that both made
  metrics WORSE (see `specs/SPEC-05-eval-pipeline.md` D5a in the server package) — the
  pattern across all three: a cheap model spends attention/accuracy budget on whatever
  meta-task the prompt adds, and a schema field the model just has to copy into costs it
  far less than an instruction asking it to reason about correctness of its own output.
- **`scripts/prompt-sync.mjs`'s hand-written template-literal un-escaper didn't recognise
  `\\` (an escaped backslash) as its own token** — only `` \` `` and `\$`. It had never been
  exercised: no prompt before this one needed to show a literal backslash-then-backtick
  sequence (a worked example quoting a JS template literal that itself contains a
  backtick). Confirmed the drift it reported was a false positive by evaluating the real
  runtime string both ways (`npx tsx -e '...'` against the actual `SECURITY_REVIEWER_PROMPT`
  export vs. the `.md` file) before touching the script — they were already byte-identical;
  the *comparator*, not the content, was wrong. Fixed by checking for `\\` before `` \` ``/`\$`
  (order matters: checking backtick first desyncs the scan by one character on a
  four-character `\\\`` sequence).

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

- **Narrower scope per model call measurably raises recall on the categories it stays inside —
  validated 2026-08-23, not yet built.** After the quote-grounding and skill fixes plateaued
  `gpt-4o-mini` at 5 consistently-missed `must_find` cases (open redirect, two race conditions, a
  missing-auth endpoint, a data-exposure-via-logging case), a one-off test swapped Security
  Reviewer's system prompt for a narrow specialist scoped to exactly three categories
  (concurrency/TOCTOU, missing auth, sensitive-data exposure) and ran it against the same 14
  cases. Two of the four in-lane cases (`checkout.ts`, `server.ts`) passed for the first time all
  session; the other two (a TOCTOU in `simple-git.ts`, a race condition in `skills/service.ts`)
  still missed even narrowed. Out-of-lane cases were pooled-metric noise by construction (the
  specialist correctly reports nothing on SSRF/secrets/open-redirect, which is not what the pooled
  recall/precision on the full 14-case set means to measure) — the batch's pooled numbers from that
  run are not comparable to any other run in this file and were not recorded as a result.
  **Deliberately not built as a real capability**, on the human's explicit call: doing this for real
  means N model calls per review instead of one (cost), a way to express more than one prompt per
  agent (today `agents.system_prompt` is one column — a schema change), and it would change every
  real PR review by an agent using it, not just eval batches. Left as a validated hypothesis for
  whoever picks up multi-pass review next, not a half-built path in the executor.

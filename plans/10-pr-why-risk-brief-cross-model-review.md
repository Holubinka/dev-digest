# Cross-model review — `10-pr-why-risk-brief.md`

**Reviewed:** `plans/10-pr-why-risk-brief.md` (823 lines) against `specs/SPEC-02-pr-why-risk-brief.md`
**Reviewer:** `openai/gpt-5.3-codex` via OpenRouter — a different model family from the one that
wrote the plan (`claude-opus-5`), which is the whole point of the exercise.
**Date:** 2026-08-16 · **Input:** 40 670 prompt tokens · **Verdict returned:** FIX-FIRST

The reviewer was given the plan and the spec, and asked to find what is wrong or missing —
dropped requirements, steps that cannot work as written, cache-key correctness, whether the
token bound is actually enforced, whether grounding has a real mechanism, and tests that would
pass while the feature is broken.

Six findings came back. **Five hold, one does not.** Each was checked against the plan's own text
before being accepted; the verdict below is ours, not the reviewer's.

## Confirmed

### 1 · The allowed-refs set is built from inputs that may never have reached the prompt

*Reviewer: major. Confirmed — the sharpest finding of the six.*

`buildAllowedRefs(sources)` (plan step P2.4, line 427) assembles the grounding set from the **raw**
source objects: `pr_files` paths, blast files and endpoint labels, and `plan_refs` paths. But the
budget walk immediately above it (lines 420-426) may drop the linked issue, the PR text, **blast**,
or **intent** in reverse priority, and drops or truncates spec files against the remaining budget.

So a document that the budget walk threw away still contributes its path to the allowed set, and a
reference to it passes the membership test. AC-13 is explicit that the set is assembled *"з входу
**цього ж** виклику"* — from the input of this same call. As planned, it is assembled from what we
*considered* sending.

**Fix:** build the allowed set from the assembled input after the budget walk, not from the
candidate sources before it.

### 2 · The rate limit is keyed by IP, and the spec asks for per-workspace

*Reviewer: major. Confirmed — the planner had already flagged it as `assumed` (R32) and raised it
as its own recommendation #3, so this is two independent readers landing on the same gap.*

`@fastify/rate-limit` keys by IP by default. The spec's non-functional requirement is 20/min **per
workspace**, both paths together. These are different guarantees: IP keying lets one workspace
throttle another behind a shared address, and lets a distributed caller evade the limit entirely.
For a single-workspace local install the difference is invisible, which is exactly why it will
survive review and surface later.

**Fix:** a `keyGenerator` on the workspace, or an explicit, dated note in the plan that the
per-workspace bound is deliberately deferred and AC-32 is therefore only partly met.

### 3 · "History was truncated" is inferred from a count, which does not prove it

*Reviewer: major. Confirmed.*

`truncated = entries.length >= BRIEF_MAX_STATES` (P4 step 1). A PR with exactly 20 states has 20
entries and nothing evicted; the card would still tell the reader history was lost. AC-39 is about
disclosure, and a disclosure that fires when nothing happened is a false one.

**Fix:** derive truncation from the eviction actually performed, not from the size of the result.

### 4 · Nothing tests that the rate limit blocks a *paid call*

*Reviewer: major. Confirmed as a coverage gap.*

The test list covers the 429, but not the pairing that matters: once the limit is exceeded, the
model must not be called. A limiter wired after the compute path, or wired to the wrong route,
returns 429s and still spends money — and every test stays green.

**Fix:** one test asserting 429 **and** zero calls on the LLM mock.

### 5 · An unknown commit date is recorded as "not stale"

*Reviewer: minor. Confirmed.*

R25 hardcodes `intent_stale = false` when `pr_commits` has no row for the head SHA. Unknown is not
false. AC-25 exists to disclose staleness, and this reports confidence the system does not have.

**Fix:** a third state, or record the absence explicitly.

## Not confirmed

### The budget overflow strategy

*Reviewer: major — "drops whole blocks in priority order instead of enforcing a single cut-point
truncation on the first non-fitting input as AC-20/D9 requires."*

This is a misreading of the plan. AC-20 requires **both** behaviours, and the plan implements both:
the five fixed-ceiling blocks are dropped in reverse priority (lines 420-422), and the specs — the
only elastic input — go through `selectWithinBudget`, which stops at the first that does not fit
and truncates that first spec when it alone exceeds the remainder (lines 423-426). One cut point,
in the one place the spec puts it.

No change. Recorded here because a rejected finding is part of the review's result, and because the
next reader of the plan will have the same question.

## What this cost

One call, 40 670 input tokens, ~$0.30. It found one real correctness hole in the grounding
mechanism — the feature's central promise — that had survived a spec, a plan and a human read.

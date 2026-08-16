# Cross-model review — `11-pr-brief-overview-composition.md`

**Reviewed:** `plans/11-pr-brief-overview-composition.md` against `specs/SPEC-02-pr-why-risk-brief.md`
**Reviewer:** `openai/gpt-5.3-codex` via OpenRouter — a different model family from the one that
wrote the plan (`claude-opus-5`).
**Date:** 2026-08-16 · **Input:** 56 260 prompt tokens · **Verdict returned:** FIX-FIRST

Four findings. **All four hold**; the two majors were checked against the plan's own text before
being accepted, and both are requirement loss rather than style.

This is the second cross-model pass on this feature. The first
(`10-pr-why-risk-brief-cross-model-review.md`) found a grounding hole that turned out to name a
class with five instances. This one found something different in kind: **two requirements that the
plan intends to keep and would have lost anyway.**

## Confirmed

### 1 · The review-focus display limit was dropped

*Reviewer: major. Confirmed.*

`## Non-functional requirements` in the spec is explicit: review focus shows **up to 10 rows, the
rest behind a disclosure**, with the section's count badge always showing the full length so the
truncation is never silent.

The plan builds a disclosure for **risks** — "Five rows visible, the rest behind one more
disclosure carrying the hidden count" (P4 step 2) — and then, for `ReviewFocusSection` (P4 step 5),
renders "Each row: `BriefRef` then the reason, **always visible**". The count badge is there; the
limit is not.

The failure mode is exactly the one the badge exists to prevent, only inverted: nothing is hidden,
so nothing is under-reported, but a long list expands the one full-width block on the page and the
"read these first" ordering stops being scannable at precisely the moment it matters most.

**Fix:** apply the same disclosure shape the risk rows already get, at the spec's number.

### 2 · A gate stated as "as round one did", in code round one deletes

*Reviewer: major. Confirmed, and the mechanism is worth recording.*

AC-27 forbids building a link against `head_sha` when `link_sha` is null. Round one implemented it
in `PrBriefCard/PrBriefCard.tsx` — `FileRef` renders a control only when `linkSha != null`.

Plan step P4.1 **deletes `PrBriefCard/` including its test**. Step P4.4 then specifies `BriefRef`
and says a risk reference "links to `githubBlobUrl(repo, linkSha, path, line)` **as round one
did**", gating explicitly only the `:line` suffix on `indexMatchesHead && linkSha != null`.

So the plan points at behaviour for its definition, in a file the same plan removes, for an agent
that starts cold. The intent is right and the instruction is unfollowable: there is nothing left to
copy, and the deleted test that would have caught the omission goes with it.

**Fix:** state the gate in the step. A behaviour worth keeping is worth spelling out at the moment
its previous home is deleted — "as X did" is a reference, and a plan that deletes X has no
referent.

### 3 · `?line=` is parsed loosely

*Reviewer: minor. Confirmed.*

`Number.parseInt` accepts `12abc` as `12` and has no upper bound, against a `## Constraints` rule
the plan itself quotes about parsing and bounding query params.

### 4 · "Newest first" has no defined ordering source

*Reviewer: minor. Confirmed.*

P4 step 6 picks the current-head review "newest first" without saying whether the order comes from
the API or a client sort key. If the API order is incidental, the banner can show a different one
of two same-`head_sha` reviews between loads, and no test would fail.

## What this pass cost

One call, 56 260 input tokens, ~$0.40. It found two requirements that would have shipped missing —
one of them because a plan cited code it was also deleting, which is a shape no gate and no
single-document reader can catch.

# L04 — findings on the Pull Requests list

**Status:** in progress, 2026-07-28. Follow-up to
[`../client/specs/L03-findings-severity-filter.md`](../client/specs/L03-findings-severity-filter.md),
which put the same counts on the PR detail page.

## Problem

The list answers "how big, how good, how much, how old" — `SIZE`, `SCORE`, `COST`,
`UPDATED` — but says nothing about what the reviewers actually found. A reviewer scanning
seven PRs cannot tell which one has a blocker without opening each in turn. The severity
breakdown exists per PR one click away; the list is where the triage decision is made.

## Approach

A `FINDINGS` column between `SCORE` and `STATUS`: one chip per severity, worst first, and a
hover card listing up to three of the findings behind those numbers.

```
PULL REQUEST            AUTHOR      SIZE     SCORE   FINDINGS        STATUS
Add rate limiting …     marisa.koch M · 285    61    ⊙1  ⚠1  💡0    Needs review
  #482                                          └──── hover ────┐
                                    ┌───────────────────────────┴──────────────┐
                                    │ ⊙ 2 findings                             │
                                    │ ⊙ Hardcoded Stripe secret key   security │
                                    │   src/config.ts:12         ● 98% conf    │
                                    │   Line 12 contains a literal sk_live_ …  │
                                    │ ⚠ N+1 query in user list endpoint  perf  │
                                    │   src/api/users.ts:45-52   ● 86% conf    │
                                    └──────────────────────────────────────────┘
```

The card is read-only. Clicking the row keeps doing what it does today: open the PR.

### What the numbers mean

Counts cover **every run on the PR**, not just the latest review, so the list and the
detail-page severity bar can never disagree. This follows `COST` (cumulative across runs)
rather than `SCORE` (latest-wins): a score is a state, findings and spend accumulate.

### Two empty states, deliberately different

| Situation | Cell |
|---|---|
| Reviewed, nothing found | `⊙0 ⚠0 💡0`, dimmed — the agents ran and the PR is clean |
| Never reviewed | `—`, as `SCORE` and `COST` already render with no data |

This matters more than it looks. On this workspace the agents approve nearly everything
they are pointed at, so `0 · 0 · 0` is the column's *normal* state, and it has to read as a
real answer rather than as a broken widget. Nothing is seeded or inserted to make the
column look busier: the mock in the course materials shows `2 · 2 · 2`, and the running app
shows whatever the `findings` table holds.

Before building the column we confirmed the write path is not the reason the numbers are
low: `grounding` is recorded as `kept/(kept+dropped)` and every real run stored `0/0
passed` — nothing reached the citation gate and nothing was dropped by it — while
`server/test/reviews.it.test.ts` drives a full run whose model *does* return a finding and
asserts it persists. The agents genuinely have nothing to say about these PRs.

### Where the card's data comes from

With the list payload, not a request on hover. The list endpoint already computes a score
map and a cost map per PR; a third map carries the counts plus at most three compact
findings, ordered CRITICAL → WARNING → SUGGESTION then by confidence, with the rationale
truncated server-side. Hover stays instant and the payload grows by a bounded amount.

## Decisions and their alternatives

**Extend `PrMeta` rather than adding a second endpoint.** A `GET /pulls/:id/findings?limit=3`
called on hover would keep the list payload minimal, but it trades a fixed, bounded cost for
a request per hover and a spinner inside a tooltip. The list is small and already refetches
every 60s.

**`position: fixed` for the card, placed from the trigger's rect.** `AppFrame` gives
`<main>` `overflow: auto`, so an absolutely-positioned card is clipped at the container
edge — most visibly on the last row, which is exactly where a PR list gets long.

**Hover *and* focus.** A hover-only affordance is invisible to the keyboard. The cell is
focusable and opens the card on focus.

**Reuse `rollupSeverities`.** `server/src/modules/pulls/status.ts` already tallies
severities and is already unit-tested; the new work is the ordering/limit helper beside it.

## Acceptance criteria

- The column sits between `SCORE` and `STATUS` and shows a chip per severity with counts
  from the `findings` table, matching the severity bar on that PR's detail page.
- Hovering or focusing a cell with findings opens a card headed by the true total and
  listing at most three of them; a cell with none opens nothing.
- A reviewed PR with no findings reads `0 · 0 · 0`; a PR never reviewed reads `—`.
- The card is not clipped on the bottom row of a long list.
- The two vendored `shared/` copies stay identical after the contract change.
- Unit tests cover the ordering/limit helper on the server and the cell's three states on
  the client.

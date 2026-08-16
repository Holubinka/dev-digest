# L03 — findings severity counters and filter on the PR page

**Status:** implemented 2026-07-28.

Implemented as specified, with one addition found during the build: an accordion holding a
match opens itself while a filter is active, because a collapsed one made the filter look
inert.

The same counts on the Pull Requests list are a separate, cross-package spec:
[`../../plans/L04-findings-on-the-pr-list.md`](../../plans/L04-findings-on-the-pr-list.md).

## Problem

The PR-detail "Agent runs" tab lists findings grouped by review run —
`FindingsTab` → `ReviewRunAccordion` → `FindingsPanel` → `FindingCard`. Nothing on the
page answers the first question a reviewer asks: *how bad is this PR?* The severity of a
finding is visible only on the card itself, so a PR with four runs has to be expanded
accordion by accordion and read card by card before you know whether there is a single
blocker in it.

There is also no way to look at one severity at a time. The only filter in the panel
toolbar is "Hide low confidence", which cuts across severities rather than along them.

## Approach

A PR-level bar above **Review runs** that both counts and filters.

```
⚠ REVIEW RUNS                              grouped by run · newest first
┌────────────────────────────────────────────────────────────────────┐
│ [⊙ 3 CRITICAL]  [⚠ 5 WARNING]  [💡 2 SUGGESTION]                   │
└────────────────────────────────────────────────────────────────────┘
   ▸ Security Reviewer      request changes   3 findings · 2 blockers
   ▸ Performance Reviewer   comment           2 findings
   1 run without CRITICAL findings hidden          (only while filtered)
```

Counts aggregate every finding of every run on the PR. Clicking a level selects it and
the findings lists below show only that severity; clicking the selected level again
clears the filter.

Client-only work. `severity` is already on the `Finding` contract
(`CRITICAL | WARNING | SUGGESTION`, `vendor/shared/contracts/findings.ts:11`) and every
finding already reaches the page — no endpoint, contract or migration changes.

### Where the state lives

In the URL, as `?sev=<LEVEL>`, alongside the `?tab=` and `?trace=` params the page
already manages through its `setParam` helper. A filtered view survives a reload and can
be pasted to someone else.

### What the filter touches

| Layer | Behaviour |
|---|---|
| `SeverityFilterBar` | Counts all findings on the PR; one button per level |
| `FindingsTab` | Hides runs with no finding at the selected level, and says how many it hid |
| `ReviewRunAccordion` | Opens when a filter is applied; its header keeps the run's own totals |
| `FindingsPanel` | Renders only findings at the selected level, on top of hide-low-confidence |

Accordions open on filter because a collapsed accordion would make the filter look
inert. Hidden runs are counted in a muted line rather than silently dropped, so a run
disappearing is explained rather than mysterious.

## Decisions and their alternatives

**PR-level, not per-run.** The `FindingsPanel` toolbar has a slot for exactly this — an
unused `divider` style and an empty state reading "Adjust the filters above" — but chips
placed there would repeat per run and could never show a PR total. The bar is the total;
the runs stay the grouping.

**All three levels always render.** A level with no findings is dimmed and disabled
rather than dropped. The row keeps a stable width across re-runs, and "0 CRITICAL" is
information a reviewer wants.

**Counts bucket only known severities.** `SEV` in `vendor/ui/primitives/tokens.ts`
defines four keys and `SeverityBadge` dereferences it without a fallback, so an
unexpected value in the `findings.severity` column (plain `text`, not an enum) takes the
whole route down — recorded in `../INSIGHTS.md`. The counting helper ignores anything
outside the three contract levels, so a bad row costs one uncounted finding instead of
the page.

**Severity is a second, independent filter, not a replacement.** It composes with the
existing hide-low-confidence toggle instead of superseding it: a reviewer narrowing to
CRITICAL still wants the confidence cut they already chose.

## Acceptance criteria

- The bar shows `N CRITICAL · N WARNING · N SUGGESTION` for the whole PR, and the numbers
  match the cards rendered below it.
- Clicking a level shows only that level's findings across every run; clicking it again
  restores all of them.
- The selected level is in the URL and survives a reload.
- A level with zero findings is visibly inert and cannot be selected.
- A finding with a severity outside the three levels is not counted and does not throw.
- Unit tests cover the counting helper, the three interaction paths (select, clear,
  disabled) and the filtered `FindingsPanel`.

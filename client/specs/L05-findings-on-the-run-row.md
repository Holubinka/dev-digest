# L05 — findings by severity on the timeline's run row

**Status:** implemented 2026-07-30.

Implemented as specified. One adjustment surfaced while writing the plan: `FindingsCell`'s
four `shortPath` unit tests moved to the shared helper's own file, because the function
moved with it — the eight behaviour tests that actually guard the refactor are unchanged.
The extraction removed 221 lines and added 22.

Completes the pair started by
[`L03-findings-severity-filter.md`](L03-findings-severity-filter.md) (severity on the PR
page) and [`../../specs/L04-findings-on-the-pr-list.md`](../../specs/L04-findings-on-the-pr-list.md)
(severity on the list). Both landed; the run row between them did not.

## Problem

The PR page now answers *how bad is this PR?* with the counter bar above **Review runs**,
and the Pull Requests list answers it per PR with the FINDINGS column. In between sits
the Timeline, where each `agent_runs` row still reads:

```
[reviewed] (85) Security Reviewer  openai/gpt-5
                3 finding(s) · 1 blockers
```

Plain text, one number. Comparing two runs of the same PR — the whole point of keeping a
timeline — means reading prose in one place and coloured chips in two others, and the
prose does not say *what kind* of findings the run produced. A run that found three
suggestions and one that found three criticals are indistinguishable until you open an
accordion.

The severity data is already in the browser. `FindingsTab` receives `reviews` with each
run's full `findings` array and already joins it to the timeline rows by `run_id` to
attach cost (`FindingsTab.tsx:78`). Nothing is missing but the rendering.

## Approach

Replace the text line with the same chip vocabulary the other two screens use, plus a
hover/focus card scoped to that one run.

```
⚡ TIMELINE                                    runs & commits · newest first
┌──────────────────────────────────────────────────────────────────────┐
│ [approved] (95) General Reviewer   openai/gpt-5                      │
│                 ⊙ 0   ⚠ 0   💡 0                    12:04    $0.03   │
├──────────────────────────────────────────────────────────────────────┤
│ [rejected] (42) Security Reviewer  openai/gpt-5                      │
│                 ⊙ 1   ⚠ 2   💡 4    │ ⛨ 1          11:58    $0.05   │
└──────────────────────────────────────────────────────────────────────┘
                  └─ hover / focus ─┐
        ┌──────────────────────────────────────────┐
        │ ⚠ 7 FINDINGS IN THIS RUN                 │
        │ [CRIT] SQL injection in query      [sec] │
        │ server/db.ts:42                  conf .91│
        │ Unescaped request input reaches the …    │
        │ [WARN] Missing null check          [bug] │
        └──────────────────────────────────────────┘
```

Client-only work. No endpoint, contract or migration changes — the same conclusion L03
reached, for the same reason.

The trigger is the chip group itself, not the row: the row is already a click target for
the agent name, the trace icon and delete, and anchoring the card to the whole row would
fire it on every one of those. The group takes one tab stop per run.

### What each row shows

| Run state | Row shows |
|---|---|
| `running` / `failed` / `cancelled` | unchanged — no chips; a failed run keeps its error line |
| settled, review present, findings > 0 | three chips + card on hover/focus |
| settled, review present, findings = 0 | three dimmed zeros, no card |
| settled, review **absent** from the payload | falls back to today's `N finding(s)` text |

The last row is the one worth stating twice. `findings_count` is denormalized onto the
run; the per-severity split exists only on the review. When the review is missing,
rendering `0 · 0 · 0` would assert the run was clean rather than admit the breakdown is
unknown. The fallback keeps the row honest.

### Blockers

`blockers` stays a separate chip, shown only when above zero, visually divided from the
severity group. It is not a severity subset: the server computes it as
`countBlockers(keptFindings, agent.ciFailOn)` (`server/src/modules/reviews/run-executor.ts:240`),
so it depends on the agent's CI gate. Two runs with identical severity counts can differ
in blockers, and the row has to be able to say so.

## Structure

`FindingsCell` on the list already implements chips + positioned card. `FindingRecord`
extends `Finding`, which is structurally a superset of `ListFinding`
(`vendor/shared/contracts/platform.ts:161`), so one card renders both sources unchanged.

```
client/src/components/findings-preview/     new — shared, presentational
    FindingsPreview.tsx    chips, anchor maths, card; no i18n, no PrMeta/RunSummary
    styles.ts              moved from FindingsCell/styles.ts
    helpers.ts             shortPath, lineRef — moved from FindingsCell/helpers.ts
```

Props: `counts` (worst first), `findings` (already ordered and capped), `header` and
`ariaLabel` (the consumer translates), and `extra` — a slot after the chips where the run
row puts its blockers chip.

Two thin adapters consume it: `FindingsCell` maps `FINDINGS_FIELDS` and `pr.findings_top`
and keeps its never-reviewed `—` rule; a new `RunFindings` derives counts from
`FindingRecord[]`. `FindingsTab` builds a `Map<run_id, FindingRecord[]>` and passes it to
`RunHistory`, which stays presentational.

Counts come from the existing `countBySeverity`
(`SeverityFilterBar/helpers.ts`), not a second implementation — see the decision below.
Preview order and cap mirror the server's `topFindings` (`server/src/modules/pulls/status.ts:71`):
worst severity first, then most confident, capped at 3. Rationales are not truncated
here; the card already clamps them to two lines in CSS.

## Decisions and their alternatives

**Extract the shared component rather than copy it.** A second card would duplicate
~160 lines of markup, styles and path-eliding helpers, and the two would drift at the
first edit. The refactor touches `FindingsCell`, which shipped two days ago — its
existing `FindingsCell.test.tsx` must pass unmodified, which is what makes the change
safe to make rather than a reason to avoid it.

**Chips display, they do not filter.** Making them set `?sev` would sync the row with the
bar below, but the run row already carries three click targets (agent name, trace, delete)
and a fourth through seventh would make it a minefield. The filter has a home; this is a
readout.

**Zeros render, dimmed.** Same reasoning L03 used for the bar and L04 used for the
column: a stable chip column can be compared down the timeline at a glance, and "this run
found nothing" is a result worth showing. Dropping the chips would make them jump between
rows.

**Counts bucket only known severities.** Reusing `countBySeverity` is not merely DRY. `SEV`
in `vendor/ui/primitives/tokens.ts` has no fallback, so a `findings.severity` value
outside the contract — the column is plain `text` — takes the whole route down. That
already cost a debugging session and is recorded in [`../INSIGHTS.md`](../INSIGHTS.md).
A private tally in the new component would reintroduce the crash.

**Presentational, not i18n-aware.** `FindingsPreview` takes rendered strings instead of
message keys, because the two consumers want different headers ("N findings" on the list,
"N findings in this run" here). Keeping `next-intl` out of it also keeps its test free of
a provider wrapper.

## Acceptance criteria

- A settled run row shows `N CRITICAL · N WARNING · N SUGGESTION` for that run alone, and
  the numbers match the cards inside that run's accordion below.
- Hover or keyboard focus opens a card listing that run's worst three findings; blur and
  mouse-out close it. A run with no findings opens nothing.
- The blockers chip appears only when `blockers > 0` and is visually separate from the
  severity chips.
- Running, failed and cancelled rows are unchanged, and a failed run still shows its error.
- A settled run whose review is not in the payload keeps the old text line instead of
  showing zeros.
- A finding with a severity outside the three levels is not counted and does not throw.
- The eight `FindingsCell` behaviour tests pass byte-identical — they are the refactor's
  guard. Its four `shortPath` unit tests move to the shared helper's own test file,
  because the function moves with it; that is the only edit the file may receive.
- New unit tests cover `FindingsPreview` (chips, dimmed zeros, focus/blur, empty preview,
  `extra` slot), `RunFindings` (derived counts, blockers threshold, preview order) and the
  four `RunHistory` row states above.

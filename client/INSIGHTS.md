# Insights — client/

Failures and surprises specific to the web app. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

### A filter above collapsible accordions needs two extra behaviours or it reads as broken

A control that narrows the findings lists — the severity bar added on 2026-07-28 in
`_components/SeverityFilterBar/` — sits above `ReviewRunAccordion`s that are collapsed by
default (only the first run opens). Filtering alone changes nothing the reviewer can see.

Two additions make it legible, both cheap:

1. **Auto-open on an active filter.** A three-line `useEffect` in
   `ReviewRunAccordion.tsx` (`if (severity) setOpen(true)`), mirroring the existing
   `targetRunId` effect right above it.
2. **Hide runs with no match, and say so.** `runsWithSeverity` in
   `_components/FindingsTab/helpers.ts` drops them, and a muted line reports the count —
   a run vanishing with no explanation reads as a bug.

The filter state itself belongs in the URL via the page's existing `setParam` helper
(`page.tsx:62`), next to `?tab` and `?trace`, so a reload keeps it. Reuse this shape for
the next cross-run control rather than adding per-accordion state.

## What Doesn't Work

### A popover anchored inside a PR-list row gets clipped

**Symptom.** A hover card positioned with `position: absolute` inside a table row is cut off
— worst on the last row, which is where a long list is read.

**Cause.** `vendor/ui/shell/AppFrame.tsx:29` gives `<main>` `overflow: auto`, so it is the
scroll container and clips descendants at its box.

**Fix.** Position the card `fixed` and compute `top`/`left` from the trigger's
`getBoundingClientRect()` on open, flipping above the row when
`rect.bottom + cardHeight > window.innerHeight`. `_components/FindingsCell/FindingsCell.tsx`
does this in ~10 lines and needs no portal.

### Adding a column to the PR list without re-cutting the others

**Symptom.** The PULL REQUEST title collapses to `A…` at a 1200px window after a new column
lands, even though every other cell looks fine.

**Cause.** `GRID` in `pulls/constants.ts` gives the title `1fr` and everything else a fixed
width, so a new fixed column is paid for entirely by the title. Adding 124px took it from
192px to 104px — measured, not guessed:
`[...row.children].map(k => k.getBoundingClientRect().width)`.

**Fix.** Re-cut the fixed columns to their content when adding one. The 2026-07-28 pass took
the gap from 14 to 12 (now `GRID_GAP`, shared by `row` and `headRow`) and trimmed five
columns, which bought the title back to 160px on the same window.

## Codebase Patterns

### Run-level data reaches the PR-detail subtree by joining in `FindingsTab`, not by widening `ReviewRecord`

**Symptom.** You need something that lives on the run row (cost, tokens, duration) inside
a component that only receives a `ReviewRecord` — `ReviewRunAccordion`, `VerdictBanner` —
and the obvious move is to add the field to the review contract on the server.

**Cause.** A review and its run are separate rows joined by `run_id`; `ReviewRecord`
deliberately carries no run telemetry.

**Fix.** Don't widen the contract. `FindingsTab` already receives **both**
`runs: ReviewRecord[]` and `prRuns: RunSummary[]`, so build
`new Map(prRuns.map(r => [r.run_id, r]))` and pass the matched `RunSummary` down. This is
how the verdict plaque got its cost badge on 2026-07-28 — zero server changes, zero
contract churn. Check that map before touching `server/src/vendor/shared`.

## Tool & Library Notes

### A component test fails on `ResizeObserver is not defined`

**Symptom.** A chart or layout-aware component throws in jsdom.

**Cause.** jsdom does not implement `ResizeObserver`.

**Fix.** The polyfill is already registered in `src/test/setup.ts`. If a new test file
misses it, confirm the setup file is still wired through `vitest.config.ts`.

## Recurring Errors & Fixes

### An unexpected `severity` value takes down the whole findings page

**Symptom.** The PR detail page renders only a Next.js error overlay:
`Cannot read properties of undefined (reading 'icon')` at
`src/vendor/ui/primitives/Badge.tsx:62` → `SeverityBadge` → `FindingCard`.

**Cause.** `SEV` in `src/vendor/ui/primitives/tokens.ts` defines exactly four keys —
`CRITICAL`, `WARNING`, `SUGGESTION`, `INFO` — and `SeverityBadge` does
`const s = SEV[severity]; const I = Icon[s.icon];` with no fallback. Any other value in
`findings.severity` (the DB column is plain `text`, not an enum) dereferences `undefined`
and takes the whole route down rather than degrading to one bad badge. Hit on 2026-07-28
by hand-writing a fixture row with `severity='MAJOR'`.

**Fix.** Use only the four values when seeding or hand-writing findings. If a row is
already wrong:
`docker exec devdigest-postgres psql -U devdigest -d devdigest -c "UPDATE findings SET severity='WARNING' WHERE severity NOT IN ('CRITICAL','WARNING','SUGGESTION','INFO');"`.
`STATUS_META` and `VERDICT_META` guard their lookups with `?? default`; `SEV` does not.

### A field from the API arrives `undefined` with no error anywhere

**Symptom.** A component renders blank or crashes on `.map` of `undefined`, while the
network tab shows the request succeeded.

**Cause.** `src/lib/api.ts` types responses through generics but never calls `.parse()`.
The declared TypeScript type is an assertion, not a check, so a server response that no
longer matches passes straight through to the component.

**Fix.** When a shape looks wrong, compare against the server's Zod contract rather than
trusting the client type. If the mismatch is structural, fix the contract; if you need a
guarantee at the boundary, validate explicitly at the call site.

### A shared contract differs from the server's copy

**Symptom.** A union type or interface has a member on the server that TypeScript
insists does not exist here — or the reverse.

**Cause.** `@devdigest/shared` is vendored separately into each package with nothing
syncing them, and type-checking cannot see the difference. The copies drifted once
already (resynced 2026-07-27).

**Fix.** `server/src/vendor/shared/` is the source of truth, since `reviewer-core`
aliases it. Port the change and verify with
`diff -r ../server/src/vendor/shared src/vendor/shared`. The `shared-sync` CI gate
enforces this on every change to either copy.

Read the diff before overwriting — last time, this package held the better version of
`contracts/trace.ts`, and a blind copy would have thrown it away.

### The `borderColor` / `borderLeftColor` console error on the PR page is not yours

**Symptom.** Working anywhere near the findings list, the console shows: *"Updating a
style property during rerender (borderColor) when a conflicting property is set
(borderLeftColor) can lead to styling bugs."* It appears without any interaction on a
page with several findings, so it looks like whatever you just added caused it.

**Cause.** `_components/FindingCard/styles.ts:10-13` sets `borderColor` **and**
`borderLeftColor` on the same element. The comment above them says the `border` shorthand
was deliberately avoided, which is true but not sufficient — `borderColor` is itself a
shorthand for the four side colours, so React still warns whenever the value changes.
`borderColor` changes on every focus move, i.e. every `j`/`k` press in `FindingsPanel`.

**Fix.** Nothing to fix in your change. Confirmed pre-existing on 2026-07-28 by stashing
the whole feature (`git stash push -u -- client/`), reloading, pressing `j`, and watching
the same error appear. If you do want it gone, replace `borderColor` with the three
explicit sides (`borderTopColor` / `borderRightColor` / `borderBottomColor`).

## Session Notes

### 2026-07-28

- Added the PR-level severity counter bar (`3 CRITICAL · 5 WARNING · 2 SUGGESTION`) that
  doubles as a filter: `_components/SeverityFilterBar/`, wired through `FindingsTab` →
  `ReviewRunAccordion` → `FindingsPanel`, state in `?sev=`. Client-only — `severity` was
  already on the `Finding` contract, so no server or vendored-`shared` change (verified
  with `diff -r ../server/src/vendor/shared src/vendor/shared`).
- `visibleFindings` in `_components/FindingsPanel/helpers.ts` took a third parameter
  rather than gaining a second filter function; severity and hide-low-confidence compose.
- The `FindingsPanel` toolbar's unused `divider` style and its "Adjust the filters above"
  empty state are leftovers from the original design port, not a removed feature —
  checked the history, `FindingsPanel/` arrives complete in the `587c46a` snapshot. The
  new bar deliberately sits above **Review runs** instead, so the counts are per PR.
- Verified against the two seeded findings on #482, so the zero state got exercised for
  free: the bar reads `1 CRITICAL · 1 WARNING · 0 SUGGESTION` and the empty chip is dimmed
  and unclickable. Freshly generated findings were not available — see the root
  `INSIGHTS.md` on reviews that approve everything.
- Same counts then went onto the PR list as a `FINDINGS` column with a hover card
  (`_components/FindingsCell/`, spec `specs/L04-findings-on-the-pr-list.md`). That half
  needed the server: `PrMeta` gained `findings_critical/warning/suggestion` plus a 3-item
  `findings_top`, mirrored into both vendored `shared/` copies.
- The column's normal state on this workspace is `0 · 0 · 0`, because the agents approve
  everything they are pointed at. Zero and "never reviewed" are rendered differently on
  purpose — treat a row of zeros as a working column, not a broken one.

## Open Questions

- Should the accordion header keep showing the run's own totals (`5 findings`) while a
  severity filter is active, or switch to `2 of 5`? Left as totals on 2026-07-28 — the
  header describes the run, not the current view — but it does read oddly next to a
  shorter list.

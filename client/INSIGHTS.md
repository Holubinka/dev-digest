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

### A repo path in a fixed-width card pierces its border

**Symptom.** A file citation runs straight through the right edge of the findings hover
card — reported on 2026-07-28 for
`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`.

**Cause.** Two things at once. A flex item will not shrink below its content unless
`min-width: 0` is set on it *and* its container, so `text-overflow: ellipsis` never engages.
And even once it does, CSS elides from the **right**, throwing away the filename — the only
part of a path worth reading in a preview.

**Fix.** `_components/FindingsCell/`: `minWidth: 0` on the meta row and the path span, then
`shortPath()` in `helpers.ts` elides from the left at a folder boundary
(`…/_components/FindingsPanel/FindingsPanel.tsx`). Keep `:30-45` in its own
`flexShrink: 0` span or it is the first thing CSS eats, and put the untruncated path in
`title` so it stays reachable.

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

### `blockers` on a run is not a severity bucket and cannot be derived on the client

**Symptom.** You are building a severity readout for a run and it looks like `blockers`
is redundant — surely it is just the CRITICAL count, or CRITICAL + WARNING.

**Cause.** The server computes it as `countBlockers(keptFindings, agent.ciFailOn)`
(`server/src/modules/reviews/run-executor.ts:240`). It is the agent's own CI gate
threshold, configured per agent, denormalized onto the run row at completion. Two runs
over the same PR with identical severity counts can report different `blockers`.

**Fix.** Show it as its own thing, sourced from `RunSummary.blockers` — never recompute it
from findings. `RunFindings` (2026-07-30) renders it as a separate chip behind a divider
for exactly this reason.

### `FindingRecord` is structurally a superset of `ListFinding`, so one card renders both

`ListFinding` (`vendor/shared/contracts/platform.ts:161`) is the trimmed, rationale-
truncated shape the PR *list* ships; `FindingRecord` extends `Finding`, the full record the
PR *detail* endpoints ship. Every `ListFinding` field exists on `FindingRecord` with a
narrower or equal type (`severity` is a literal union where the other is `string`), so a
component typed against `ListFinding[]` accepts `FindingRecord[]` with no cast and no
contract change. This is what let `FindingsPreview` serve both the list column and the
timeline's run row on 2026-07-30. Check this before widening either contract to match.

## Tool & Library Notes

### A component test fails on `ResizeObserver is not defined`

**Symptom.** A chart or layout-aware component throws in jsdom.

**Cause.** jsdom does not implement `ResizeObserver`.

**Fix.** The polyfill is already registered in `src/test/setup.ts`. If a new test file
misses it, confirm the setup file is still wired through `vitest.config.ts`.

### The editor's `Cannot find module './X'` under a bracketed route path can be a lie

Seen twice on 2026-07-30: the TS language server flagged
`Cannot find module './FindingsCell'` in
`src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.test.tsx` while both
`pnpm exec vitest run` and `pnpm exec tsc --noEmit -p tsconfig.json` were clean, on a file
that had not been touched. Do not start deleting imports or adding path aliases over it.
`tsc` is the arbiter here; run it before believing a resolve error under `[repoId]` or
`[number]`.

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

**Correction, 2026-07-30 — this is now fixed; the entry above stands as the diagnosis.**
`s.card` sets all four colours and all four widths per side. `borderWidth` went too: it is
the same shorthand/longhand mix as `borderColor`, silent only because neither width ever
changed — making one conditional would have brought the warning straight back.
`borderStyle` stayed, because no per-side style longhand is set for it to conflict with.
Guarded by four tests in `FindingCard.test.tsx` asserting the style object carries no
`border`, `borderColor` or `borderWidth` key.

Reproduce it (it does **not** fire on load — the shorthand has to *change*): open an
accordion holding two or more findings, then press `j`. One finding is not enough —
`focusIdx` is clamped to `shown.length - 1`, so it never moves and nothing rerenders.

Note when checking the fix in DevTools: the serialized `style` attribute reads
`border-width: 1px 1px 1px 3px`. That is the browser's CSSOM collapsing four longhands
back into a shorthand for display — not React writing one. Read the style object, not the
attribute.

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
- Then DevDigest reviewed its own PR #2 and returned three real findings, the first
  non-empty run on this workspace (see the root `INSIGHTS.md` correction). Two were worth
  acting on and are fixed in this branch: `focusIdx` in `FindingsPanel` now clamps when a
  filter shrinks the list, and the list's findings query no longer narrows by
  `reviews.kind`. The third (surrogate pairs in the server-side rationale truncation) was
  also real and fixed. The reviewer's claim that `shown[focusIdx]` would *crash* was wrong
  — `FindingsPanel.tsx:47` already guards it — but the stale index was real.

### 2026-07-30

- The timeline's run row now shows severity chips plus a hover/focus card scoped to that
  one run (`_components/RunFindings/`, spec `specs/L05-findings-on-the-run-row.md`).
  Client-only: `FindingsTab` already had the reviews and already joined them to runs by
  `run_id`, so the map that feeds it is the mirror image of the run→review map recorded
  above under Codebase Patterns. No endpoint, contract or vendored-`shared` change.
- The chips + hover card were lifted out of `FindingsCell` into
  `src/components/findings-preview/` rather than copied. The extraction removed 221 lines
  and added 22. What made it safe to do to two-day-old code was that `FindingsCell` had
  eight behaviour tests — they passed byte-identical and are what proves the list did not
  change. Only the four `shortPath` unit tests moved, because the function did.
- Kept `FindingsPreview` free of `next-intl`: it takes already-translated `header` and
  `ariaLabel` strings. Its test needs no `NextIntlClientProvider`, and the two consumers
  can word the card header differently ("2 finding(s)" vs "4 finding(s) in this run").
- A settled run whose review is missing from the payload keeps the old plain-text count
  instead of rendering `0 · 0 · 0`. `findings_count` lives on the run, the per-severity
  split only on the review — zeros there would assert the run was clean rather than admit
  the breakdown is unknown. The pre-existing `RunHistory` tests, which render without the
  new prop, exercise that fallback for free.
- `RunFindings` reuses `countBySeverity` from `SeverityFilterBar/helpers.ts` rather than
  tallying its own. That is not tidiness: a private tally would reintroduce the crash in
  Recurring Errors & Fixes above, because `SEV` still has no fallback.

## Open Questions

- Should the accordion header keep showing the run's own totals (`5 findings`) while a
  severity filter is active, or switch to `2 of 5`? Left as totals on 2026-07-28 — the
  header describes the run, not the current view — but it does read oddly next to a
  shorter list.

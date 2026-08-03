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

### Narrowing a barrel only shrinks a graph the component is not already in

Measure before claiming a barrel fix helped. On 2026-08-02
`_components/SeverityFilterBar/index.ts` was narrowed from three re-export lines to the
component plus `export type { SeverityLevel }`, and its two value-level consumers were
repointed at `./constants` and `./helpers`. Walking the **runtime** graph — following only
imports that survive type erasure, so `import type` and statements whose every specifier is
`type`-prefixed are dropped:

- `_components/RunFindings/RunFindings.tsx`: 19 → 16 local modules, and
  `SeverityFilterBar.tsx` unreachable. Real: that row renders no filter bar.
- `[number]/page.tsx`: 117 → **117**, still reachable. The page renders `<FindingsTab>`,
  which renders `<SeverityFilterBar>`, so the component was in its graph on its own account
  and the direct import bought nothing back.

So the review finding was half right, and only the half you can measure. The direct edge is
still worth deleting — it is a claim about what the page depends on — but do not sell it as a
smaller bundle. The rule that generalises: a barrel costs a consumer only what the consumer
does not already reach by another path, and in a route subtree the page usually reaches
everything.

`export type { … } from` is the escape hatch that keeps a leaf barrel usable: it is erased at
compile time, so the four siblings reading `SeverityLevel` from the folder pay no runtime
edge, and only `FindingsTab` — which actually renders the bar — keeps a value import.

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

### Turning a hover card interactive needs four changes, not one

**Symptom.** Dropping `pointerEvents: "none"` from the findings card on 2026-08-01 was not
enough to make it scrollable and clickable — it still vanished the moment the cursor tried
to reach it, and clicking inside it navigated the PR list row underneath.

**Cause.** Four independent things, each of which alone keeps the card unusable:
the trigger closes on `mouseleave`, and the 8px gap between the chips and the card counts
as leaving; `onBlur` fires when focus moves to a link *inside* the card, because the card
is a DOM descendant of the trigger; the card is `position: fixed`, so a page scroll leaves
it floating beside a row that has moved on; and `PRRow.tsx:26` navigates on click, which a
click anywhere in the card bubbles up to.

**Fix.** All four, in `components/findings-preview/FindingsPreview.tsx`: close on a 150ms
timer that the card's own `onMouseEnter` cancels; in `onBlur`, bail out when
`e.currentTarget.contains(e.relatedTarget)`; a capture-phase `window` scroll listener that
closes unless the event came from inside the card; and `onClick={(e) => e.stopPropagation()}`
on the card. Note that once the cursor is *inside* the card no `mouseleave` fires on the
trigger at all — React's enter/leave are containment-based — so only the gap needs the timer.

### Appending untrusted text to an absolute URL cannot change its origin — dot segments are the exception

**Symptom.** A 2026-08-01 review flagged the finding citation links as an open redirect:
`findings.file` is agent-written text, so a value like `//evil.com` or `https://phishing.com`
was said to send the reader off-site.

**Cause.** It does not, and the reason is worth keeping. `githubBlobUrl` interpolates into
`` `https://github.com/${repo}/blob/${sha}/${encPath(file)}` `` — the origin is a literal
*prefix*, and `file` lands at the end of an already-absolute URL. Appending cannot introduce
an origin, and `encPath` percent-encodes each segment, so a scheme colon survives only as
`https%3A`. All three payloads resolve to origin `https://github.com`. Verify a claim like
this with `new URL(built).origin` before changing anything.

What encoding does **not** neutralise is `.` and `..`: `encodeURIComponent` returns both
unchanged, and the browser resolves them before it sends the request. A `file` of
`../../../../attacker/repo/blob/main/README.md` turned the link into
`https://github.com/attacker/repo/…` — still github.com, so not an open redirect, but the
citation read as one repo and opened another.

**Fix.** `lib/github-urls.ts` rejects any component carrying a whole `.`/`..` segment and
returns `undefined`; `FileRef` already renders an unlinked citation when it has no href, so
this degrades to plain text instead of to a misleading link. Repo-relative diff paths never
contain dot segments, so there are no false positives. Tests in `lib/github-urls.test.ts`
cover both halves — the payloads that are safe *because* of encoding, and the ones that are
not.

### `Node.contains` throws on a non-Node and silently kills the handler around it

**Symptom.** The findings card was supposed to close on page scroll and did so in jsdom, but
in Chrome a `window.dispatchEvent(new Event("scroll"))` left it open with no console error
visible in the test output.

**Cause.** The guard read `cardRef.current?.contains(e.target)`. A scroll event dispatched
straight at `window` has `e.target === window`, and `contains` takes a WebIDL `Node?` — a
non-Node argument throws `TypeError`, aborting the listener before it ever called `close()`.
A real viewport scroll targets `document` or the scrolling element, so the jsdom test using
`fireEvent.scroll(document)` passed and hid it.

**Fix.** Guard with `e.target instanceof Node` before calling `contains`. There is a
regression test for the `window`-dispatched case in `FindingsPreview.test.tsx`; a test that
only fires at `document` will not catch this.

### An optional prop with a `= false` default disables a whole feature in silence

**Symptom.** "Open run trace" on a *live* run opened the drawer on an empty Trace pane
reading "No trace available yet.", and its Live-log tab was blank. Found on 2026-08-01 by
reading the code, not by anyone reporting it — nothing errored, nothing was logged, and the
feature had presumably never worked.

**Cause.** `page.tsx` mounted `<RunTraceDrawer runId=… findings=… onClose=… />` and simply
never passed `running`. The prop is declared `running = false`, so the drawer took the
historical path on every mount: `useRunEvents(running ? [runId] : [])` subscribed to nothing,
`useState(running ? "log" : "trace")` opened the wrong tab, and `useRunTrace(runId,
!stillRunning)` went and fetched a trace that is not written until the run completes.

**Fix.** `running={liveRunIds.includes(traceRunId)}` — the page already computed
`liveRunIds`. Also `key={traceRunId}`, because `tab` is derived from `running` *at mount*, so
switching runs inside an open drawer otherwise keeps the first run's tab.

The general lesson is the one worth keeping: a required-in-spirit prop given a default is
invisible to `tsc`. Three of `RunTraceDrawer`'s five props are optional and this was the only
one that mattered. When a prop selects between two whole behaviours, leave it required and
let the compiler find the call sites.

### One `window` listener per component instance multiplies with the list it belongs to

**Symptom.** On a PR with two review runs, applying a severity filter and pressing `a`
accepted **two** findings — and not the same finding twice, but a different one in each run.
`j`/`k` moved the focus ring in every open list at once.

**Cause.** Two deliberate behaviours that only misbehave together.
`_components/FindingsPanel/FindingsPanel.tsx` binds j/k/a/d to `window`, and each panel keeps
its own `focusIdx`. `_components/ReviewRunAccordion/ReviewRunAccordion.tsx` force-opens
*every* accordion while a severity filter is active (recorded under What Works above — a
collapsed accordion makes the filter look inert). So the filter mounts N panels, and N
listeners answer one keypress against N different focus indices.

**Fix.** `FindingsTab` nominates exactly one run, `FindingsPanel` takes `active` (defaulting
`true`, so a lone panel keeps working and no existing test changed), and the effect
early-returns when inactive. The nomination is **derived during render**, not synced by an
effect:

```ts
const activeReviewId = shownRuns.some((r) => r.id === activeId) ? activeId : shownRuns[0]?.id ?? null;
```

so when the filter drops the active run the fallback takes over on the same paint. Key it on
`review.id`, not `run_id` — `run_id` is nullable on the contract.

`ReviewRunAccordion` claims the shortcuts with `onPointerDownCapture` / `onFocusCapture` on
its root; the capture phase matters, so touching a finding's Accept button inside a run also
makes that run active before the click does its own work.

Rejected: gating on `document.activeElement`. Nothing owns focus on load, so the single-run
case that works today would silently stop responding until clicked, and jsdom does not move
focus on a click of a `tabIndex` div — the activation signal cannot be tested the way a user
produces it.

The regression lives in `_components/FindingsTab/FindingsTab.test.tsx`: two runs,
`severity="CRITICAL"` to force both open, one `keyDown`, assert `toHaveBeenCalledTimes(1)`.
A `FindingsPanel`-only test cannot catch this — the bug needs two panels.

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

### The findings card's two surfaces get their depth from different places

Both the PR list and the timeline run row drive `components/findings-preview`, but only one
of them pays for the findings. The timeline already holds every finding in memory —
`FindingsTab.tsx` keys `ReviewRecord.findings` by `run_id` — so `RunFindings` passes the
whole ranked list and caps nothing. The list ships only `findings_top` (3, capped by
`LIST_FINDINGS_PREVIEW` in `server/src/modules/pulls/routes.ts:19`), so `FindingsCell`
latches a flag on the card's first open and calls `usePrReviews(pr.id)` from there, swapping
the payload's slice for the full set when it lands. That is the same `["reviews", prId]`
query the detail page reads, so the click that usually follows a hover is already warm.

Two consequences worth knowing before changing either: adding a per-PR findings endpoint is
unnecessary — `GET /pulls/:id/reviews` already returns all of them — and `FindingsCell` no
longer holds to "hovering costs no request", so a change there is a change to list traffic.

### The `@/*` alias exists but most of the tree ignores it

`client/tsconfig.json` maps `@/*` → `./src/*`, yet on 2026-08-01 `src/` held **43** imports
beginning `../../../../` against only **29** using the alias. The worst are seven levels
deep, e.g. `src/app/settings/[section]/_components/SettingsView/_components/SettingsApiKeys/
SettingsApiKeys.tsx:6` importing `"../../../../../../../lib/hooks"`.

This is not cosmetic: route-colocated folders are exactly the ones that get moved or renamed
when a route changes, and every `../` count silently encodes the current depth. Use `@/` for
anything outside the current folder, keep relative paths for same-folder siblings
(`./constants`, `./helpers`), and fix the ones in files you already touch. Counted with
`grep -rn 'from "\.\./\.\./\.\./\.\./' --include='*.ts' --include='*.tsx' src`.

### Nine `index.ts` files are aggregating barrels, and `@/lib/hooks` is the costly one

`export *` barrels live in `lib/hooks/`, `components/{app-shell,findings-preview,page-shell,
run-cost-badge,showcase}/`, `_components/RunFindings/`, and both `vendor/` roots.

`src/lib/hooks/index.ts` re-exports five domain modules, so `import { useSettings } from
"@/lib/hooks"` also pulls `agents`, `reviews`, `trace` and `repo-intel` into the graph.
Its own header comment says both forms "resolve here" — true, but not equivalent. Import the
domain file directly (`@/lib/hooks/reviews`) in new code.

Leaf barrels that re-export a single component — `FindingCard/index.ts`,
`components/diff-viewer/index.ts` — are a different thing and are fine. The distinction is
`export *` over several modules, not the existence of an `index.ts`. Find them with
`grep -rln 'export \*' --include='index.ts' src`.

### `FindingCard`'s `SEV_COLOR` duplicates the vendored `SEV` token

`src/vendor/ui/primitives/tokens.ts:6` exports `SEV` with `{ c, bg, icon, label }` for all
four severities. `_components/FindingCard/constants.ts` re-declares the colour half as
`SEV_COLOR` + `SEV_COLOR_FALLBACK`. Two maps for one concept: adding a severity updates one
and not the other, and the local map is the one without an icon or a label.

The folder layout there is the right pattern to copy; that particular constant is not.
Before adding to a `constants.ts`, grep `vendor/ui` and `vendor/shared` for an existing
token — and consume it rather than editing `vendor/**`, where the server copy is the source
of truth.

**Correction, 2026-08-01 — `SEV_COLOR` is gone; the diagnosis above stands.**
`FindingCard/constants.ts` was deleted and the card now takes `severityColor()` from
`components/severity-badge/`. A *fourth* copy turned up in the same pass, inline in
`_components/RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx`, and it had
drifted: `SUGGESTION: "var(--accent)"` where the token says `var(--sugg)`, and no `INFO` key
at all, so the trace drawer painted suggestions blue and INFO grey. That is what a duplicated
token costs — not the duplication, the divergence nobody notices.

**Correction, 2026-08-01 — that divergence was invisible, and the reason matters.**
Measured in the browser rather than assumed: `--sugg` and `--accent` hold the *same* value in
both themes (`#3b82f6` dark, `#2563eb` light, `vendor/ui/styles.css:20,29,59,68`), and
`--info` (`#6b7280`) is within a hair of `--text-muted` (`#6a6a6a`). So the wrong token
rendered the right colour and nobody could have seen it. Two things follow. The drift is
still a real defect — nothing holds `--accent` and `--sugg` equal, they are independent
declarations, and the day someone re-tints the accent the trace drawer silently stops
agreeing with every other severity chip. But do not sell a fix like this as a visible bug:
check `getComputedStyle` before claiming a colour is wrong on screen. The *visible* half of
this change was the badge gaining the token's icon and background, because it went from a
bare `Badge` to `SeverityBadge`.

### `Severity` means two different things depending on which package you import it from

`@devdigest/shared` declares `Severity = z.enum(['CRITICAL','WARNING','SUGGESTION'])` —
**three** values (`vendor/shared/contracts/findings.ts:11`). The vendored design system
declares its own `Severity` off the `SEV` table, which has **four**: it adds `INFO`
(`vendor/ui/primitives/tokens.ts:3-18`). Both are exported under the same name, and
`FindingCard` imported the UI one while its data carried the contract one — so
`f.severity as Severity` was a silent widening cast that read like a narrowing one.

This matters when you write a type guard. Keying `isKnownSeverity` off the *contract* would
send a perfectly renderable `INFO` down the fallback path; keying it off `SEV` asks the only
question the badge actually cares about — is there a row here to read `c`, `bg`, `icon` and
`label` from. `components/severity-badge/helpers.ts` does the latter, and says so.

The same three-vs-four split is why `FindingsPanel/constants.ts` `SEVERITY_ORDER` has four
keys while `findings-preview/helpers.ts` `SEVERITY_LEVELS` has three. They are not
inconsistent by accident, but they do disagree on screen: an `INFO` finding renders in the
panel and is dropped from the hover card on the same page. Unresolved — see Open Questions.

### An out-of-contract severity degrades, it is not filtered and not coerced

`findings.severity` is a plain `text` column, so any string can reach the UI. Three responses
were on the table and only one keeps the reviewer honest:

- **Filter it out** — what `rankFindings` does, correctly, for the hover card: it *ranks*,
  and an unknown value has no rank, and the card is a truncated teaser where dropping a row
  costs nothing. Wrong for the PR-detail list, whose entire job is to enumerate findings.
  Deleting an agent-reported row also hides the server bug that produced it.
- **Coerce to a known value** — stamps a severity the agent never assigned onto a row the
  reviewer then accepts or dismisses on the strength of that label.
- **Degrade the badge** — `components/severity-badge/FindingSeverityBadge.tsx` renders the
  raw string in a muted `Badge`. The finding stays, the label is literally what the database
  holds, and nothing throws.

So the two surfaces differ on purpose. Do not "fix" `rankFindings` to match.

### The cost of `useTranslations` is the test provider, so migrating two strings costs what migrating nine does

`src/app/page.tsx` had its new `ErrorState` title and body hardcoded while the rest of the
file — the `PageContainer` title, the `EmptyState`, the redirect line — was hardcoded too.
The tempting fix is to move the two strings the review named.

Do not. The moment the component calls `useTranslations`, every `render()` in
`page.test.tsx` needs a `NextIntlClientProvider` wrapper (the pattern is
`SeverityFilterBar.test.tsx:43` — import the namespace JSON, pass `{ ns: messages }`). That
wrapper is a fixed cost paid once. Against it, the marginal cost of taking the remaining
seven strings is seven JSON keys and seven one-line JSX edits. A two-key `home.json` buys the
full test churn *and* leaves `t("error.title")` sitting between `title="Welcome to
DevDigest"` and `title="No repositories yet"`.

So the decision is binary: leave the file alone, or migrate the screen. `messages/en/*.json`
is read by directory listing in `src/i18n/request.ts`, so a new namespace file needs no
wiring — the whole cost really is the provider. Copy the strings verbatim while moving them;
retyping an apostrophe at the same time makes the diff impossible to check, and note the repo
is already split between `'` (here) and `’` (`prReview.json`).

Brand names stay literal — the `AppShell` crumb is `"DevDigest"` in every locale.

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

**2026-08-01 — the same lie fires on `@devdigest/ui`, `@devdigest/shared` and `@/…`,** in
plain `src/components/` files with no bracketed segment anywhere in the path, and it spreads
to lines you did not touch in a file you just edited. `pnpm typecheck` was clean throughout.
Do not chase it.

### A disabled TanStack v5 query reports `isLoading === false`, not `true`

**Symptom.** `RunTraceDrawer`'s "Trace is written when the run completes" message
(`drawer.tracePending` in `messages/en/runs.json`) was unreachable dead copy — the pane fell
straight through to `drawer.noTrace` for a live run.

**Cause.** The guard read `isLoading && !trace ? (stillRunning ? tracePending : loadingTrace)
: …`. But `useRunTrace(runId, !stillRunning)` sets `enabled: false` while the run is live, and
a disabled query is not loading — v5 reports `status: "pending"` with `fetchStatus: "idle"`,
so `isLoading` (which is `isPending && isFetching`) is **false**. The outer condition never
held, so the inner branch that would have shown the message never ran.

**Fix.** Check the domain flag before the query flag:
`stillRunning ? tracePending : isLoading && !trace ? loadingTrace : …`. More generally, never
express "we have not asked yet" through `isLoading` — ask the thing that decides `enabled`.

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

### `value in OBJ` passes for eight inherited keys, so an allowlist built with it is not one

**Symptom.** A findings row with `severity` or `category` set to `"constructor"`, `"toString"`,
`"valueOf"`, `"hasOwnProperty"`, `"__proto__"`, `"isPrototypeOf"`, `"toLocaleString"` or
`"propertyIsEnumerable"` gets past a guard that was written to reject unknown values. The badge
then resolves to a function on `Object.prototype`, `Icon[undefined]` follows, and React throws
`Element type is invalid` — the whole-route crash already recorded above.

**Cause.** `in` walks the prototype chain. `SEV`, `CAT` and `RANK` are plain object literals, and
`Object.fromEntries` output carries `Object.prototype` too. `findings.severity` and
`findings.category` are unconstrained `text` columns filled from LLM agent JSON, so those strings
really do reach the client. A guard with `if (!c) return null` does not save you either:
`CAT["constructor"]` is truthy, so the guard never fires.

**Fix.** `Object.hasOwn(OBJ, value)`. On 2026-08-02 the same defect was found in four places —
`components/severity-badge/helpers.ts:9`, `components/findings-preview/helpers.ts:42`,
`vendor/ui`'s category tag consumers, and `server/src/modules/pulls/status.ts:93`. Fixing one
instance is a signal to grep for the rest: `grep -rn ' in [A-Z][A-Za-z_]*' client/src server/src`.

Note the client and server ranking functions are declared mirrors of each other. Fix only one and
the two sides disagree about which rows exist, which is worse than the bug.

**A test that pins this must name the inherited keys.** Asserting that `'CRITICAL'` passes and
`'nope'` fails is green *before* the fix, because `in` is correct for both.

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

### 2026-08-01

- The findings card became interactive on both surfaces: it scrolls, it stays open while
  hovered, and every `file:line` links to that file on GitHub at the PR's head sha. Four
  coupled changes were needed, not the one obvious `pointerEvents` removal — see What
  Doesn't Work above.
- `MonoLink` from `@devdigest/ui` was the obvious primitive for the link and the wrong one:
  it hardcodes `fontSize: 13` and takes no `style`, so it cannot carry the card's two-span
  elision layout (`itemPath` ellipsis + `itemLine` `flexShrink: 0`). A local `FileRef.tsx`
  renders the anchor with the card's own styles and keeps `stopPropagation` + `_blank`.
- "Infinite scroll" is progressive rendering, not pagination: `FindingsPreview` renders 10
  at a time and grows by 10 from an `onScroll` handler firing ~160px (two items) early.
  Deliberately a scroll handler rather than `IntersectionObserver` — jsdom ships no
  `IntersectionObserver`, and the suite mocks nothing of the sort. Testing it does need the
  geometry asserted onto the element by hand (`Object.defineProperty` for `scrollHeight` /
  `clientHeight` / `scrollTop`), since jsdom lays nothing out.
- The severity order and the ranking moved into `components/findings-preview/helpers.ts` as
  `SEVERITY_LEVELS` + `rankFindings`; `SeverityFilterBar/constants.ts` now re-exports the
  list and `RunFindings/helpers.ts` is gone. The list cell would otherwise have had to
  import from the detail route's `_components/`, which is backwards. Ranking now breaks ties
  by `id` — see the root `INSIGHTS.md` for why that matters across the two packages.
- Verified against real data only: the largest PR in this workspace carries 3 findings, so
  the >10 scroll path is covered by tests and not by the browser. No rows were seeded to
  make the card look fuller.
- Wrote `.claude/skills/frontend-architecture/` (SKILL + examples + references) to answer
  "where does this file go" for React and the App Router, and trimmed the overlapping
  "Code Organization" section out of `react-best-practices` so the two do not contradict
  each other. Route-colocation is prescribed because it is what `client/` already does.
- Grounding it against the real tree surfaced three drifts, all recorded under Codebase
  Patterns above: the unused `@/*` alias, the nine `export *` barrels, and `SEV_COLOR`
  duplicating the vendored `SEV`. None was visible from reading a single file — they only
  appear when you count across `src/`.
- The skill was dogfooded before being called done: a fresh agent was asked where a new
  `SeverityLegend` goes and answered the colocated path plus the promotion move without
  prompting. It also caught the `SEV` duplication independently, which is what sent me
  back to fix the examples.
- Audited the whole of `client/` against `frontend-architecture`, `react-best-practices` and
  `next-best-practices`, then fixed the five live defects it turned up. Roadmap for the rest
  (resilience, tooling, duplication, a11y) is in the plan file, not here.
- The structure came out clean — route colocation is real, contract types are re-exported
  rather than redefined, zero `any` and zero `@ts-expect-error` outside `vendor/`, no `fetch`
  escapes a hook, no render factories, no `{count && …}` zero-leaks, every icon-only button
  labelled. The defects were all *wiring*, not structure: a prop never passed, a guard on the
  wrong flag, a listener bound one level too wide, a branch collapsed with another, a lookup
  with no fallback. Reading a component in isolation finds none of these — four of the five
  only appear when you read the call site next to the definition.
- `client/` has **no ESLint at all** (no config, no dependency, no script) while carrying
  three `// eslint-disable-next-line react-hooks/exhaustive-deps` comments that nothing
  enforces. `react-hooks/exhaustive-deps` plus `jsx-a11y` would have flagged a good share of
  the roadmap mechanically. Highest-leverage item still open.
- Every fix was proven red before green by reverting just that hunk and re-running: D5 threw
  the exact `Cannot read properties of undefined (reading 'icon')` from Recurring Errors, D2
  reported `expected "spy" to be called 1 times, but got 2 times`, D4 rendered "Add a
  repository" on a 500. A test that has never failed is not yet a regression test.
- `pnpm build` after the pass: `/repos/[repoId]/pulls/[number]` is 15 kB / 214 kB first load,
  the heaviest route by 4× — consistent with `FindingsTab` taking 15 props and the page
  running six queries.

### 2026-08-02

- Fixed three `pr-self-review` findings on `feat/findings-severity-filter`, all barrel or
  copy hygiene, none behavioural: 237 tests unchanged before and after.
- The severity-filter barrel was the interesting one, and not for its size. The same defect
  had already been fixed one folder over in this branch — `components/findings-preview/index.ts`
  was narrowed and its header even *names* `SeverityFilterBar/constants.ts` as the consumer it
  was hurting — while the sibling barrel created in the same branch kept the shape. Fixing the
  instance you were shown and not the pattern is the failure mode; grep for the shape
  (`grep -rln 'export \*' --include='index.ts' src`, plus multi-line explicit barrels) when you
  fix one.
- `components/category-tag/index.ts` and `components/severity-badge/index.ts` named
  `isKnownCategory` / `isKnownSeverity`, which only their own folder imports (as `./helpers`).
  Dropped. Negligible graph cost — the value is that all three barrels in the branch now state
  the same rule.
- Counting the graph by hand is worth the twenty lines: a script that resolves `./`, `@/` and
  `index.ts` and skips type-only edges answered "did this actually shrink" in one run, and
  contradicted half the finding. Regex over import statements is enough; no need for madge.

## Open Questions

- Should the accordion header keep showing the run's own totals (`5 findings`) while a
  severity filter is active, or switch to `2 of 5`? Left as totals on 2026-07-28 — the
  header describes the run, not the current view — but it does read oddly next to a
  shorter list.
- `RunStatus` and `RunTraceDrawer` now both hold an `EventSource` for the same run whenever
  the drawer is open on a live run, because `useRunEvents` opens one per call site. Each
  raises `notify.error(parsed.msg)` on an SSE `error` frame (`lib/hooks/reviews.ts:189`), so
  a failing run toasts **twice**. Introduced knowingly on 2026-08-01 when the drawer started
  receiving `running` — the alternative was lifting the subscription to the page and
  prop-drilling events into both, which is a bigger change than the symptom warrants. Fix by
  sharing one subscription per run id if it starts to grate.
- `INFO` findings are ordered by `FindingsPanel/constants.ts` `SEVERITY_ORDER` (four keys) but
  dropped by `findings-preview/helpers.ts` `SEVERITY_LEVELS` (three), so the same finding
  appears in the run's list and not in the hover card. Both are defensible on their own — see
  Codebase Patterns. Decide whether `INFO` is a real severity for this product and make the
  two agree; the server's contract says it is not, the design system says it is.

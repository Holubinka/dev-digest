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

### When the items repeat, cap the chart's node budget, not each item's list

Building the blast-radius graph on 2026-08-09, the first cap was per symbol: four endpoints
each. On the live PR #12 answer that drew *the same first four routes twelve times over* —
endpoints are attached per symbol but come from the caller's **file**, so twelve symbols in
`reviews/routes.ts` carry an identical eight-route list — and the union came out four short.
`POST /findings/:id/${action}`, the tenth, was cut from a chart with room for it.

Replacing it with one budget for the whole chart (`GRAPH_CAPS.endpoints = 10`, spent only on
boxes that do not exist yet, edges to an already-drawn box being free) drew all ten inside the
same node count. The general shape: when a capped list repeats across the things you are
capping, a per-item cap spends the budget on duplicates. Count what the render actually costs —
distinct nodes — and cap that.

### `<React.StrictMode>` in the render is how a "fire once on mount" guard gets a failing test

An effect that starts something expensive when data arrives — `OverviewTab`'s automatic first
Risk Brief computation, 2026-08-16 — is guarded by a `useRef` holding the
`` `${prId}:${headSha}` `` it already fired for. Testing that guard with a plain `render()` is
close to vacuous: nothing in a single mount re-runs the effect, so the assertion
`expect(mutate).toHaveBeenCalledTimes(1)` passes with the ref deleted.

Wrapping the tree in `<React.StrictMode>` fixes that for one line. React deliberately runs an
effect's setup, cleanup and setup again on mount in development, which is exactly the failure
the ref exists for. Measured: deleting the guard turns **three** tests in
`OverviewTab.test.tsx` red, and the count on the first one goes 1 → 2. Refs survive it, because
StrictMode re-runs the effects of the *same* component instance — which is also why a
module-level flag would be the wrong guard.

Pair it with a second test that re-renders under a *different* `headSha` and asserts the count
goes to 2. Together they say the guard is keyed by state rather than being a once-per-mount
latch, and that pair is what a plain "called once" assertion cannot distinguish.

### A throwaway vitest file can drive the RUNNING API and print the real rendered tree

**Symptom.** No browser automation is available in a session, so a screen built against a live
server can only be checked with `curl` — which sees the SSR skeleton of a `"use client"` page and
nothing of what the reader would see.

**Cause / what makes it work.** `src/test/setup.ts` stubs `ResizeObserver` and registers
jest-dom, and that is all: **global `fetch` is not mocked there**, it is mocked per test file. A
test that does not mock it reaches `localhost:3001` for real.

**Fix.** Drop a temporary `src/__live-*.test.tsx` that renders the real component with props taken
from the live API, `await waitFor` on something the tab only renders once its queries settle, then
walk `document.body` and `console.log` a tag/text/`href` outline. On 2026-08-16 this rendered the
whole PR Brief composition against `Holubinka/dev-digest#20` — five risk rows, the "1 more risk
areas" disclosure, every `github.com` href pinned to `link_sha` and carrying no `#L` because
`ref_lines` was still `[]`, and the provenance block's `$0.0011 / 5718 tokens in`. Delete the file
afterwards; it is a probe, not a test, and it would fail in CI where nothing is serving.

Give the probe **every** message namespace the tree needs. Supplying only `brief` and `prReview`
left `BlastRadiusCard` printing `blast.title` and `blast.stat.symbols` — a probe artefact that
looks exactly like a missing-key bug in the code under review.

### A placement requirement needs an ORDER assertion, not three presence assertions

`IntentCard` rendered its RISK AREAS slot *after* the `via {model}` / Recompute footer for a whole
round, so a loaded card read scope lists → model/Recompute → RISK AREAS while the design put RISK
AREAS directly under the scope columns. Every test passed the whole time: all three regions were on
screen, and "on screen" was all anything asserted. Two independent readers (`plan-verifier` item
210 and `/code-review`) had to find it by eye.

Assert the order, in the state that has all three:

```ts
const follows = (first: HTMLElement, second: HTMLElement) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

expect(follows(scope, risks)).toBe(true);
expect(follows(risks, footer)).toBe(true);
```

Cheaper to read than indexing `container.querySelectorAll("*")`, and it fails for the reason it is
about. `client/AGENTS.md` § *A design is an acceptance criterion* makes placement a requirement;
this is what pins one. Same shape works for "the cost is under the gauge, not in the title row" —
`VerdictBanner.test.tsx` (2026-08-17) uses it for three of the mockup's placements.

### Measuring a layout bug: headless Chrome over CDP, in ~60 lines of Node

`agent-browser` (what `e2e/` drives) is not installed on this machine, and jsdom lays nothing out, so
neither the unit suite nor the e2e suite can answer "does this element stick out of its card". Node
22 has a global `WebSocket` and Chrome ships a CDP server, which is the whole dependency list:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir=$(mktemp -d) --window-size=1440,1000
# then: GET http://127.0.0.1:9333/json/list → webSocketDebuggerUrl → Runtime.evaluate
```

Poll `Runtime.evaluate` until the TanStack queries have resolved (a marker element appears), then ask
the page arithmetic questions it can answer and a screenshot cannot: `card.scrollWidth -
card.clientWidth`, `el.getBoundingClientRect().right - cardInnerRight`, and — for "does the line
number end up alone on its own line" — `Range.getClientRects()` per character, grouped by `top`, which
reconstructs the text of each line box at every container width in a sweep. On 2026-08-17 that turned
"the path leaves the card" into `+201px at 1440` before and `−16px` after, and turned a yes/no worry
about `:12` into 80 widths out of 561. Screenshots still matter — they are what showed the break
landing inside `[number]` — but they cannot be asserted on.

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

### The optional-prop bug shipped a second time, and the colocated test is why it survived

**Symptom.** The Agents list card showed no skills badge at all. Reported by a course
reviewer on 2026-08-06, not by the suite: `AgentCard.test.tsx` had been green throughout,
asserting `3 skills` renders.

**Cause.** `AgentCard` declared `skillCount?: number` and gated the badge on
`skillCount != null`. Neither `AgentsListView` nor `AgentEditorView` passed it, and
`GET /agents` never counted `agent_skills` in the first place, so there was nothing to pass.
Same class as the `running` prop above (2026-08-01) — a required-in-spirit prop with a
default is invisible to `tsc` — plus the part that entry does not cover: the test supplied
`skillCount={3}` itself, so it proved the badge *can* render and never that anything renders
it. A test that constructs an input no real caller produces reads as coverage and is not.

**Fix.** Delete the prop and take the number off the row — `ag: AgentListItem` with a
required `skill_count`, badge rendered unconditionally. Every call site is then a compile
error until the data actually flows, which is how `AgentsListView.tsx` and the
`AgentEditorView` test fixture were found. When a card renders a count, put the count in the
row contract, not in a prop.

Rendering unconditionally also means 0 and 1 now reach the message, and
`messages/en/agents.json` said `"{count} skills"` — so it needed ICU plural
(`{count, plural, =0 {No skills} one {# skill} other {# skills}}`). Any count that used to be
hidden behind a truthiness check has the same latent "1 skills".

**2026-08-09 — it happened again, and the test is why.** `messages/en/blast.json` shipped
`"callerCount": "{count} callers"`, so a symbol with one caller read "1 callers". The entry
above did not prevent it, because the guard everyone writes is an assertion on the plural
branch: `BlastRadiusCard.test.tsx` asserted `getByText("2 callers")`, which a hard-coded
`"{count} callers"` satisfies forever. **Assert BOTH branches or the test proves nothing** —
`getByText("1 caller")` plus `queryByText("1 callers")` being absent. Cheapest sweep for the
remaining ones: `grep -n '{count}' client/messages/en/*.json` and read each hit for whether 1
can reach it.

### A mermaid label built from repository content: the quotes carry it, and the test can be vacuous

**Symptom.** The graph modal opens empty. Nothing throws, nothing is logged, no error box —
`MermaidDiagram` returns `null` when `mermaid.parse` says the chart is invalid
(`src/components/mermaid-diagram/MermaidDiagram.tsx:59`), so one bad label is
indistinguishable from a component that never loaded.

**Cause.** Every label in a blast-radius chart is repository content. `Holubinka/dev-digest`
PR #12 already serves an endpoint literally named `POST /findings/:id/${action}` — the route is
registered in a loop — and symbol names carry `(`, `)`, `<`, `>`, quotes and, from a multi-line
declaration, newlines.

**Fix.** In `toMermaid.ts`: generate every node id (`n0`, `n1`, …) so nothing from the
repository is ever interpolated unquoted, always wrap the label in `"…"`, and inside it rewrite
`#` → `#35;` **first** (it opens a mermaid entity code, so escaping it last would corrupt the
codes just emitted), then `"` → `#34;`, `<` → `#60;`, `>` → `#62;`, collapse whitespace, and
clip by code point.

**The part worth the entry.** Measured with the real parser on 2026-08-09: `n0["POST
/findings/:id/${action}"]` **parses fine**. Quoting alone saves that label; `${…}` is not the
danger. What fails is `n0[POST /findings/:id/${action}]` unquoted, and any label carrying a
quote or a newline. So a test that pushes the scary-looking string through the builder and
asserts the chart parses proves *nothing about the escaping* — it would pass with the escaping
deleted. The assertion that has teeth is the control: build the naive chart by hand and assert
`parse` returns **false**. Both live in `toMermaid.test.ts`.

### Disabling a retry button on the state it recovers from removes it exactly when it is needed

**Symptom.** `ProjectContextView` had `disabled={rescan.isPending || page.data?.state ===
"scanning"}`. The server documents Rescan as the user's retry for a scan claim no process is behind
any more (`modules/context/service.ts`), and that row reports `scanning` — so the retry was absent
in the one state that needs it, and the page had no route out at all.

**Cause.** `scanning` reads as "a job is running, do not queue a second one". It is also what a
claim left by a killed process reports, and the client cannot tell those apart from the state
alone.

**Fix.** A retry is disabled by ITS OWN in-flight mutation and nothing else — `disabled={rescan
.isPending}`. Guarding against a double-enqueue is the server's job (it re-claims the row), not a
reason to take the control away. Test: `ProjectContextView.test.tsx` → "keeps Rescan reachable
while a scan is in flight", which clicks it in the `scanning` state and asserts the mutation fires.

### A contract field can be typed on both sides for a whole increment and rendered nowhere

**Symptom.** `SpecFile.kind` shipped with plan 08: a four-value enum on the server contract, a
`KIND_COLOR` map on the client, a badge on the Project Context page — and **no** row of the
attach lists ever rendered one, though `AC-10` had required it since the first increment.
`grep -rn "kind" client/src/components/context-docs/` returned nothing on 2026-08-14. Nothing was
red: the field is present, typed and used *somewhere*, so `tsc`, ESLint and 592 tests were green.

**Cause.** Same family as the two optional-prop entries above, one step further along. There the
prop was never passed; here the value arrives at the component and simply is not read. A test
that asserts the badge renders **on the page** proves the map works and says nothing about the
two other surfaces the criterion names, and a component test that supplies its own fixture proves
only that the component *can* render what it is handed.

**Fix.** When a criterion says "every row", write the assertion per surface and scope it to the
row: `within(screen.getByTitle(path).closest("div")!).getByText("specs")`. And prove the
assertion can fail — deleting `ContextDocList.tsx:112` failed exactly one test, which is how you
learn the other five were about something else. The cheap sweep for the rest of this class:
compare the fields of a contract type against `grep` in the folders that render it, rather than
trusting that a compiled field is a displayed one.

### A row control that must not toggle or drag its row cannot be `IconBtn`

The preview control sits on rows that are `draggable` and carry a `Checkbox` whose `<button
role="checkbox">` lives inside a `<label>`. The vendored `IconBtn` declares `onClick?: () =>
void` (`vendor/ui/primitives/IconBtn.tsx:16`) — no event argument — so a handler mounted through
it cannot call `stopPropagation`, and it sets no `type`, so it submits any form it is dropped
into. `context-docs/PreviewButton.tsx` is therefore a plain `<button type="button">` that stops
`onMouseDown` and `onClick` and preventDefaults `onDragStart`, with `draggable={false}` so the
row's own drag never starts from it. Reuse that shape for the next in-row control; reach for
`IconBtn` only where the surrounding element has no handlers of its own.

Its modal is rendered **after** the row map, not inside the row, for the same reason: a `Modal`
mounted under a `draggable` element is a DOM descendant of it, and every click inside the dialog
would bubble through the row's handlers.

### `within(row).getByText(...)` cannot pin WHERE in the row something sits

**Symptom.** `ContextDocList.test.tsx` asserted the kind badge with
`within(row(path)).getByText("specs")`. The badge was then moved from beside the filename into the
right-hand group before the preview control (2026-08-14) and the assertion stayed green through
the move — it had never been about position at all.

**Cause.** `row()` is `screen.getByTitle(path).closest("div")`, so the scope is the whole row.
Every child of every nested group is inside it. RTL queries answer "is it there", and the design
question was "is it there, *in that place*".

**Fix.** Assert the relationship, not the presence: `expect(badge.nextElementSibling).toBe(
preview)` plus `expect(badge.parentElement).toBe(preview.parentElement)`. Both fail when the badge
moves back beside the path — verified by moving it back. Keep the plain presence assertion too;
they answer different questions.

### `.trim()` does not make a URL scheme test safe — a control character survives it

**Symptom.** `isSafeUrl` (`components/context-doc-view/helpers.ts`) returned `true` for
`"java\tscript:alert(1)"`. The scheme pattern `/^[a-zA-Z][a-zA-Z0-9+.-]*:/` does not match a `\t`,
so the string fell through the "relative URL, nothing to check" branch. Nine control characters
were admitted: U+0000, U+0001, U+0009, U+000A, U+000B, U+000C, U+000D, U+001F, U+007F.

**Cause.** `.trim()` only reaches the ends of a string, and a browser strips TAB, LF and CR from
*anywhere* in a URL before resolving it. The gate was testing a string the browser would never see.

**Fix.** `url.replace(/\p{Cc}/gu, "").trim()` before the scheme test, then refuse an empty result.
`\p{Cc}` covers C0, C1 and DEL and keeps the source ASCII-only — a literal control character in a
test file is invisible in every diff, so build the hostile inputs with `String.fromCodePoint`
instead (`helpers.test.ts` → "refuses a scheme spelled with a control character inside it").
Not exploitable when found: `react-markdown` v9's `defaultUrlTransform` blanks all nine already,
measured 2026-08-14. This layer exists so the refusal does not depend on that default.

### A jump effect keyed only on its target scrolls inside the tree that is about to be replaced

**Symptom.** `DiffTab`'s jump from a Risk Brief review-focus item (`DiffTab.tsx:82`) opened the
right file and left the reader looking at an unrelated one, silently — nothing errors, the card
really is expanded, just far off-screen. Found in review 2026-08-16, on the feature's headline
interaction.

**Cause.** The effect depended on `[targetFile]` alone, but the component swaps its whole child
tree when a query resolves: `showSmart = smartOrder && smartDiff !== undefined`, so the FIRST
render after a cold arrival is always the plain `DiffViewer`. `FileCard` carries `data-file-path`
in *both* trees (`components/diff-viewer/FileCard/FileCard.tsx:144`), so `querySelector` found a
card, scrolled to it, and the effect never ran again once `SmartDiffViewer` replaced the list.
Timing is not the variable — the swap is unconditional on a first visit to the tab, and the
request takes ~8 ms locally, which is a window the effect loses 100% of the time, not sometimes.

**Fix.** Key the effect on the render state as well as the target — `[targetFile, showSmart]`,
the same reason `FindingsPanel.tsx:68-76` keys on `shown`. Then make it idempotent per
`(viewer, target)` pair (a `Set` in a ref): `?file=` is never cleared, so a plain
`[targetFile, showSmart]` re-runs on an order toggle minutes later and drags the reader back to
the brief's file. Rule of thumb for this codebase: if a component chooses between two subtrees on
query state, every effect that reaches into the DOM must name that choice in its deps.

### Mocking a query hook as already-resolved stages away every cold-path bug in the component

**Symptom.** `DiffTab.test.tsx` mocked `useSmartDiff` as `() => ({ data: smartDiffData.current })`
with the holder seeded to a full `SmartDiff` in `beforeEach`. Five cases covered the jump; none
could see the defect above, because the component never rendered its loading tree while a target
was set.

**Cause.** A hoisted constant return value gives the component ONE state for the whole test. The
real hook has at least two, and the interesting bugs live in the transition between them.

**Fix.** Keep the holder mutable and re-render in place to move it: seed `undefined`, render, then
set the resolved value and `rerender` the same tree (`renderTab` returns a `rerenderTab(patch)`
helper for exactly this). Also make the loading-state stand-in *faithful* — the plain-viewer mock
had no `data-file-path`, which would have made the new test pass for the wrong reason. Both new
cases were confirmed to fail against the unfixed component before being left green.

### A `useRef` guard cannot hold a fact about a cached PR state

**Symptom.** `OverviewTab` computes a brief when the server holds none for the current
`(prId, headSha)`, guarded by `autoComputed = useRef<string|null>(null)` so it fires once. Six
cases covered the guard and all six passed while a FAILED computation paid for itself again on
every tab switch — a second `POST /pulls/:id/brief`, with the error message replaced by a fresh
spinner because the remounted `useMutation` starts at `error: null`.

**Cause.** Two lifetimes that look the same and are not. `page.tsx:171` renders the tab as
`{tab === "overview" && <OverviewTab …/>}`, so Files changed and back UNMOUNTS it and the ref
returns to `null`; the fact it recorded — "a compute has been fired for this state" — is about
the PR state, which the query cache still holds `null` for. Every existing case re-rendered in
place with `rerender()`, and a re-render does not reset a ref.

**Fix.** Put the fact where facts about a state live. `useComputeBrief` now carries
`mutationKey: briefQueryKey(prId, headSha)`, and `useBriefComputeAttempted` reads it back with
`queryClient.getMutationCache().find({ mutationKey, exact: true })`. A CALLBACK, not a boolean:
`mutate()` registers the mutation synchronously, so a value captured at render is a commit stale,
and StrictMode's double-invoke runs the effect's setup twice in one commit — reading at call time
is what lets one guard replace the ref instead of standing beside it. Its window is the mutation's
`gcTime` (five minutes after the last observer unmounts, `query-core/removable.js:18-22`), the same
span the query cache holds its `null` for.

**And the test rule that follows.** A guard whose scope is the mount is only observable by a case
that leaves the mount: `render()` → `unmount()` → `render()` on the SAME `QueryClient`. `rerender()`
cannot see it, which is exactly why six cases did not. 2026-08-16, round 5 of `plans/10`.

### A mocked hook is a mocked cache, and the cache was where the bug was

**Symptom.** The defect above survived four review rounds with `OverviewTab.test.tsx` at twelve
green cases.

**Cause.** The file mocked `@/lib/hooks/brief` wholesale — `usePrBrief` and `useComputeBrief` both
`vi.fn()`. Every fact the automatic computation depends on (the cached `null` for a state, the
record of a compute already fired) then lived in the test's `beforeEach` rather than in a cache, so
no unmount could lose anything and no remount could remember anything.

**Fix.** Mock the boundary one layer lower — `@/lib/api` — and render inside a real
`QueryClientProvider` whose client is built once per test and shared across mounts. The hooks then
run for real and the assertions move from `computeBrief` to `api.post`, which is the number that
costs money anyway. `hooks/core` stays mocked deliberately: leaving it real would put the intent's
own reads into `api.get` and make the brief's call counts ambiguous.

### A mutation's `error` is sticky, so deriving "is there data" from it empties the page for good

**Symptom.** A brief is on screen for the current head. The reader presses the regenerate icon, the
POST 429s, and RISK AREAS, REVIEW FOCUS, the provenance block and the brief cost all vanish for the
rest of the mount — three regions printing "The brief for this state has not been computed." about a
record that is computed and cached. A failed background refetch of a query that already holds data
does the same thing.

**Cause.** `OverviewTab.tsx:108` derived the record as
`briefFailure != null ? null : briefData ?? null`. `useMutation().error` is **not** transient: it
stays set until the mutation is reset or the component unmounts, so one failed *re*computation reads
forever after as "there is no record". A `useQuery`'s `error` behaves the same beside a populated
`data`.

**Fix.** Derive the record from `data` alone and render the failure beside it, not instead of it
(2026-08-17). A failed recomputation must not remove the record it was recomputing; losing the data
is only correct when `data` itself is `null`. Two things make that safe here and are worth checking
before copying it: the query key carries the state (`["brief", prId, headSha]`), so a stale record
cannot be another head's answer, and the in-flight case is still covered separately by `isPending`,
which is what keeps AC-7 ("never present a previous state as current") true while a computation runs.

### `overflow-wrap: break-word` alone never shrinks a flex item, and Chrome does not break a path at `/`

**Symptom.** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`
— a `Risk.file_refs` entry on PR #21 — rendered 650px wide on ONE line inside a 449px INTENT card
at a 1440px window and hung 201px past the card border (`card.scrollWidth - card.clientWidth` = 183).
Reported 2026-08-17 by a human looking at the screen; no gate can see it.

**Cause.** Two independent facts, and fixing either alone leaves the bug.

1. A repository path is ONE word to a line breaker. Chrome breaks `scan-executor.ts` at the
   **hyphen** and finds no opportunity at a `/` at all — measured, not assumed. That is why the same
   card looks fine on PR #20 (every long ref there happens to contain a `-`) and breaks on PR #21.
2. `overflow-wrap: break-word` is deliberately **not** counted when computing min-content, so a flex
   item that keeps the default `min-width: auto` still refuses to shrink under its longest word — and
   a wrap it is never given a narrower line for cannot happen. (`overflow-wrap: anywhere` IS counted,
   which is why it appears to work alone; `BlastRadiusCard/styles.ts:143` rejects it for a different
   reason — it splits `helpers.ts:` from `82`.)

**Fix.** Both, together, on the element that IS the flex item:
`{ minWidth: 0, overflowWrap: "break-word" }` — `BriefRef/styles.ts`. Where the item is a vendored
component that takes no `style` (`MonoLink`), wrap it in a span that carries them; `overflow-wrap`
inherits into the anchor, and `min-width` belongs to the flex item, which is then the span.

### `<wbr>` fixes where a path breaks and costs it its accessible name

**Symptom.** Adding `<wbr>` after each `/` so a path breaks at its separators — the standard trick,
and it does work — turned the accessible name of every reference from `src/middleware/ratelimit.ts`
into `src/ middleware/ ratelimit.ts` and failed 14 existing tests on 2026-08-17.

**Cause.** `dom-accessibility-api`, which RTL's `getByRole({ name })` uses, joins the name from child
nodes with a space, and `<wbr>` makes the one text node into three. `getByText` is unaffected — it
reads direct text-node children and joins them with nothing.

**Fix.** None available here, which is the point: the name could be restored with `aria-label`, but
the element is `vendor/ui/primitives/MonoLink.tsx`, a read-only copy whose props are
`children | onClick | href`. So the emergency break stays, and with it a measured ~14% of card widths
(80 of the 561 between 140px and 700px) where the last line is `:12` alone. Anyone reaching for
`<wbr>` here should know it is an accessibility trade-off through a component they may not edit, and
that the decision is the human's, not the implementer's.

## Codebase Patterns

### A security predicate gets exported, not restated — `hasDotSegment` is the dot-segment rule

`src/lib/github-urls.ts` owns `/(?:^|\/)\.\.?(?:\/|$)/` as `hasDotSegment`, and it is now
exported for that reason. `PrBriefCard/helpers.ts` shipped a private `DOT_SEGMENT` holding the
same pattern character for character, under a comment naming the original — the
cross-check-by-comment shape this file already records as the thing that drifts. A reviewer
caught it on 2026-08-16 and it became an import.

The rule that follows: when a check exists because a value is hostile, the second caller imports
the first caller's function. A copy is not a second definition of a rule, it is a second rule that
happens to agree today. Order still matters at the call site — `isLinkablePath` runs controls,
then scheme, then dot segments, and `PrBriefCard.test.tsx` pins all three.

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

**Correction, 2026-08-17.** Still true about what the column *is*. No longer the number the two
PR-detail verdict banners show. A round-11 review found the Overview banner reading `run.blockers`
while `ReviewRunAccordion.tsx:85` counted CRITICAL-and-not-dismissed for the same review: dismiss two
criticals on Agent runs and the accordion dropped to 3 while the Overview still said 5 — two numbers
for one review on one page, and only one of them responded to what the reader had just done. The
stored column is frozen at the end of the run and cannot see a dismissal, so both surfaces now count
`countBlockingFindings` (`src/lib/blockers.ts`).

Read the entry above as: `RunSummary.blockers` is the agent's gate **decision**, which is history.
Render it under a label that says whose decision it was — the CI chip in `RunFindings` still does,
correctly. Do not render it as the live count of what still blocks a merge, and never sum or average
it across runs.

**Correction to that correction, 2026-08-17.** Reverted the same day, before it left the working
tree, and the reason above was the weaker of the two available. The recount
`findings.filter(f => f.severity === "CRITICAL" && !f.dismissed_at)` hardcodes **one** threshold,
while the stored column is `countBlockers(kept, agent.ciFailOn)` and `ciFailOn` is configured per
agent. So for any agent that does not gate on critical the recount is not a fresher view of the same
number — it is the wrong number. Staleness is a delay; a hardcoded threshold is an error for a whole
class of agents, and it is the one the original entry was written about.

Both surfaces now read the stored column through `blockersForRun` (`src/lib/blockers.ts`), which is
plan 11's own recommendation 1. The original entry stands unamended and is the rule. The first
correction is deliberately left in place rather than deleted: it records a decision that was taken,
written into a review brief, implemented and reversed, and the reversal only reads correctly with
both steps visible. What survives it is the shared function — one place both banners read from, so
they cannot drift again in either direction.

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

**Addition, 2026-08-09 — the same shape, on confidence, and this one WAS visible.**
`ConventionCard/helpers.ts` carried a `confidenceColor` banding at 80/60 with `var(--crit)` at
the bottom, while `vendor/ui/primitives/ConfidenceNum.tsx:5` — what `FindingCard`,
`FindingsPreview` and `Showcase` all render — bands at 85/65 with `var(--text-muted)`. A
candidate at 82% was green on the conventions screen and amber everywhere else; at 50%, red
here and muted everywhere else. The doc comment claimed "on the same thresholds the findings
list uses", which is what kept it invisible: the comment was the only place the two were
compared, and it was wrong.

Fixed by rendering `<ConfidenceNum>` and deleting the local table, so `vendor/` stayed
untouched — the vendored primitive keeps no exported band table, so the alternative would have
meant editing a read-only copy. The bar keeps `ProgressBar`'s default accent and the band is
stated once. Two things worth copying: a colour rule whose only cross-check is a comment will
drift, so pin it with a test that renders the vendored primitive alongside and compares
`outerHTML` (`ConventionCard.test.tsx`, "bands the confidence exactly as the findings list
does") — and jsdom *does* preserve `var(--warn)` in an inline style attribute, so
`expect(html).toContain("var(--warn)")` is a real assertion here, not a vacuous one.

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

### A second route consuming a `_components/` folder is the promotion signal

The Conventions screen needed the skill body editor and the skill-type list, both of which
lived under `app/skills/_components/`. Importing them across routes typechecks and lints
cleanly, so nothing stops you — `/pr-self-review` did, citing `frontend-architecture`'s
promotion rule. `SkillBodyEditor` moved to `components/skill-body-editor/` and `TYPE_VALUES`
to `components/skill-type/values.ts`, with all five importers repointed in the same commit.
The same argument moved `renderWithProviders` out of `test/skills.tsx` into `test/render.tsx`:
a QueryClient/next-intl/Toast wrapper was never about skills, and a second domain importing
it from a first domain's fixture is the same violation wearing test clothes.

### A cross-tab jump needs one URL write, not one per key

A Smart Diff severity chip sends the reader to that finding in the Agent runs tab. That is
three query params at once — `tab=findings`, `finding=<id>`, and `sev=null` to clear a filter
that could hide the target. The page had `setParam(key, val)`, and calling it three times
does NOT work: each call builds its params from the same captured `search`, so three
`router.replace` calls race and the last one wins while the other two vanish. `setParams`
takes a record and writes once (`pulls/[number]/page.tsx`).

Downstream, revealing the finding is three separate obligations, and missing any one leaves
the reader staring at the wrong thing:

- the accordion holding it must open (`ReviewRunAccordion`, keyed off `findings.some(...)`);
- the card must expand — `defaultExpanded={i === 0 || f.id === targetFindingId}`;
- `hideLow` must lift if the target is under the confidence cut, or the panel scrolls to a
  card it just filtered out.

Only the panel scrolls. The accordion already scrolls itself for the Timeline's
`targetRunId`, and letting both fire means two smooth scrolls racing to different offsets —
so the accordion opens silently when the target is a finding rather than a run.

The anchor was already there: `FindingCard` has carried `data-finding-id` since A2. Reach it
with `CSS.escape` rather than interpolating an id straight into a selector.

### Controlled state is right only while something outside genuinely opens the card

`FileCard` owns its `open`. Smart Diff needed `open` + `onOpenChange` on it, then briefly did
not, then needed them again — and the round trip is the lesson, not the outcome.

The badge in a file header scrolls the diff to that file's first cited line. A collapsed card
has no such line in the DOM, so the PARENT must expand it first, which a card owning its own
state cannot be told to do. When the design moved to severity chips that jump to the Agent runs
tab instead, nothing outside needed to open a card any more — and the controlled plumbing stayed
behind as a `Record<path, boolean>` that only mirrored state the card already held. Deleting it
cost nothing and no test changed. Restoring the badge brought the real requirement back.

Two things worth keeping either way. `defaultOpen` alone covers "start collapsed however small
the diff is" — that needs no controlled mode, and Smart Diff uses it for boilerplate. And the
viewer stores EXPLICIT toggles only, falling back to a role default for any path it has not
seen: a full open-state map would re-collapse whatever the reviewer opened on every refetch.

Scrolling is a two-step, and the second cannot be inlined into the click handler:

1. click → `setToggled({...,[path]: true})` **and** `setPending({path, line})`;
2. `useEffect` on `pending` → `getElementById(lineDomId(path, line))?.scrollIntoView(...)`.

Calling `scrollIntoView` in the handler finds nothing, because the element renders in the commit
the handler schedules. The id format is a shared helper (`lineDomId`) because producer and
consumer disagreeing does not throw — `getElementById` returns `null` and the page sits still.
The badge does need `e.stopPropagation()`: it sits INSIDE the header whose own `onClick` toggles
the card. A chip on a diff LINE does not, because the file body is a sibling of that header
rather than a descendant — a `stopPropagation` there stops nothing, and the test asserting it
could never fail.

### A field whose value is a prefix of a neighbour's breaks `getByText` before it breaks the UI

`ProjectContextView`'s `DocRow` shows the scan root beside the path, and the kind badge is the
root's FIRST segment — so a document under `docs` renders "docs" twice and
`screen.getByText("docs")` throws *found multiple elements* in a test that used to pass. The
fixture now uses nested roots (`docs/adr`, `specs/api`) because that is the case the element
exists for: with `docs` and `docs/adr` both configured, the path prefix does not say which of
the two claimed the document and the badge cannot — it reads `docs` either way. The root also
carries a `title` (`"Found under the {root} root"`), which gives the test a query that stays
unique whatever the text is.

**Correction, 2026-08-14.** The row no longer prints the root at all: the list is grouped, the
root is printed once in the group header (which keeps the `rootTitle` `title`) and the row shows
`doc.path` relative to it. Two queries survive the change and are the ones to reach for —
`getAllByTitle(/^Found under the/)` counts GROUPS, and `getByTitle(<full path>)` finds a ROW,
whose visible text is now only the label.

### One scan root can hold documents of several kinds, and only `.devdigest` does

A document's `kind` is the first segment of its path — except under `.devdigest`, where the root
is a container and the segment BELOW it decides (`server/src/modules/context/helpers.ts`,
`kindForRoot`). Measured against the running API on 2026-08-14: `POST /repos/:id/context/docs`
with `.devdigest/specs/p3-smoke.md` answers `root: ".devdigest", kind: "specs"`, while
`.devdigest/notes.md` is `other`.

So any UI that groups by `doc.root` cannot hang one kind badge on the group and be right —
`.devdigest` is the group every repository now has, because it is a scan root of all of them.
`ProjectContextView/helpers.ts` returns `kind: null` for a group whose rows disagree, and
`DocList` then puts the badge on the rows instead. Do not "simplify" that to `rows[0].doc.kind`.

### A pane can only own its scroll once the PAGE stops growing, and that is one CSS rule

`AppFrame` gives `main` `flex: 1; min-height: 0; overflow: auto` inside a frame that is
`height: 100%` on an `html, body { height: 100% }` document — so the app already scrolls
inside `main`, not on the body. A screen that wants the Skills/Agents shape (a bounded column
with its own scroll, a head and a foot that do not move) therefore needs nothing but a
definite height on its own page root: `height: calc(100vh - 52px)`, 52px being the Topbar.
`SkillsView` spends it inline because it renders no `.dd-page`; a screen that does render one
must put it in `globals.css` — `.dd-context-page`, 2026-08-14 — because the 680px breakpoint
returns it to `height: auto` so the stacked panes scroll with the page again, and an inline
height would beat that rule. From there `flex: 1; min-height: 0` on the pane row and on the
scroll child is the whole mechanism.

### `--bg-elevated` is not a surface step in the light theme

`--bg-elevated` is `#1c1c1c` on `--bg-surface`'s `#141414` in the dark theme, but `#ffffff`
on `#fafafa` in the light one (`vendor/ui/styles.css:11-16,50-55`). A band, header or
selected row that leans on it for separation is visible in dark and effectively invisible in
light — which is how the Project Context group headers were first drawn on 2026-08-14.
`--bg-hover` (`#242424` / `#f2f2f2`) steps away from the surface in both directions, and a
selection is better carried by `--accent-bg` + `--accent`, which is a hue change rather than
a 2% luminance one. Judge any surface decision against both blocks of that file, not against
the running theme.

### A `<details>` marker cannot be hidden from `styles.ts`, so its rule lives in `globals.css`

`client/AGENTS.md` says responsive rules go in `app/globals.css` and everything else goes in a
colocated `styles.ts`. A native disclosure breaks the second half: `list-style: none` on the
`<summary>` is inlineable, but WebKit draws its own `::-webkit-details-marker`, and a
pseudo-element has no inline form at all. So `.dd-brief-disclosure > summary` and its
`::-webkit-details-marker` sit in `globals.css` under a comment saying they are NOT a breakpoint
rule — otherwise the next reader deletes them as misplaced.

The reason to pay that cost: `<details>` is the cheapest keyboard-reachable disclosure available
and needs no `useState`, which is what `RiskAreas` and `ReviewFocusSection` use for the risk
explanations and the "N more" overflow.

## Tool & Library Notes

### lucide-react stamps `class="lucide lucide-<kebab>"`, and the kebab is not always the `Icon` key

**Symptom.** You want a test that says "this row got the *shield* icon, not the fallback triangle",
and `svg` carries no `data-icon` or `name` attribute to assert on.

**Cause / fact.** lucide-react 0.469 puts the icon name in `class`. Probed on 2026-08-16:
`Icon.Shield` → `lucide lucide-shield`, `Boxes` → `lucide-boxes`, `Zap` → `lucide-zap`,
`ChevronDown` → `lucide-chevron-down`. **But `Icon.AlertTriangle` → `lucide-triangle-alert`** —
upstream renamed the icon and `vendor/ui/icons.tsx` keeps the old key, so the class does not
kebab-case the key you wrote.

**Fix.** Assert `svg.getAttribute("class")` contains `lucide-<name>`, and **scope the query to the
row**: a section heading that uses the same icon makes an unscoped assertion pass against a row
with no icon at all. When in doubt, probe rather than guess — render the icon in a scratch test and
print the class.

### `@testing-library/user-event` is not installed here — every test uses `fireEvent`

**Symptom.** `Failed to resolve import "@testing-library/user-event"` and a test file that
collects zero tests. Hit on 2026-08-05 writing `IntentCard.test.tsx` from the
`react-testing-library` skill, whose anti-pattern table says *"`fireEvent.click()` → use
`await user.click()`"*.

**Cause.** `client/package.json` carries `@testing-library/jest-dom` and
`@testing-library/react` and nothing else from that family. All 44 existing client test files
use `fireEvent` because that is what is there.

**Fix.** `import { fireEvent } from "@testing-library/react"` and drop the `async`/`await` the
skill's examples carry. Do not add the package to satisfy a skill: the skill is
project-agnostic, this package's convention is not, and a dependency added for one test file is
a supply-chain decision nobody asked for. If the whole suite ever moves, that is its own change.

### Two `vi.mock` specifiers for the same module do not merge — the later one replaces the first

**Symptom.** `[vitest] No "useAgents" export is defined on the "@/lib/hooks/agents" mock`, on a
test that plainly mocks `useAgents` a few lines above.

**Cause.** The component under test reached `lib/hooks/agents` relatively while a child reached
it as `@/lib/hooks/agents`. Both resolve to the same file — `vitest.config.ts` maps `@` to
`src` — so the two `vi.mock` factories register against one module id and the second wins,
taking the first factory's exports with it.

**Fix.** Mock the module once, through whichever specifier, and list every export the whole
rendered tree needs. `AgentEditorView.test.tsx` and `AgentEditor.test.tsx` both do this and say
so in a comment. The failure names the *export* rather than the duplication, which is what
makes it cost a round-trip.

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

**Addendum, 2026-08-05 — the rule is about the fall-through, not about the line order.**
`IntentCard` checks `isLoading` *first* of its four states and is still correct, which looks
like a contradiction until you ask where a disabled query lands. `usePrIntent(prId)` is
`enabled: !!prId`, so with no `prId` the query reports `isLoading === false` and `data ===
undefined` — the branch order then carries it to `intent == null`, the empty state, which is
the right answer for "nothing has been derived". The `RunTraceDrawer` bug was that the
fall-through went somewhere *wrong* (`noTrace`, a claim about the server), not that `isLoading`
was read early. So the check to run on a new query-backed component is: **write down what a
disabled query renders, and confirm that state is one you would want to show.** If it is not,
reorder.

### jsdom toggles `<details>` on a summary click but does not hide the closed content

**Symptom.** A disclosure test looks like it proves the callers are on screen — `getByRole
("link", …)` finds them whether the `<details>` is open or closed, so the assertion cannot
fail on a card that ships collapsed.

**Cause.** Probed on 2026-08-09 while writing `BlastRadiusCard.test.tsx`: jsdom implements the
summary activation behaviour (`summary.click()` flips `details.open` to `true`), but its
default stylesheet does not implement the content-hiding half —
`getComputedStyle(childOfClosedDetails).display` is `"block"`. Testing Library's visibility
filter therefore has nothing to filter on.

**Fix.** Use `<details>` freely — it is the cheapest accessible disclosure here and needs no
`useState` — but do not write a test that claims a row is *visible* or *hidden* through it.
Assert what the row contains and let the open/closed default be a design decision, checked in
a browser. `BlastRadiusCard` opens the first symbol that has callers so the card shows a real
call site without a click.

### mermaid both parses and renders under this jsdom suite — so a chart can be checked for real

**Symptom.** A component that feeds a generated chart to `MermaidDiagram` looks untestable:
mermaid is a browser library, and the obvious fallback is asserting the chart *contains* a
label — which passes on a chart that draws nothing.

**Cause.** Only half of mermaid needs layout. `mermaid.parse(src, { suppressErrors: true })`
works in jsdom as-is, in about 20ms; `mermaid.render(id, src)` needs one missing DOM method.

**Fix.** Import `mermaid` straight into the test (2026-08-09, mermaid 11.15, vitest 2.1.9),
`mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" })` — the same
options `MermaidDiagram.tsx:37` uses — and assert on `parse`. For `render`, stub the box
measurement first:

```ts
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 100, height: 20 }) as DOMRect;
```

The live PR #12 chart then renders to a ~500KB SVG carrying every label, in ~250ms
(`toMermaid.test.ts`). What this does **not** prove is legibility: every box is measured at the
same stubbed 100×20, so the layout in the assertion is not the layout on screen.

### `react-markdown` v9 escapes embedded HTML on its own, and GFM tables still work without `rehype-raw`

Measured 2026-08-14 by rendering one document through `components/context-doc-view/DocumentReader`
that carried `<img src=x onerror=alert(1)>`, `[click](javascript:alert(1))`,
`![shot](data:text/html;base64,…)`, an `https://` link and a pipe table, all at once. The result:
**0** `<img>` elements in the DOM, the raw tag visible as text content, exactly one anchor
(`real→https://example.com/a`), and **2** `<td>` — the table rendered.

That last number is the one to keep. The reason someone reaches for `rehype-raw` is usually a
table or an alignment that "needs HTML", and this stack renders GFM tables through `remark-gfm`
without it. So the trade the plugin offers is not "tables for a little risk" — it is stored XSS
from a public repository's README in exchange for nothing this app is missing. Same for
`dangerouslySetInnerHTML`. `AC-56` forbids both, and `DocumentReader.tsx`'s header comment says so
at the call site.

Two layers below the component already refuse a `javascript:` URL — `react-markdown`'s default
`urlTransform` rewrites it to `""`, and React blocks such an `href` at the DOM — which is why
`isSafeUrl` is unit-tested directly in `components/context-doc-view/helpers.test.ts`. A
rendering-only assertion passes whether that function works or not.

### A fixture that trips two independent gates at once tests exactly one of them

**Symptom.** `lineFor` refuses a line number when `index_matches_head` is false **or** when
`link_sha` is null — two independent gates, per AC-61. The test named "renders every reference as
text when there is no commit to link them at" set `{ linkSha: null, indexMatchesHead: false }`,
because that is the pair a real stale record carries. Deleting the `linkSha == null` line from
`lineFor` left the whole suite green: the first gate had already returned.

**Cause.** Realistic fixtures correlate. The state the server actually produces trips several
guards together, so a test written from a real payload can only ever pin the guard that fires
first.

**Fix.** For a predicate with N independent gates, write N fixtures that each violate exactly one
and satisfy the rest — even when the combination cannot occur in production
(`{ linkSha: null, indexMatchesHead: true }` here). Then prove it: comment out one gate at a time
and confirm the suite goes red. On 2026-08-16 a 23-mutation sweep over the PR Brief composition
found exactly two survivors, and this was one; the other was a `?? null` normalisation whose only
observable difference needed a fixture with `head_sha: undefined`, which no realistic payload from
a *current* server would carry.

### `toHaveStyle({ minWidth: "0px" })` never matches a `min-width: 0` declaration

jsdom keeps a declaration as it was written — React renders `{ minWidth: 0 }` as `min-width: 0`, and
`toHaveStyle` compares the two strings, so the `0px` you would write by habit fails against a
component that is correct. Assert `minWidth: "0"`. The failure output is no help: jest-dom prints the
whole expected block with no "received", so a one-property mismatch reads as though every property is
missing (2026-08-17, `BriefRef.test.tsx`).

## Recurring Errors & Fixes

### `pnpm typecheck` fails on routes that do not exist on the branch you are standing on

**Symptom.** Six `TS2307: Cannot find module '../../../../src/app/skills/page.js'` errors,
all inside `.next/types/`, on a branch that never had a `/skills` route. Hit on 2026-08-03
running the `/pr-self-review` gate on a branch cut from `main`.

**Cause.** `tsconfig.json` includes `.next/types/**/*.ts`, and those files are generated by
`next build` from whatever routes existed then. A production build made on another branch
leaves a validator pointing at pages this branch does not have.

**Fix.** Move the generated types aside, run, put them back:
`mv .next/types /tmp/next-types && pnpm typecheck && mv /tmp/next-types .next/types`.
Do **not** `rm -rf .next` to clear it — if `pnpm start` is serving the app on :3000, that
takes the whole app down (see the `next dev` entry below, same blast radius).

### `getByDisplayValue` collapses newlines, so it never finds a multi-line textarea

**Symptom.** `Unable to find an element with the display value: "# Rubric\nList every branch."`,
while the printed DOM shows a textarea holding exactly that.

**Cause.** Testing Library runs its default normalizer over the value, collapsing every run of
whitespace — including `\n` — to a single space. The needle keeps its newline, so it can never
match. Single-line inputs are unaffected, which is why this only bites on the body editor.

**Fix.** Query by label and assert the value: `expect(screen.getByLabelText("Skill body
(Markdown)")).toHaveValue("# Rubric\nList every branch.")`. `ConfigTab.test.tsx` does this.

### Running `next dev` beside `next start` strips the CSS off the served app

**Symptom.** The app on `:3000` renders as unstyled HTML. Every asset request —
`/_next/static/css/<hash>.css` and every JS chunk — returns **400**, from Next itself
(`X-Powered-By: Next.js`), on a plain `curl` as well as in the browser. The page still
returns 200, so it looks like a CSS bug rather than a build one.

**Cause.** `next dev` and `next start` share one `client/.next`. Starting a dev server in the
same checkout — even on a different port, for a different purpose — overwrites the production
build's assets: dev emits `static/css/app/layout.css` and empties `BUILD_ID`, while the
already-served HTML still points at the production `static/css/e8c45e3aa3e80c6c.css`, which no
longer exists. Observed 2026-08-03: a dev server started on `:3100` to read an unminified
error broke the production server on `:3000`.

**Fix.** Do not run both against one checkout. Confirm what the HTML asks for actually exists:

```sh
REF=$(curl -s localhost:3000/skills | grep -o '/_next/static/css/[^"]*\.css' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' "localhost:3000$REF"   # 400 ⇒ .next was clobbered
```

Recover with `rm -rf .next && pnpm build`, then restart. An empty `.next/BUILD_ID` is the
quickest tell that a dev server has been through the directory.

Related: `next start` serves a build and watches nothing, so a route added on a branch will
404 until someone rebuilds — which reads like "the page does not exist" rather than "the
build is stale".

### `pnpm build` takes down the running `next dev`, and the first symptom is on an unrelated page

**Symptom.** 2026-08-14, with `./scripts/dev.sh` serving `:3000`: `pnpm build` reports
`✓ Compiled successfully` and every route in its table, and immediately afterwards
`/repos/:id/context` answers **500** with
`Cannot find module './vendor-chunks/recharts.js'` — from a page that imports no chart.
Clearing the module and re-requesting only moves the name (`recharts.js` → `lodash.js`).
`/repos/:id/conventions`, `/repos/:id/pulls` and `/settings/general` are 500 too, while
`/`, `/skills`, `/agents` and `/onboarding` stay 200 — so it reads as "the page I just
edited is broken" when nothing on that page is.

**Cause.** Both commands own one `client/.next`. `next dev` emits one file per npm package
under `.next/server/vendor-chunks/`; `next build` wipes the directory and bundles differently,
leaving `@swc.js` and `next.js` behind. A route already loaded into the dev server's module
cache keeps serving from memory — that is the whole 200/500 split — while a route requested
for the FIRST time after the build has to read chunks that no longer exist. The dev compiler's
in-memory asset state still believes it emitted them, so neither a source `touch` nor
`rm -rf .next/cache/webpack` brings them back. Only a new process does.

**Fix.** Restart the dev server: `rm -rf client/.next` then `./scripts/dev.sh`. To avoid it,
run `pnpm build` when nothing is serving that checkout — and if a gate list demands the build
(the `client` gates do), expect to hand the page back with "restart dev before you look".

**Second form, 2026-08-15 — same cause, different directory, and `curl` says it is fine.**
The next `pnpm build` on this branch produced no 500 at all. Every route answered **200**, and
the page rendered as unstyled HTML: serif body text, blue underlined links, no layout, and an
empty content area. `curl -o /dev/null -w '%{http_code}'` reported `200` for the document and
was the only check run, so the page was reported working when nothing on it was.

The document is served by the dev server from memory; what 404s is everything it references.
`list_network_requests` in a real browser shows it in one screen:

```
/_next/static/css/app/layout.css   404   ← the unstyled page
/_next/static/chunks/main-app.js   404
/_next/static/chunks/app/layout.js 404
/_next/static/chunks/webpack.js    200   ← the only survivor
```

`next build` had overwritten `.next/static/` with its own content-hashed output, so the dev
server's `?v=<timestamp>` chunk names no longer exist. Same collision, same fix — `rm -rf
client/.next` and a fresh `next dev` — but two rules follow that the first form did not teach:

- **A 200 on the document proves nothing about the page.** Assets are separate requests, and a
  dev server will happily serve HTML whose every chunk is missing. `curl` cannot see that;
  a browser's network panel sees it immediately. This is the third time on this branch that
  opening the page found what a status code hid.
- **The symptom is not always an error.** The first form threw; this one rendered. A page that
  looks like 1996 rather than like a stack trace is the same defect wearing different clothes,
  and it is easy to read as a CSS regression in the change you just made.

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

### A `<ul>` in this app has no bullets, and `paddingLeft` alone does not bring them back

**Symptom.** A colocated list styled from a `styles.ts` renders as an unbroken wall of text:
no marker, and consecutive items visually indistinguishable. `IntentCard`'s scope columns
shipped this way on 2026-08-05 — the `ul` computed to `list-style: none; padding-left: 18px`
and every `li` to `margin-bottom: 0`, so 18px was reserved for a marker that never rendered.

**Cause.** Two defaults, both invisible in the component. Tailwind's preflight resets `ol, ul`
to `list-style: none; margin: 0; padding: 0` globally, and `app/globals.css:59-93` restores
markers **only** under `.dd-md` (rendered markdown). Nothing else in the app gets one back. The
`li` margin is the browser default, which is zero.

**Fix.** State both in the colocated `styles.ts`: a marker on the `ul` and separation on the
`li`. `IntentCard/styles.ts` uses `listStyleType: '"·  "'` — a CSS string marker, so it stays a
real `::marker` with no extra DOM and inherits the list's `color` instead of needing a token of
its own — plus `listItem: { marginBottom: 6 }`.

**A test for this cannot rely on the browser default.** jsdom has no preflight, so an untouched
`ul` reports `list-style-type: disc` there while the real page shows nothing. Assert the value
you set (`getComputedStyle(ul).listStyleType` contains `·`), not merely that it is not `none`.

### `PromptAssembly` gains a field and the trace drawer does not — nothing checks

**Symptom.** `run_traces.trace.prompt_assembly.intent` held 801 chars on a real run and the Run
trace drawer showed no Intent block at all. `pr_description` had been missing the same way for
longer.

**Cause.** `TraceBody.tsx` lists the legs by hand — `system, skills, memory, repo_map, specs,
callers, user` — while the contract (`vendor/shared/contracts/trace.ts`) has nine. Adding a
field to the contract type-checks on both sides and renders nothing; there is no gate that
compares the two lists, and `diff -r` only compares the vendored copies with each other.

**Fix.** When adding a field to `PromptAssembly`, three files move together: the contract (both
vendored copies), `TraceBody.tsx`, and `messages/en/runs.json` under `trace.prompt.*`, plus a
`PROMPT_COLORS` entry in the drawer's `constants.ts`. Render in the order `assemblePrompt`
pushes the sections (`reviewer-core/src/prompt.ts:125-148`), and pin that order in
`RunTraceDrawer.test.tsx` — an out-of-order block is a lie about what the model read.

### A fixture built by spreading `FIXTURE.array[0]` passes `pnpm test` and fails `pnpm typecheck`

**Symptom.** Three `TS2322: Type 'string | undefined' is not assignable to type 'string'` on
test-file lines like `symbols: [{ ...VIEW.symbols[0], caller_count: 0 }]`, while the same file
was green under `pnpm exec vitest run`. Hit on 2026-08-09 in `BlastRadiusCard.test.tsx`.

**Cause.** `client/tsconfig.json` sets `noUncheckedIndexedAccess`, so `VIEW.symbols[0]` is
`BlastSymbol | undefined`; spreading it makes **every** field optional again, and the object no
longer satisfies the array's element type. Vitest never typechecks, so only `tsc` sees it —
the same split that lets a vitest alias and a tsconfig path drift apart.

**Fix.** Hoist the element into its own annotated constant (`const SYMBOL: BlastSymbol = {…}`)
and build both the fixture and its variants from that. Do not reach for `!` or a cast: the
annotation is what keeps the fixture honest when the contract gains a field.

### Narrowing `tsconfig` to your own files turns every jest-dom matcher into a type error

**Symptom.** Two agents are building different packages of one plan in the same working tree, so
`pnpm typecheck` reports errors in files you never opened. Scoping it to your own slice with a
scratch config that `extends: "./tsconfig.json"` and narrows `include` then produces 26 fresh
errors of its own — `TS2339: Property 'toBeInTheDocument' does not exist on type
'Assertion<HTMLElement>'`, one per assertion, in test files that pass under `vitest run`. Hit on
2026-08-14 checking plan 09's P4 while P3 was mid-edit in `context/_components/`.

**Cause.** `toBeInTheDocument` and friends are declared by the module augmentation that
`src/test/setup.ts:1` pulls in (`@testing-library/jest-dom/vitest`), and that file reaches `tsc`
only because the real `include` is `**/*.ts`. A narrowed `include` drops it, so the augmentation
never loads and every matcher is missing — a failure of the scratch config, not of your code.

**Fix.** Add `"src/test/**/*.ts"` to the narrowed `include`. The check is then decisive:

```sh
cd client && cat > tsconfig.slice.json <<'EOF'
{ "extends": "./tsconfig.json",
  "include": ["next-env.d.ts", "src/test/**/*.ts", "src/components/<yours>/**/*.tsx"] }
EOF
pnpm exec tsc --noEmit -p tsconfig.slice.json; rm -f tsconfig.slice.json tsconfig.slice.tsbuildinfo
```

Do not delete the scratch config's `tsbuildinfo` sibling by hand later — `incremental: true` is
inherited, so it is written beside it on every run. And report the *whole-package* gate as it
really stands; a slice that passes is evidence about your files, not a green `pnpm typecheck`.

### A confirmation dialog over an editor makes `getByRole("button", { name: "Cancel" })` ambiguous

**Symptom.** `Found multiple elements with the role "button" and name "Cancel"` in a test that
opens a confirm dialog from a form that already has its own Cancel — `ProjectContextView`'s
tracked-save warning over the Edit footer, 2026-08-14.

**Cause.** The dialog does not replace the editor; both are mounted, so both Cancels are on
screen. The failure is in the TEST, not the UI — a human sees which one is in the modal.

**Fix.** Scope the query: `within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })`.
Renaming one of them to keep `getByRole` unique is the wrong fix — "Cancel" is the right word in
both places, and the next dialog brings the collision back.

### A `fireEvent.click` on a handler that awaits a mutation warns "not wrapped in act(...)"

**Symptom.** `An update to <Component> inside a test was not wrapped in act(...)` after a
`fireEvent.click` on a Save or Create button. The test still passes, so it is easy to leave.

**Cause.** The handler is `async` — it awaits `mutateAsync` (a mocked promise) and then calls
`setState`. `fireEvent` flushes the synchronous part inside `act`; the state change after the
`await` lands on the next microtask, outside it.

**Fix.** End the test by awaiting what the resolution changed, rather than by wrapping anything:
`await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())`, or
`await screen.findByRole("status")`. That silences the warning AND asserts the post-condition the
click was for — a click whose only proof is "the mock was called" never checks that the UI moved.

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
  (`_components/FindingsCell/`, spec `plans/L04-findings-on-the-pr-list.md`). That half
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

### 2026-08-03

- Shipped the Skills screens (`/skills`, `/skills/[id]`, the agent editor's Skills tab), then
  spent a second pass moving three of the pieces after `/pr-self-review` pointed at them. The
  pattern in all three: something read from more than one folder living inside one of them —
  `SkillBodyEditor` in `SkillDetail/_components/` with two consumers outside it, `TYPE_COLORS`
  reached from `/agents/:id` by six `../`, `TYPE_VALUES` owned by one of its three readers.
- `TYPE_COLORS` did not become a shared constant, it became `components/skill-type/SkillTypeBadge`.
  Three call sites each carried the identical `<Badge color={TYPE_COLORS[t]}>{t(\`listItem.type.${t}\`)}</Badge>`,
  so promoting the constant alone would have left the duplication in place. `severity-badge` and
  `category-tag` are the precedent for the folder shape.
- Fixing one placement created the next finding: pulling `bodyFilename` out of
  `SkillDetail/helpers.ts` left `promptBlock` alone one folder above `PreviewTab`, its only
  consumer. Misplacement has two directions and the second is easy to introduce while fixing
  the first.
- Wrote nine component test files (349 tests, up from 294). The one that mattered was
  `SkillDetail`'s `blocked` gate — the UI half of the injection refusal, where a hijacking body
  shows the toggle off and asking to enable never reaches the server. It shipped untested.
  `AgentEditor`'s `tab === "skills"` branch was the other blind spot: `SkillsTab.test.tsx`
  mounts the tab directly, so nothing covered the dispatch that makes it reachable.

### 2026-08-05

- Built the INTENT card (spec 05, step 14): `usePrIntent` / `useRecomputeIntent` in
  `lib/hooks/core.ts`, a presentational `_components/IntentCard/`, and the two-column row on
  `OverviewTab` whose second cell is an empty `aria-hidden` div reserving the BLAST RADIUS slot.
- Every one of the 14 test cases was proved falsifiable by mutating the component and watching
  it fail — nine mutations, one at a time. Two of them were worth the minutes: removing the
  `??` in `riskIcon` broke six cases, and swapping `Badge` for `Chip` broke the one asserting
  `getAllByRole("button")` has length 1. Without that second assertion nothing in the suite
  would have noticed a risk area becoming a dead `<button>`.
- The confidence badge and the risk icons are both `Map` + `??`, not object literals — the
  vendored `Badge` does `Icon[icon]` with no guard, so an unmapped string is a whole-route
  crash, and `src/lib/api.ts` never validates what the server sent.
- `messages/en/*.json` is loaded by directory listing, so `brief.json` gaining an `intent`
  block needed no wiring. In a test, `NextIntlClientProvider messages={{ brief: messages }}`
  with the JSON imported directly is enough — and importing it means the assertions read
  `messages.intent.failed` rather than a copy of the English string.

### 2026-08-14

- Promoted the Project Context reading pane into `components/context-doc-view/` (plan 09, P2):
  `DocumentReader`, `DocReadFailure`, `isSafeUrl`, `KIND_COLOR`, `readFailureReason`. Three
  surfaces will consume it — the page's pane, its `Preview` mode, and the preview control in both
  editors' Context tabs — and `AC-56` is a requirement about there being **one** of it, so the old
  `context/_components/DocumentReader/` was deleted rather than left as a re-export.
- `readFailureReason` maps `ApiError.code` to `missing` / `refused` / `binary` with a `switch`, not
  a `Record<string, …>` lookup. Proved it matters by mutating it to the object-literal form and
  running the test: `readFailureReason(new ApiError("weird", 400, "constructor"))` then returned
  `[Function Object]`. Same bug class as the `value in OBJ` entry above, but the remediation grep
  recorded there (`' in [A-Z][A-Za-z_]*'`) does **not** find this shape — the hazard is any lookup
  keyed by a string the server chose.
- Writing `messages/en/context.json` for two packages that had not been built yet made placeholder
  parameters a contract, not copy: a key like `attach.previewLabel` (`"Preview {path}"`) throws at
  render if the consumer forgets the argument. `attach.previewTitle` was therefore left parameter-
  free, and `tracked.body` takes only `{branch}` even though naming the file would read better.
  Prefer the message that cannot throw when the consumer is another agent's package.
- Built the preview control and the kind badge in both Context tabs (plan 09, P4):
  `context-docs/PreviewButton.tsx`, `context-docs/DocPreview.tsx`, and a required `repoId` prop on
  `ContextDocList` / `InheritedGroup`. Both consume P2's `context-doc-view` — no second renderer,
  and the served dev bundle for `/agents/[id]` carries six `KIND_COLOR` references and one
  `attach.previewLabel`, which is how you check a client change is really in the running app
  without a browser.
- Every one of the six new tests was proved falsifiable, in three runs: removing the badge and both
  preview controls failed all six; passing a literal `repoId="wrong-repo"` from the tab failed only
  the wiring test; and making the preview also call `onCommit` failed only the "leaves the
  attachment set alone" assertion. The last one is the point — a `not.toHaveBeenCalled()` proves
  nothing until you have seen it go red.
- `DocPreview` branches on `isSuccess`, never on `isLoading`, so the fall-through for a query that
  was never enabled is the skeleton rather than an empty document — the check the disabled-query
  entry above asks for.

### 2026-08-14 (P3 — the Project Context page rebuilt)

- The page now writes: `_components/DocActionBar` (new document / new folder / upload / rescan,
  and the page header's Rescan is gone), `_components/DocPanel` (`Preview | Edit`, the save, the
  tracked-file warning), `_components/DocList` (grouped), plus four hooks in `lib/hooks/context.ts`.
- The tracked-save confirmation is **UI-only by design**: `SaveContextDocBody` carries no
  `confirm_tracked` field and the server will never ask for one, so routing a save around
  `TrackedSaveModal` silently removes the whole warning. There is no server-side backstop to catch
  that in review — the test in `ProjectContextView.test.tsx` is the only one.
- The draft in Edit is `useState` in `DocPanel`, and `ProjectContextView` passes `key={selectedPath}`
  so selecting another document unmounts it. That `key` is what makes "the draft cannot be saved
  onto the wrong file" true; an effect resetting the state on a path change would have a render in
  between where it is not.
- Falsifiability was checked in two batched runs, each reverted: breaking the label slice, the
  shared-kind check and the upload branch of `writeErrorKey` failed 7 tests; defaulting the toggle
  to `edit`, saving without the confirm dialog, dropping the stale notice and disabling Rescan
  failed 10 — including all four untrusted-markdown tests, which is how you know they really read
  through the preview pane and not through some other surface.
- Exercised against the running API (both servers were already up): create → `201` with
  `root: ".devdigest", kind: "specs", local: true`; the same path again → `409 already_exists`;
  `docs/evil.md` → `400 invalid_path`; save → `200` and `GET …/docs/content` returns the new text;
  a repo with no clone → `409 clone_not_ready`. Those five codes are exactly what the dialogs map.

### Green `pnpm typecheck` and green `pnpm test` do not mean the client builds — only `pnpm build` does

**Symptom.** Every gate in the brief passed — `pnpm lint`, `pnpm typecheck`, `pnpm test` (638
tests), plus the whole server and `reviewer-core` side — and the Project Context page then rendered
nothing but a Next build error in a real browser on 2026-08-14:

```
Module not found: Can't resolve './contracts/findings.js'
./src/vendor/shared/index.ts (24:1)
> 24 | export * from './contracts/findings.js';
```

**Cause.** Three tools resolve a `.js` specifier three different ways, and the client had never
made them disagree. `src/vendor/shared/` is a vendored ESM package, so its internal imports carry
the extension ESM requires — `export * from './contracts/findings.js'`, and thirteen siblings the
same; `contracts/context.ts` reaches `./platform.js` the same way, so a sub-import is no escape.
`tsc` maps `./x.js` onto `x.ts`, and vitest resolves it through its `resolve.alias` plus extension
resolution. **Webpack, which is what `next dev` and `next build` run, does neither** unless
`resolve.extensionAlias` says so. Until that day the client imported only TYPES from
`@devdigest/shared` — TypeScript erases those, so webpack never resolved the barrel at all. The
first VALUE imported from it (`MAX_DOC_CHARS`) is what made webpack try, and fail. Nothing in the
gate list exercises webpack, so nothing could have caught it.

**Fix.** `client/next.config.mjs` pushes one `module.rules` entry scoped to
`/[\\/]src[\\/]vendor[\\/]shared[\\/]/` with `resolve: { extensionAlias: { ".js": [".ts", ".tsx",
".js"] } }` — per-rule rather than global, because the mapping is a property of that folder's
import style. **And run `cd client && pnpm build` whenever a change adds the first runtime import
of something vendored.** Reading a value out of a `.d.ts`-shaped world costs nothing; reading it
out of a bundler's world is a different question, and only the bundler answers it.

**Running that build has a trap of its own.** `next build` and a live `next dev` share `.next`, so
building while the dev server is up fails every page with `PageNotFoundError: Cannot find module
for page: /` — which looks like a code fault and is not. Build into another directory
(`distDir` behind an env var, removed afterwards) or stop the dev server. Next also appends
`"<distDir>/types/**/*.ts"` to `tsconfig.json` `include` on every build, so a temporary `distDir`
leaves a temporary line in `tsconfig.json` that has to come back out.

### `setQueryData` writes nothing you can read back when the test client has `gcTime: 0`

**Symptom.** `brief.test.tsx` asserted that `useComputeBrief`'s `onSuccess` writes the record
into `["brief", prId, headSha]`, and `client.getQueryData(...)` came back `undefined` while the
mutation itself reported `isSuccess`. Hit 2026-08-16.

**Cause.** The test wrapper was copied from `lib/hooks/core.test.tsx`, which builds its
`QueryClient` with `gcTime: 0` — correct there, because every test in that file mounts the query
it asserts on. `setQueryData` creates a cache entry with **no observer**, and at `gcTime: 0`
TanStack collects it immediately. The write happened; the entry was gone before the assertion.

**Fix.** Mount the query alongside the mutation, the way the component does —
`renderHook(() => ({ read: usePrBrief(id, sha), compute: useComputeBrief(id, sha) }))` — and
assert on `result.current.read.data`. That is the better assertion anyway: what a
"the mutation writes where the query reads" test should prove is that the READER now has it,
not that a cache key momentarily held it. Raising `gcTime` would have hidden the question.

### RTL's default text matcher collapses the exact whitespace a control-character test is about

**Symptom.** `screen.getByText(path)` failed with *"normalized from 'server/…/brief\t/service.ts'"*
on a case whose whole point was the TAB — and the tempting fix, matching the collapsed
`brief /service.ts`, would have passed against a card that silently dropped the character.

**Cause.** `getByText` runs both the element's text and the expected string through
`getDefaultNormalizer`, which collapses runs of whitespace and trims. A control character in the
middle of a path is whitespace to it.

**Fix.** `screen.getByText(value, { normalizer: (v) => v })`. Build the hostile input with
`String.fromCodePoint(9)` rather than a literal — the existing rule at `:365` — so the test
source stays ASCII and the character is visible in a diff.

## Open Questions

- **A dismissed critical does not move `agent_runs.blockers`, and the fix belongs on the server**
  (2026-08-17). Repro: open a PR whose completed run has `blockers > 0`, dismiss a CRITICAL finding
  on Agent runs, and both verdict banners keep the old number. The column is written once, when the
  run finishes (`server/src/modules/reviews/run-executor.ts:240`). The client must NOT paper over
  it — recounting there hardcodes CRITICAL and throws away the agent's `ciFailOn`, which is what the
  Codebase Patterns entry and its two corrections are about. Open on two counts: whether the server
  should recompute the column on a dismissal at all, and whether it should, given the same column is
  the CI gate's record of what it decided at the time rather than a live number. Until that is
  answered, the ⓘ beside the counts in `VerdictBanner` states the as-of ("counted when the run
  finished") instead of hiding it.
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

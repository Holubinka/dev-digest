# Design walk — SPEC-07 Agent Performance

Transcription of [`SPEC-07-agent-performance-dashboard.jpg`](SPEC-07-agent-performance-dashboard.jpg),
made with the image open, 2026-08-29. Every later reader is handed this file and opens the image
only to settle what the walk cannot answer — then appends the row.

`client/AGENTS.md` § *A design is an acceptance criterion* is why this exists: lint, typecheck and
RTL all pass on a screen that renders the right data in the wrong shape.

## Placement and hierarchy

| Element | Mockup | Built | Verdict |
|---|---|---|---|
| Topbar breadcrumb | one crumb, `Agent Performance` | same | matches |
| Sidebar row | `Agent Performance`, activity icon, GLOBAL section, between `Multi-Agent Review` and `CI Runs` | same, `icon: "Activity"` | matches |
| Sidebar row `Memory` above it | present | **absent** | **differs** — `SPEC-05 § N7` still puts Memory out of scope; it would lead nowhere. Same call `multi-agent/DESIGN-WALK.md` recorded |
| Page title | `Agent Performance` h1 + subtitle | same | matches |
| Subtitle text | `Which agents earn their keep — accept rate is the quality signal` | same, verbatim | matches |
| Period control | pill, top-right of the header row, calendar icon + `30 days` | same, and it opens a menu with 1 day / 30 days / Custom range… | matches |
| Summary row | four cards, equal width, one row | same | matches |
| Table | full-width card, header row + one row per agent | same | matches |
| `COST BREAKDOWN` | section label with a `$` icon, then two equal cards side by side | same (`SectionLabel icon="DollarSign"`) | matches |
| Cost provenance line | **absent** | present, under the section label | **differs — added** — AC-36/AC-37 require it; the mockup shows no place where an estimate is named as one |

## The shape of each value

| Value | Mockup | Built | Verdict |
|---|---|---|---|
| `TOTAL RUNS (30D)` | number `253`, sparkline **below** it, full card width | `MetricCard` with `trend` — sparkline sits **top-right at 56×20**, in the label row | **differs** — the kit's tile puts its sparkline in the label row and every other caller draws it there. Moving it is one screen's layout, which `client/AGENTS.md` § *vendor/ui* forbids widening a primitive for |
| `TOTAL COST (30D)` | `$8.74` with a green `-$1.20` | same | matches — needed two new `MetricCard` props, below |
| Cost delta colour | green when cost **fell** | same | **differs from the kit, not from the design** — `MetricCard` coloured a falling delta red (`--crit`). A red "cost fell" is wrong information, not styling, so the primitive gained `deltaGood: "up" \| "down"` (default `"up"`, every existing caller unchanged) |
| Cost delta prefix | `$` | same | `MetricCard` gained `deltaPrefix?: string`; it rendered a bare `1.20` before |
| `AVG ACCEPT RATE` | big `61%` + a small ring gauge reading `61` in the top-right | same | matches — `MetricCard` gained `corner?: ReactNode`, which takes the label-row slot the sparkline otherwise holds; the gauge is `CircularScore` |
| What `61%` **is** | unweighted mean of 78/64/41 | pooled `accepted / (accepted + dismissed)` | **differs** — `SPEC-07 § D2`. The criterion "show the accept-rate denominator" is what settles it: a mean of rates has no denominator |
| Accept-rate denominator | absent | `39/50` in muted text beside the percentage | **differs — added**, AC-17 / AC-24 |
| `MOST-ACTIVE AGENT` | agent colour square + icon, bold name, `142 runs · 78% accept` | same | matches — a feature-local card, not a `MetricCard`: it is an entity, not a KPI tile |
| Row agent cell | colour square + icon + name | same, colour from `lib/agent-color.ts` so the donut, the row and the tile paint one agent once | matches |
| `RUNS 30D` header | column label carries the period | same, and it re-labels with the period (`RUNS 1D`, `RUNS · CUSTOM`) | matches |
| `AVG COST` | `$0.04` | same; `—` when the agent has no costed run | matches |
| `AVG DUR.` | `6.2s` | same; `—` when no run reported a duration | matches |
| `ACCEPT` | `78% ↑` green / `41% ↓` amber | same: colour by level, arrow by comparison with the preceding window of equal length | matches |
| Accept arrow when there is no previous window | undefined by the mockup | no arrow at all | absent from mockup — a fabricated arrow is a fabricated claim |
| Small-sample marker | absent | `low sample` chip beside the rate | **differs — added**, AC-29 |
| `LAST RUN` | `4m ago` | same | matches |
| `View` | plain text link at the row end | same | matches |
| Donut legends | label + `$5.68`, right-aligned mono | `Donut` renders exactly this | matches |

## What each element does

| Element | Behaviour |
|---|---|
| Period pill | opens a menu: `1 day`, `30 days`, `Custom range…`. Custom reveals two date inputs and an Apply button. Writes `?range=` / `?from=&to=` |
| Column headers | Runs, Avg cost, Avg dur., Accept, Last run are sort toggles. Sorting is client-side over the rows already fetched — AC-31 |
| `ACCEPT ↓` | the arrow marks the **active sort**, not a trend. The per-row `↑`/`↓` beside a percentage IS a trend. Two arrows, two meanings, and the mockup uses both |
| Row | clicking anywhere but `View` expands it: severity split, accepted / dismissed / pending, cost detail, runs with no recorded cost |
| `View` | navigates to `/agents/{id}?tab=stats` |
| Donuts | static. No tooltip, no click-through |

## What the design shows that the contract could not express

| Finding | Consequence |
|---|---|
| `MOST-ACTIVE AGENT` draws a name, a run count **and** an accept rate | `AgentPerf.summary.most_active_agent` was `z.string().nullable()` — a name cannot carry the other two. Changed to an object; the contract had no consumer, so nothing broke |
| The header says `(30D)` on two tiles and `RUNS 30D` on a column | the response has to echo the resolved period, or the label and the numbers can disagree after a custom range. `AgentPerf.period` added (AC-9) |
| Three agents, three donut colours, one colour per agent across table and donut | the segment needs the agent's id, not just its name — `agent_color` is a function of the id (`lib/agent-color.ts`). `PerfAgentCostSegment.agent_id` added |
| Nothing in the mockup says where a dollar figure came from | AC-36/AC-37 have no home in the design. Added as a line under `COST BREAKDOWN` and a footnote on the cost tile |

## Appended rows

Findings from building the screen and comparing it against the image, 2026-08-29.

| Element | Mockup | Built | Verdict |
|---|---|---|---|
| Sidebar `GLOBAL` heading | one section | one section | **fixed on the way past** — `NAV` held TWO groups both named `GLOBAL`, so the sidebar drew the heading twice. Invisible while each group had one row; plainly wrong once Agent Performance made the first group two. `ci-runs` moved into the same group and `nav.test.ts` now asserts there is exactly one |
| Row agent icon | a distinct glyph per agent — shield, lightning, bulb | one `Cpu` glyph, tinted with the agent's own colour | **differs** — nothing on an agent says what KIND of reviewer it is. A glyph chosen by matching words in the name would be a guess drawn as a fact; the colour already tells two agents apart and is the same colour the donut uses |
| Cost delta | `-$1.20`, a minus sign | `↓ $1.20`, an arrow | **differs** — `MetricCard` draws a direction arrow rather than a sign, and every other tile in the app that shows a delta draws it that way. The colour, which is the part that carries the meaning, matches: green when cost fell |
| `AVG COST` precision | `$0.04` | `$0.025` | **differs** — `formatCost` (`@/components/run-cost-badge/format`) scales precision to magnitude so a sub-cent run does not collapse to `$0.00`, and four surfaces already render run cost through it. A fifth spelling of a dollar is how the PR list and this screen start disagreeing about the same run |
| Empty-period caption dates | absent from the mockup | `Jan 1` / `Jan 8` | shipped rendering the BROWSER's locale (`1 січ.`) inside an English sentence, with the abbreviation's dot beside the sentence's own. Pinned to the app's single locale |

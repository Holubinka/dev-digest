# Design walk — Multi-Agent Review screens

`client/AGENTS.md` § *A design is an acceptance criterion* requires the built screen to be walked
against the source material element by element, each answered **matches / differs / absent**, with
every difference **reported rather than resolved**. This file is that walk, written before the copy
was, and kept beside the screens it describes so the next change to them can be re-checked against
the same list.

**Sources.** `specs/assets/SPEC-05-multi-agent-review-configure-run.png`,
`…-configure-empty.png`, `…-columns.png`, `…-tabs.png`, and the prototype
`specs/assets/SPEC-05-multi-agent-review-screen.jsx`, all handed over with
`specs/SPEC-05-multi-agent-review.md` (135 acceptance criteria).

**How to read the verdict column.** *matches* — built as drawn. *differs* — drawn one way, built
another, with the authority for the change named. *absent* — the design does not show it and an
acceptance criterion requires it, so it was added; a mockup is silent about states it was not drawn
for. Nothing in the *differs* rows was decided here: each cites a spec decision (`D…`), an
acceptance criterion (`AC-…`), or a human decision dated 2026-08-26.

---

## 1. Configure run — `…-configure-run.png`, `…-configure-empty.png`, `screen.jsx § RunConfig`

| Element | Design | Built | Verdict |
|---|---|---|---|
| Breadcrumb | `Multi-Agent Review › Configure run` | same, `Multi-Agent Review` links to the landing route | matches |
| Page title | `Run a Multi-Agent Review` | same (AC-1) | matches |
| Subtitle | `Pick a pull request and choose which agents to fan out — they run in parallel and you compare their findings side by side.` | same, word for word | matches |
| Column width | one centred column, ~720px | `maxWidth: 720, margin: 0 auto` | matches |
| Step 1 marker | round `1` chip, accent background | same | matches |
| Step 1 label | `Pull request` | same (AC-1) | matches |
| PR trigger, empty | `Select a pull request…`, GitPullRequest icon, chevron | same | matches |
| PR trigger, chosen | `#482 · Add rate limiting to public API endpoints` | same shape, `#{number} · {title}` | matches |
| PR dropdown contents | `screen.jsx:113` filters `status !== "stale"` | every PR of the repo is listed, `stale` included | **differs** — D13 / AC-4: the product rule is warn, never hide. Named divergence #2 of `SPEC-05 § П'ять розходжень з макетом` |
| PR row status | not drawn | each row shows its status when it is not `open` | absent — AC-4 requires `merged`/`closed`/`stale` to be listed, and a list that shows them without saying so is a list that hides them |
| `merged`/`closed` warning | not drawn | the PR page's own warning, reused verbatim (`prReview.runReview.mergedWarning`) | absent — AC-5 requires *the same* warning the PR page shows |
| Repo with no PRs | not drawn | the dropdown says so instead of opening empty | absent — AC-6 |
| Step 2 marker | round `2`, dimmed while no PR is chosen | same | matches |
| Step 2 label | `Agents to run` | same (AC-1) | matches |
| Select all link | `Select all` at the right of the step-2 row, accent text | same, and it flips to `Clear all` (AC-10, AC-11). Shown only once a PR is chosen, as in `screen.jsx:136` | matches |
| Agent card, tick | 18px rounded checkbox, agent colour when on | same (vendored `Checkbox`) | matches |
| Agent card, tile | 30×30 tile carrying a per-agent **icon** — shield, bolt, lightbulb | `AgentMonogram`: the first character of the agent's name on the same 30×30 tile, in `agentColor(agent.id)` | **differs** — human decision 2026-08-26. `Agent` carries no icon field (`vendor/shared/contracts/knowledge.ts`), so an icon would be a contract change plus an editor plus the seeds, for a decoration |
| Agent card, line 1 | agent name, 13.5px semibold | same | matches |
| Agent card, line 2 | prose describing what that agent *found on this PR* — `Two critical exposures: a committed live key and an SSRF-shaped webhook forwarder. Block.` | the agent's `description` | **differs** — AC-7 asks for the description, and the human resolved it for the spec on 2026-08-26. The mockup's line is a past run's summary, and this card is drawn *before* the run |
| Agent card, right | `8.2s · $0.06`, mono, muted | same, from `GET /runs/last-successful`; `—` where there is no number (AC-19, AC-20, AC-21) | matches |
| Disabled agent | the `Architecture` row is drawn unticked and dimmed, with no word saying why | unticked, dimmed, **and** marked `disabled` beside the name, still selectable | absent — AC-8 requires the card to be *marked* disabled; dimming alone does not say which of "not chosen" and "switched off" it is |
| Selected card | 1px border in the agent's colour, `colour + "12"` background | same | matches |
| Workspace with no agents | not drawn | empty state with a link to the Agents screen | absent — AC-12 |
| Empty state, no PR | dashed 1px box, GitPullRequest tile, `Pick a pull request first`, `Choose which PR to review above, then select the agents to run on it.` | same, word for word (AC-2) | matches |
| CTA | primary `Users` button; `Select agents` / `Run 1 agent` / `Run multi-agent review (N)` | same three labels, reused from `prReview.runReview.*` so the PR-page picker and this screen cannot drift | matches |
| CTA while no PR is chosen | `…-configure-empty.png` draws it reading `Run multi-agent review (4)` and disabled (`screen.jsx:158` — `disabled: !pr \|\| sel.length === 0`) | same: the label follows the tick count, the button is disabled and dimmed (AC-3, AC-13…AC-15) | matches |
| Estimate | `≈ 8.2s · $0.20 · parallel fan-out`, mono, muted, beside the CTA | `≈ {time} · {cost} · in-process fan-out` | **differs** in one word — D9: the product runs agents in the server process. `parallel` is not false, but the phrase is written from what the code does rather than from the mockup's mechanism vocabulary. See the open question below on the ceiling |
| Estimate, missing agents | not drawn | `N not in the time estimate` / `N not in the cost estimate` beside it | absent — AC-22 |
| Estimate, nothing to sum | not drawn (the fixture always has numbers) | the sum renders `—`, never `0.0s` or `$0.00` | absent — AC-23 |

## 2. Results, shared chrome — `…-columns.png`, `…-tabs.png`

| Element | Design | Built | Verdict |
|---|---|---|---|
| Breadcrumb | `Multi-Agent Review › #482` (mono) | same | matches |
| `Configure run` action | bordered button, Settings icon, left of the title | same, and it carries the PR in `?pr=` (AC-43) | matches |
| Page title | `Multi-Agent Review` | same | matches |
| Sub-line | `4 selected agents · parallel` | `{n} selected agents` | **differs** — the `· parallel` half is dropped here and the honest, parameterised sentence is printed once, in the meta row. Two claims about execution, one of them unparameterised, is how the two disagree when the ceiling changes (D9) |
| View switch | segmented `Columns` / `Tabs`, top right | same, and the choice lives in `?view` (AC-83) | matches |
| `Run again` | not drawn | in the header row (AC-114…AC-117) | absent — the mockup predates the re-run decision (D21) |
| Meta row, left | `#482` mono muted, then the PR title in bold | same (AC-40) | matches |
| Meta row, right | Cpu icon + `4 agents · fan-out via worktrees · 8.2s total · $0.20` | `{n} agents · in-process fan-out, up to {c} at a time · {t} total · {cost}`, `{c}` from `MultiAgentRun.concurrency` | **differs** — D9, and named divergence #1 of `SPEC-05 § П'ять розходжень з макетом`: there is no `git worktree` anywhere in `modules/reviews` |
| Meta row, partial cost | not drawn | `≥ $0.20` with a title saying at least one run reported no cost | absent — AC-42 |
| Multi-run not found | not drawn | an error state on the page, not an empty comparison | absent — AC-95 |

## 3. Results — Columns — `…-columns.png`

| Element | Design | Built | Verdict |
|---|---|---|---|
| Grid | one card per agent, `minmax(220px, 1fr)`, 12px gap | same | matches |
| Card top edge | 2px rule in the agent's colour | same | matches |
| Header | 30×30 icon tile, name, `8.2s · $0.06`, `CircularScore` at 32px | same, with `AgentMonogram` in place of the icon (§1) and `—` where the score is null (AC-49) | **differs** in the tile only, as in §1 |
| Header, run state | not drawn | the run's state word beside the name — `queued` / `reviewing` / `run failed` / `run cancelled` / `done` | absent — AC-48. The mockup draws four finished agents and has no state to show |
| Header, failure reason | not drawn | the failed run's reason under the name | absent — AC-36 |
| Header, live line | not drawn | the last event line of a still-running column | absent — AC-78 |
| Finding row | 2px left rule in the severity colour, severity icon, title, `src/config.ts:12` mono | same, and the line renders `12` not `12-12` for a single line (AC-59, via `lineLabel`) | matches |
| Zero findings | not drawn (every fixture column has findings) | `No findings.` in words | absent — AC-52 |
| Footer | `View trace` left, `3 findings` right | same (AC-51) | matches |
| Overflow | `overflowX: auto` past five columns | same rule, in `globals.css` under `.dd-multiagent-columns` because a breakpoint owns it (`client/AGENTS.md`) | matches |
| Deleted agent | not drawn | the column still names the agent and marks it deleted | absent — AC-118 |

## 4. Results — Tabs — `…-tabs.png`

| Element | Design | Built | Verdict |
|---|---|---|---|
| Tab | per-agent icon, name, score in a score-coloured number; 2px underline in the agent's colour when selected | same, with `AgentMonogram` in place of the icon (§1) | **differs** in the tile only |
| Tab, no score | not drawn | `—` | absent — AC-49 read across to the tab (AC-54 asks for the score) |
| Selected agent header | `CircularScore` 44px, name in the agent's colour, summary paragraph, `View trace` and `8.2s · $0.06` right-aligned, 3px left rule in the agent's colour | same (AC-55) | matches |
| Header with no summary | not drawn | the summary line is not rendered at all | absent — AC-56 |
| Finding card | severity icon, title, category tag, `src/config.ts:12`, `98% conf`, chevron; expanded: rationale, `SUGGESTED FIX`, actions | the promoted `@/components/finding-card`, unchanged | matches |
| File reference | drawn as plain mono text | a link to those lines on github.com, built from `repoFullName` + the MULTI-RUN's `head_sha`; plain mono text when either is missing or the path will not encode | **differs** — deliberately, since 2026-08-26: the human lifted `SPEC-05 § Untrusted inputs`' no-link rule for this page after using it, and the same jump exists on the PR page. The path is still treated as hostile by `githubBlobUrl` |
| Actions row | `Accept` `Dismiss` `Learn` `Turn into eval case` `Reply to author` | same five, in that order (AC-60); `Learn` and `Turn into eval case` render disabled and send nothing (AC-62) | matches |
| Action icons | Accept ✓, Dismiss ✕, Learn (a split-panel glyph), Turn into eval case (flask), Reply (speech bubble) | `Check`, `X`, `Brain`, `FlaskConical`, `MessageSquare` | **differs** for `Learn` only: the mockup's glyph is not in this app's icon set (`vendor/ui/icons.tsx`), and `Brain` is the one that names what Learn does |
| Reply to author, opened | not drawn | an editable body prefilled from the finding's rationale, a `Send reply` confirm and a `Cancel`, warnings above it, the posted comment's link on success and the returned reason on failure | absent — AC-101…AC-109 were added to the spec on 2026-08-26, after the mockups |

## 5. Where agents disagree — both mockups

| Element | Design | Built | Verdict |
|---|---|---|---|
| Section label | Activity icon + `WHERE AGENTS DISAGREE` (upper-cased by `SectionLabel`) | same component, key `Where agents disagree` (AC-64) | matches |
| Toggle | `Show only conflicts` + a switch, right of the label | same, and its state lives in `?conflicts` (AC-85) | matches |
| Position header | Code icon, `src/middleware/ratelimit.ts:28` mono, then the title in bold | same, with the range rendered by `lineLabel` | matches |
| Takes grid | one equal column per take, 1px separators | same | matches |
| Take, agent name | 11.5px semibold, secondary | same (AC-45) | matches |
| Take, flagged | 7px round dot in the severity colour + the severity upper-cased + the note | same (AC-72) | matches |
| Take, did not flag | grey round dot + `did not flag` + **a note** (`Not a security concern.`) | grey round dot + `did not flag` + **no note** | **differs** — D1, and named divergence #3: no such data exists. Inventing the sentence is inventing the agent's reasoning |
| Take, run not finished | does not exist. `screen.jsx:35` computes `flagged = t.verdict !== "ignored"`, so on `not_reviewed` a failed agent would render as a yellow severity chip | a third rendering: a hollow ring — different in **shape**, not merely in shade (AC-121) — no note at all (AC-122), and a caption naming the run state in the same word the column header uses (AC-123, AC-125) | **differs** — D22, and named divergence #5. `did not flag` never appears on such a take (AC-124) |
| Takes shown | the `Magic number 3600` position carries a take from `Architecture`, an agent that is not one of the four columns | takes cover exactly the agents of this multi-run (AC-70) | **differs** — named divergence #4: an artefact of the mockup's fixture |
| Empty section | one grey line, and `runs.json` held one string for it | four different texts, resolved in the order AC-110 → AC-129 → AC-111 → AC-112, sharing no string (AC-113, AC-132); the second names three numbers and offers the re-run when nothing is still going (AC-129…AC-131) | absent — the mockup draws a populated section only |
| Not-final mark | not drawn | a visible mark on the section while any run is non-terminal (AC-133), kept on screen with the previous positions if a recompute fails (AC-135) | absent — D24 was added on 2026-08-26 |

## 6. Sidebar — visible in all four mockups

| Element | Design | Built | Verdict |
|---|---|---|---|
| GLOBAL section | four rows: `Memory`, `Multi-Agent Review`, `Agent Performance`, `CI Runs` | one row: `Multi-Agent Review` | **differs** — AC-90 asks for the single row and `SPEC-05 § N7` puts the other three out of scope; they would lead nowhere. Built by P1 (`vendor/ui/nav.ts`), recorded here because the walk covers what the mockup shows |

---

## What the mockups show that the contracts cannot express

- **The estimate's fan-out ceiling.** `…-configure-run.png` prints one line about how the run will
  execute, and the honest version of it names the concurrency ceiling (D9,
  `§ Non-functional requirements`: default **3**). That number is published to the client only on
  `MultiAgentRun.concurrency` — i.e. on a run that does not exist yet when Configure run is drawn.
  Configure run therefore names the mechanism without the number, and only the results page prints
  `up to {c} at a time`. Reported, not resolved: a shared constant beside
  `MAX_AGENTS_PER_MULTI_RUN` would fix it, and `vendor/shared` is not this package's to write.
  **Resolved 2026-08-26 (SPEC-05 amendment 3, D26):** the human took the shared constant. It is
  `DEFAULT_MULTI_RUN_CONCURRENCY` in `contracts/platform.ts`, and Configure run now names the
  number (AC-141). The two screens still read it from different places on purpose — Configure run
  from the published default, the results page from `MultiAgentRun.concurrency` — because one
  describes what a run will get and the other what a run had (AC-143, AC-144).
- **A per-agent icon.** Every mockup identifies an agent by a glyph. The contract has no field for
  one, which is why the monogram exists (§1).

## Open questions for the reviewer

1. Is `in-process fan-out` the wording the human wants on both surfaces, or should Configure run
   stay closer to the mockup's `parallel fan-out`?
2. The results header lost `· parallel` (§2). If the sub-line should keep an execution word, it has
   to be parameterised on `concurrency` like the meta row, which then says it twice.

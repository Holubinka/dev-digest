# 14 — Onboarding Tour: the client page

**Status:** Planned 2026-08-17
**Scope:** client
**Modules touched:** client
**Requirements source:** `specs/SPEC-03-onboarding-tour.md` (approved 2026-08-17, 94 criteria) and its
mockup `specs/assets/SPEC-03-onboarding-tour.png`, which is **normative for this slice** — it was
opened and read visually before this plan named a single component.
**Execution:** multi-agent (three packages, dispatched in order — see § Dispatch order)

This is slice **C** of three. Slice A (`plans/12-…-server-generation.md`) owns generation, grounding
and **both** vendored copies of the contract, including `client/src/vendor/shared/`. Slice B
(`plans/13-…-server-api.md`) owns the HTTP surface. **This plan writes no server file and no vendored
contract file.** Where it needs a field, it names the field and says who owns it.

## Requirements as understood

Every row below is a behaviour visible **on the page**. That is the partition rule this slice was cut
with: an `AC` whose observable is the stored record, the audit log or the response status belongs to
slice A or B and is listed by number under `## Out of scope`.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | A repo-scoped route `/repos/:repoId/onboarding`, thin page → colocated view, beside `context` / `conventions` / `pulls` | mockup (breadcrumb `acme/payments-api › Onboarding Tour`); `specs/SPEC-03-onboarding-tour.md § D1`; `client/AGENTS.md:18-19` | clear |
| R2 | Exactly five sections, in the mockup's order and with its headings: Architecture overview · Critical paths · How to run locally · Guided reading path · First tasks | `§ AC-1`; mockup | clear |
| R3 | The empty state describes those five sections and names no other | `§ AC-2` | clear |
| R4 | Page header: `Onboarding for <repo>` plus a provenance line carrying two separate facts — how many files the index held, and when the tour was last generated. Every number on the page comes from the response; none is derived, estimated or counted client-side; the file count is never captioned as the repository's file count | `§ AC-3`, `§ AC-75`, `§ AC-78`, `§ AC-81`; mockup (`Generated from index of 12,450 files · last refreshed 2h ago`) | clear |
| R5 | An `ON THIS PAGE` rail with five entries whose labels are the section headings | `§ AC-4`; mockup | clear |
| R6 | The active section lives in the URL as a fragment; opening that URL again lands on that section | `§ AC-5`, `§ AC-82` ("anchor") | clear |
| R7 | A `Onboarding Tour` nav row in WORKSPACE **between** Pull Requests and Project Context, `key: "onboarding-tour"`, an unused g-key, and the command palette entry that follows from it | `§ AC-6`; mockup (sidebar); `client/src/vendor/ui/nav.ts:25-38` | clear |
| R8 | The hand-maintained shortcut registry gains the matching row | `§ AC-7`; `client/src/vendor/ui/nav.ts:57-63` | clear |
| R9 | `/onboarding` keeps showing `AddRepoView` with no behaviour change — including which sidebar row is highlighted — and `e2e/specs/06-onboarding.flow.json` stays green **unedited** | `§ AC-8`; `§ D2`; `client/src/components/app-shell/helpers.ts:29` | clear |
| R10 | Architecture: prose plus the mermaid diagram; unparsable or absent diagram leaves the rest of the section and no page-level error; no diagram node is clickable; a line states the nodes are not verified paths | `§ AC-11`, `§ AC-12`, `§ AC-13`, `§ AC-77`; mockup | clear |
| R11 | Critical paths: one row per file carrying the path, its short explanation and an `Open` control; an empty chain set leaves the section in place with an explicit text and never falls back to top-ranked files | `§ AC-15`, `§ AC-16`, `§ AC-18`; mockup (`Open` button per row) | clear |
| R12 | "Opens that file" = a `github.com` blob URL built at the tour's own index sha, in a new tab. No sha, no repo name, or a path `isLinkablePath` refuses → plain mono text, never a dead control | `§ AC-16`, `§ AC-27` | **assumed** |
| R13 | How to run locally: one block per **shown** package with the package name above its commands; each command a text row with a copy control that copies the shown string byte-for-byte; no control anywhere that executes anything; a line attributing the commands to the repository; the count of packages not shown when the ceiling fired; zero packages → one explicit text naming the walk parameters the response reports | `§ AC-19`, `§ AC-20`, `§ AC-22`, `§ AC-24`, `§ AC-69`, `§ AC-90`; mockup | clear |
| R14 | Guided reading path: a numbered list, each entry a file plus the reason it sits there, each activating to that file; no chains and no ranked files → explicit text instead of a list | `§ AC-26`, `§ AC-27`, `§ AC-29`; mockup | clear |
| R15 | First tasks: a card per task with title, path and a complexity badge carrying the level **as a word**; six shown, the rest behind one disclosure carrying the hidden count; no control that creates, sends or registers a task; nothing left after grounding → explicit text, never a rendered zero | `§ AC-30`, `§ AC-33`, `§ AC-35`, `§ AC-36`; NFR *Перших тасок*; mockup | clear |
| R16 | Section headings, rail labels and complexity badges come from `messages/en/onboarding.json`. `OnboardingSection.title` from the model is **never rendered** | `§ AC-85`; `§ D20` | clear |
| R17 | Model prose renders through `DocumentReader` — the one untrusted renderer — so embedded HTML stays text and a non-`http(s)` protocol is not clickable; a path in prose becomes a link only when the server marked it verified, and an unverified one stays plain text; a section whose links were all dropped still shows its prose | `§ AC-39`, `§ AC-44`, `§ AC-68` | clear |
| R18 | A refused generation shows exactly one of three distinguishable texts — no ready index · indexing failed · language not supported — and the first promises nothing about waiting | `§ AC-83`, `§ AC-84`; `§ D19` | clear |
| R19 | No model configured → its own copy with a way to Settings, not a raw server error | `§ AC-53`; `PrBriefBanner.tsx:264-275` | clear |
| R20 | A tour built from an older index state shows a staleness note naming **both** states, and nothing regenerates by itself | `§ AC-56`; `§ D22` | clear |
| R21 | A partial index shows an incompleteness mark and how many files were skipped | `§ AC-64` | clear |
| R22 | The page lists the inputs that went into the tour with the status of each, including a sample cut by a ceiling and packages dropped by the package ceiling | `§ AC-65`, `§ AC-86` | clear |
| R23 | No stored tour → an empty state with a Generate action; no spinner and no automatic generation on open | `§ AC-62`; `§ D9` | clear |
| R24 | While a generation runs, a running state shows, and the previous tour is never presented as the new one | `§ AC-58` | clear |
| R25 | A failed generation leaves the tour on screen untouched, shows the reason beside it, and leaves the action reachable — disabled by its own in-flight mutation and by nothing else | `§ AC-60`; `client/INSIGHTS.md:460-475`, `:626-645` | clear |
| R26 | A section that came back empty stays on the page **and** in the rail | `§ AC-66` | clear |
| R27 | **The render half of `AC-67`:** no section is padded with examples, typical values or sample rows when it has no real data. The other half — not letting the model pad it in the first place — is slice A's R24 over the same criterion. Two-part by nature, and marked so a checker reads it as a split rather than a duplicate | `§ AC-67`; `INSIGHTS.md:205-212` | clear |
| R28 | `Share link` puts the current URL, including the active section's anchor, on the clipboard — nothing else | `§ AC-82`; `§ D17`, `§ N11` | clear |
| R29 | Each section is a card with an icon, its heading and a collapse control, expanded by default | mockup (the `^` chevron on every section header) | **assumed** |
| R30 | The header carries two actions, `Regenerate` and `Share link`, in that order | mockup | clear |

## Out of scope

**Left to slice A** (`plans/12-…-server-generation.md`) — generation, grounding, the prompt, the
contract and both vendored copies: **AC-10, AC-14, AC-17, AC-21, AC-23, AC-25, AC-28, AC-31, AC-32,
AC-34, AC-37, AC-38, AC-40, AC-41, AC-42, AC-43, AC-45, AC-47, AC-48, AC-49, AC-50, AC-51, AC-52,
AC-70, AC-71, AC-72, AC-76, AC-79, AC-80, AC-87, AC-88, AC-89, AC-91, AC-92, AC-93, AC-94.**

**Left to slice B** (`plans/13-…-server-api.md`) — routes, tenancy, persistence, caching:
**AC-9, AC-46, AC-54, AC-55, AC-57, AC-59, AC-61, AC-63, AC-73, AC-74.**

Two of those the client leans on and does not re-implement, which is why they are listed rather than
silently absent: **AC-9** (the page shows the existing `RepoNotFound` through `useRepoNotFound`, and
the identical answer for a foreign and a missing repository is the route's), and **AC-63 / AC-73**
(the server decides *that* generation is refused and *why*; R18 owns only the three texts).

**One criterion is genuinely shared, and it is marked rather than claimed twice.** `AC-67` is
two-part: slice A's R24 keeps the model from padding a section, R27 here keeps the page from drawing
what it was not given. Both plans state it, deliberately — half of it cannot be checked on the server
and half cannot be checked in the record.

Also out of scope, deliberately:

- **A scrollspy.** The active section is what the URL says, not what the scroll position implies. See
  `## Recommendations` #1 for the cost of the other choice.
- **Rewriting the four existing inline `navigator.clipboard` call sites** (`LiveLogStream.tsx:40`,
  `ConventionCard.tsx:45`, `RunTraceDrawer.tsx:56`, `PromptBlock.tsx:30`). This feature's two copy
  consumers sit in one route, so the control is colocated (frontend-architecture principle 2); a
  fifth consumer elsewhere is the signal to promote it, and that is not this change.
- **A new e2e flow.** `§ N8` stands. The existing `06-onboarding.flow.json` is run, not edited.
- **Any change under `client/src/vendor/shared/`.** Slice A owns it.

## What already exists

| Path | What it gives this feature |
|---|---|
| `client/messages/en/onboarding.json` | The whole namespace, already the tour's — `AddRepoView` hardcodes its own strings and reads nothing here. Carries `title`, `regenerate`, `generate.*`, `loadError.title`. Its `generate.body:10` lists **the wrong five sections** (R3) |
| `client/messages/en/shell.json:19` | `nav.onboarding-tour": "Onboarding Tour"` — the nav label already exists, so the NAV row's `key` must be exactly `onboarding-tour` |
| `client/src/components/app-shell/helpers.ts:29` | `activeKeyFor` maps **any** path containing `/onboarding` to `onboarding-tour` — today harmless because no NAV row claims that key, and a live bug the moment R7 lands (R9) |
| `client/src/vendor/ui/nav.ts:21-41,71-82` | `NAV`, `SHORTCUTS`; taken g-keys are `p d s a c ,`. `nav.test.ts` already fails a NAV row whose `gKey` has no `SHORTCUTS` entry |
| `client/src/components/app-shell/hooks/useShellCommands.ts:21-29` | The command palette entry is derived from `NAV` — R7 buys AC-6's palette half for free, and the test asserts it rather than building it |
| `client/src/components/mermaid-diagram/MermaidDiagram.tsx` | Lazy mermaid, `securityLevel: "strict"`, `parse` before `render`, returns `null` on junk — R10's failure branch, already built, zero consumers today |
| `client/src/components/context-doc-view/DocumentReader.tsx` | THE untrusted markdown renderer: `react-markdown` v9 with no `rehype-raw`, protocol check on links and images. Two consumers (`DocPreview.tsx`, `DocPanel.tsx`). R17 |
| `client/src/lib/github-urls.ts` | `githubBlobUrl`, `isLinkablePath`, `hasDotSegment` — the repo's one answer to "turn a model-written path into a control" (R12) |
| `client/src/lib/hooks/conventions.ts:8-28` | The exact shape of the read + paid-mutation pair this feature mirrors, including `setQueryData` without invalidation |
| `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx` | The closest existing screen: crumb, header with the paid action, `EmptyState` / `ErrorState` / `Skeleton` branches, and the comment explaining why mutations carry no local `onError` |
| `client/src/app/repos/[repoId]/pulls/helpers.ts:11-21` | `relativeTime` — the "2h" the provenance line needs, currently colocated to `pulls` with one consumer |
| `client/src/lib/hooks/repo-intel.ts:31-37` | `useRepoIntelStatus` — the live index state. **Not used by this page:** slice B's read envelope carries the current index state and the `stale` flag already, and a second source would be a second answer |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefBanner/PrBriefBanner.tsx:264-275` | `ApiError.code === "config_error"` → own copy + `/settings/models` link. R19 copies this exactly |
| `client/src/app/globals.css:186-320` | The `dd-` responsive block; breakpoints 900 / 1024 / 680 and the rule that a property a breakpoint changes lives **only** here |
| — | **Nothing exists** for: the page, the rail, an anchor/scroll mechanism (`grep` for `on this page` / `toc` / `scrollspy` → 0), a shared copy control, or a complexity badge |

## Constraints

| Rule | Mandated by |
|---|---|
| All data through TanStack Query hooks in `src/lib/hooks/*`; never `fetch` from a component | `client/AGENTS.md:11-12` |
| `src/lib/api.ts` does not validate at runtime — a field slice B names differently arrives as `undefined` deep inside a component, not as an error at the boundary | `client/AGENTS.md:13-15` |
| Pages stay thin; feature logic in colocated `_components/<Name>/`, each with its own `*.test.tsx` | `client/AGENTS.md:18-19` |
| Styling is typed `CSSProperties` in a colocated `styles.ts` — **not** Tailwind utility classes. The `react-best-practices` § Tailwind rules do not apply in this package | `client/AGENTS.md:20-22` |
| Any property a breakpoint changes (`flexDirection`, `width`, `padding`, `gap`) is declared **only** in `app/globals.css`, keyed on a `dd-` class the component also sets. Declared inline as well, the layout silently stops responding | `client/AGENTS.md:23-29` |
| User-facing text lives in `messages/en/*.json`, never in a `constants.ts` | frontend-architecture § folder table |
| Promotion needs a second consumer, in a different route; one consumer stays colocated | frontend-architecture principle 2 |
| Reuse before create — grep `vendor/ui`, `vendor/shared`, `src/lib` first | frontend-architecture principle 6 |
| `'use client'` on the leaf, not on a layout or a barrel; no new aggregating barrel | frontend-architecture § five-step procedure, step 5 |
| Import `lib/hooks/onboarding` **directly**, never through `@/lib/hooks` — that barrel is `export *` over five modules | `client/INSIGHTS.md:805-819`; `lib/hooks/brief.ts:9-12` |
| A security predicate gets one home and a second consumer, never a copy | `client/INSIGHTS.md:697-709`; `lib/github-urls.ts` header |
| Derived values are computed during render, never stored in `useState` | react-best-practices § Derive, Don't Store (CRITICAL) |
| `{n > 0 && …}`, never `{n && …}` — the second prints a literal `0` | react-best-practices § Conditional Rendering |
| Icon-only controls carry an `aria-label` | react-best-practices § Accessibility |
| Nothing reads `window` or `Date.now()` during render on a path Next server-renders; the fragment is read in an effect | next-best-practices § Hydration Errors |
| `client/src/vendor/shared/**` is slice A's; the `repo · vendor` gate diffs it against the server copy. This plan does not touch it | `AGENTS.md`; `.claude/skills/pr-self-review/gates.md` § repo · vendor |
| `client/src/vendor/ui/nav.ts` is the one vendored file this plan writes. Precedent: commit `4ffd260` added the Project Context row the same way. ESLint ignores `src/vendor/**`, so `nav.test.ts` is the only check that runs over it | `client/AGENTS.md:85-86`; `git show 4ffd260 -- client/src/vendor/ui/nav.ts` |

**What this slice consumes, and who owns it.** The client re-derives none of it. The names below are
`plans/13-…-server-api.md` § *Contract — what slices A and C may assume once P1 is done*, read on
2026-08-17; the adapter in `OnboardingTourView/helpers.ts` is the single file that maps them, so a
rename costs one file. Read that Contract block before writing the hook — it is repeated there in full
for exactly this reason.

| Field, as slice B publishes it | For | Owner |
|---|---|---|
| `GET /repos/:id/onboarding` → `OnboardingPage` = `{ tour, index, stale, generate_blocked }`; `POST /repos/:id/onboarding/generate` → `OnboardingRecord` | R23, R24 | B |
| `tour` — `null`, or `OnboardingRecord`, which **extends** `Onboarding`: the five sections, their bodies, diagrams, links, tasks and package blocks all flow through untouched from slice A | R2, R10…R15, R17 | A |
| `tour.index_state.{files_indexed, files_skipped, status, last_indexed_sha}` — the state the tour was **built from**; `tour.generated_at` | R4, R12, R21 | A + B |
| `index.{status, last_indexed_sha, files_indexed, files_skipped}` — the **current** facade state. `last_indexed_sha` is `""` when there is no index at all | R20 | B |
| `stale: boolean` — "never derive it on the client"; slice B's rule carries an empty-sha guard the client cannot see | R20 | B |
| `tour.inputs[]` = `{ id, status: included\|truncated\|dropped\|missing, tokens, detail }` over D13's five inputs | R22 | A + B |
| `tour.packages` = `OnboardingPackageBlock[]` — the blocks themselves: `name`, `path`, `manager` (`null` = no lock file → no install command, AC-87), `install_command`, `commands[]` | R13 | A |
| `tour.package_scan` = `{ found, shown, depth, excluded_dirs, bounded }` — the walk's facts, and **not** the blocks. `found - shown` is AC-90's number; `depth` and `excluded_dirs` are AC-24's text | R13 | A |
| `tour.generated_at` — an **ISO timestamp**, never a preformatted "2h ago". A relative string formatted on the server ages inside the cache and the page would read "2h ago" a day later; the wording is the client's, from `messages/en` | R4 | B |
| `generate_blocked: null \| "index_missing" \| "index_failed" \| "language_unsupported"` on the **read**, and the same three as 409 `error.code`s `onboarding_index_missing` / `onboarding_index_failed` / `onboarding_language_unsupported` on the write | R18 | B |
| `error.code === "config_error"` (500) · rate limit (429) · `external_service_error` (502, **the saved tour is untouched**) | R19, R25 | B |
| Verified paths in prose, marked — as markdown links with repo-relative hrefs, or as a per-section list | R17 | A |

Two consequences worth stating before anyone writes a line. **The POST holds the connection for up to
180 000 ms** (slice B, § *Timing, for slice C*) — the running state must survive that, and no
`AbortSignal` is added on the client. And **the refusal reason is available on the read**, so the page
can show R18's text before anyone presses Generate, rather than only after a 409.

The prose seam is settled by `plans/12` § its contract: every section carries
`verified_paths: string[]` — "paths inside `body` proven to exist", and the body is **never rewritten**.
That is the list P2 · 8 renders against, and it is the only thing that may turn a path in prose into a
link. The client never decides for itself that a string looks like a path; that is verification, and it
happens on the server.

**The names, settled — and the collision that made settling them urgent.** Slices A and B named six
of these differently, and on `packages` the disagreement was not cosmetic: slice B built
`OnboardingRecord = Onboarding.extend({ …, packages: <walk facts> })` while slice A puts the array of
package blocks at `packages` **inside** `Onboarding`. Zod's `.extend()` **overwrites** a colliding key,
so the facts object would have silently replaced the blocks, the whole How-to-run payload would have
left the record, and nothing would have failed: each package compiles against its own copy, and
`src/lib/api.ts` validates nothing at runtime, so the client renders `undefined` deep in a component
rather than erroring at the boundary (`client/AGENTS.md:13-15`). On screen it is an empty section.

The coordinator ruled on 2026-08-17; both server slices carry the same canon. `snake_case` throughout
(309 keys against 14 in the existing contracts). These are the names this plan reads:

| Role | Canon | Owner |
|---|---|---|
| package blocks | `packages` — `OnboardingPackageBlock[]` | A |
| walk facts | `package_scan` — `found`, `shown`, **`depth`**, `excluded_dirs` | A |
| dropped counters | `unknown_path`, `unknown_script`, `manager_mismatch`, `unknown_complexity`, **`unknown_section`** | A |
| input ids | **`repo_map`**, `package_configs`, `critical_paths`, `file_samples`, `project_docs` | A |
| refusal reasons | `index_missing`, `index_failed`, `language_unsupported` | B |
| index provenance | `index_state` | B |

Three of them are where an earlier draft of this plan read the losing side, so they are called out
rather than left to a careful reader: **`depth`, not `walk_depth`**; **`unknown_section`, not
`unknown_section_kind`**; **`repo_map`, not `repo_skeleton`**. And `packages` is the blocks — the walk
facts AC-24 and AC-90 render live in `package_scan`.

**P1 · 5 still reads the shipped `client/src/vendor/shared/` contract before typing anything.** That
obligation does not lapse because the names are settled: the vendored copy is the one source of truth
once A and B have landed, and a disagreement found there is a finding to report, not a field to invent.
The mapping lives in `OnboardingTourView/helpers.ts` — one file, whatever the wire turns out to say.

## Recommendations

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| 1 | Add an `IntersectionObserver` scrollspy so the rail follows the scroll and `Share link` copies the section actually on screen | Yes — R6 and R28 would read from scroll position instead of the fragment | ~40 lines, one hook, one more effect to test. Without it, a reader who scrolls (rather than clicks) and presses `Share link` copies the last section they clicked. AC-5 and AC-82 are met either way |
| 2 | Give `Open` a second target when the path is a scanned Project Context document, linking into `/repos/:id/context?doc=…` instead of GitHub | Yes — R12 gains a branch | Small, but it makes one control behave two ways with no visible difference, which is the trap `§ D12` names for diagram nodes. Not taken |
| 3 | Promote the copy control to `src/components/copy-button/` and repoint the four existing inline call sites | No — additive | ~1 hour and four unrelated test files. Correct once a fifth consumer exists; today it would be promotion without the second route |
| 4 | **Accepted 2026-08-17 — now a requirement, not a proposal.** `generated_at` is an ISO timestamp and never a preformatted "2h ago": a relative string formatted on the server ages inside the cache and would read "2h ago" a day later, and it would put UI text outside `messages/`, against R16. It sits in § Constraints' contract table; the coordinator carries it to the server slices | No — the plan already reads a timestamp | Zero |
| 5 | **Ruled on 2026-08-17 — the plan stands as written.** The mockup draws Critical paths as one flat list and slice A returns `flows[]`, several named flows with their own steps. P2 · 4 renders a single flow flat, as drawn, and labels each flow's rows when there are several: the mockup drew one case rather than forbidding the rest, and rendering several flows flat would glue distinct chains into one list with no boundary — an invention about the data, not about the look | No | Zero |

The steps below are written to the requirements as they stand, not to these.

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| P1 · 1-4, P3 · 1 | `next-best-practices` | App Router route file, `useParams`, and the hydration rule that keeps the fragment out of render |
| P1 · 5-6, P2 · all, P3 · all | `react-best-practices` | Component purity, derived-not-stored, `{n > 0 &&}`, `aria-label` on the icon-only copy control |
| P1 · 5-6, P2 · 1, P3 · 2 | `frontend-architecture` | Which folder each new component lands in, and whether `relativeTime` and the copy control are promoted or colocated |
| P1 · 7, P2 · all, P3 · all | `react-testing-library` | Every package ships colocated `*.test.tsx`; `@testing-library/user-event` is **not installed here** — use `fireEvent` (`client/INSIGHTS.md:1078`) |

## Work packages

### P1 — The way in: nav, data, i18n

**Agent:** implementer · **Depends on:** —

**Owns:**
- `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/nav.test.ts`
- `client/src/components/app-shell/helpers.ts`, `client/src/components/app-shell/helpers.test.ts` (new)
- `client/src/lib/hooks/onboarding.ts` (new), `client/src/lib/hooks/onboarding.test.tsx` (new)
- `client/src/lib/types.ts`
- `client/src/lib/relative-time.ts` (new), `client/src/app/repos/[repoId]/pulls/helpers.ts`,
  `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx` and any test importing `relativeTime`
- `client/messages/en/onboarding.json`

**Contract this package publishes** (P2 and P3 compile against it, and nothing else):
`useOnboardingTour(repoId)` and `useGenerateOnboardingTour(repoId)` from
`@/lib/hooks/onboarding`; the query key `["onboarding", repoId]`; the section-kind union re-exported
from `@/lib/types`; and every message key under the `onboarding` namespace listed in step 7. **P2 and
P3 add no message key** — if one is missing, it is reported, not invented in a `constants.ts`.

**Steps:**

1. **The NAV row.** In `client/src/vendor/ui/nav.ts`, insert into `WORKSPACE` **between** `pulls` and
   `context` (the mockup's order, and the order the array renders in):
   `{ key: "onboarding-tour", label: "Onboarding Tour", icon: "Workflow", href: "/repos/:repoId/onboarding", gKey: "o" }`.
   `key` is not a free choice — `messages/en/shell.json:19` already holds `nav.onboarding-tour` and the
   sidebar label is `t(\`nav.${it.key}\`)`; any other key renders an untranslated row. `gKey: "o"` because
   `p d s a c ,` are taken (`nav.ts:25-48`). Add a short comment saying both, as the `context` row does.
   *Serves R7.*
2. **The shortcut registry.** Append `{ keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" }`
   to `SHORTCUTS`. It is hand-maintained and not derived (`nav.ts:57-63`); without it the shortcut works
   and the `?` modal lies. *Serves R8.*
3. **`nav.test.ts`.** Add a `describe("nav — Onboarding Tour")` mirroring the existing Project Context
   block: the row is in WORKSPACE, its `href` is `/repos/:repoId/onboarding`, its key is
   `onboarding-tour`, its `gKey` is `o`, `SHORTCUTS` contains the exact row, and — new, because the
   mockup fixes it — its index inside WORKSPACE sits between `pulls` and `context`. The file's two
   existing tests already cover the "one half forgotten" case. *Serves R7, R8.*
4. **`activeKeyFor`, and the trap it is.** `helpers.ts:29` returns `onboarding-tour` for **any** path
   containing `/onboarding`, so once step 1 lands, standing on the add-repository screen would light up
   the Onboarding Tour row — a behaviour change on `/onboarding`, which R9 forbids. Replace that line
   with a test that matches only the repo-scoped route (`/^\/repos\/[^/]+\/onboarding/`), leaving plain
   `/onboarding` falling through to `""`, exactly as it renders today. Keep it above the `/context`
   line — order in that function is significant. New `helpers.test.ts` asserts four paths:
   `/repos/r1/onboarding` → `onboarding-tour`; `/onboarding` → `""`; `/repos/r1/context` → `context`;
   `/settings/models` → `settings`. *Serves R9, R7.*
5. **The hooks** (`client/src/lib/hooks/onboarding.ts`, `"use client"`). Mirror
   `lib/hooks/conventions.ts:8-28` and nothing else:
   - `useOnboardingTour(repoId)` — `useQuery` on `["onboarding", repoId]`, `enabled: !!repoId`,
     `api.get<OnboardingPage>(\`/repos/${repoId}/onboarding\`)`. The **page envelope**, not the tour:
     a repository with no tour answers `{ tour: null, … }`, which is data and not an error, and `index`,
     `stale` and `generate_blocked` arrive with it.
   - `useGenerateOnboardingTour(repoId)` — `useMutation` posting to
     `/repos/${repoId}/onboarding/generate`, which answers with an `OnboardingRecord`. `onSuccess`
     writes it into the same query key with `setQueryData`, **merging it into the envelope**
     (`{ ...prev, tour: record, stale: false }`, the `useUpdateConvention` shape), and does **not**
     invalidate: the response *is* the new tour, and an invalidation would empty the page for a round
     trip. Guard against `prev === undefined` the way `useUpdateConvention` does.
   - No `onError`: `lib/providers.tsx` already toasts every failed mutation with the server's message,
     and a local handler is a second copy of the same sentence (`ConventionsView.tsx:34-40`). No
     `AbortSignal` and no client-side timeout: the generation legitimately holds the connection for up
     to 180 s.
   - A header comment saying the file is imported directly and deliberately absent from
     `lib/hooks/index.ts`, with the reason (`lib/hooks/brief.ts:9-12`).
   The two route paths are `plans/13`'s § Contract, verbatim — not this plan's to invent, and not to be
   re-derived from the conventions pair.
   **Before writing the types this hook returns, open the shipped `client/src/vendor/shared/` contract
   and resolve the A/B naming divergence recorded in § Constraints** — in particular which of the two
   `packages` it turned out to be. Type the hooks against what is there; report a disagreement between
   the two copies rather than papering over it with a union. *Serves R23, R24.*
6. **Types.** Re-export the tour types from `@devdigest/shared` in `client/src/lib/types.ts`, in the
   style of the existing blocks — **types, never schemas** (`client/AGENTS.md:16-17`). Slice A owns the
   contract, so if a name is not exported yet, add nothing local: report it. The section-kind union is
   what P2's descriptor and P3's rail both key on. *Serves R2, R16.*
7. **`messages/en/onboarding.json` — every string the feature shows.** Rewrite `generate.body`, which
   today names *"overview, architecture, key modules, getting started, and conventions & gotchas"* — five
   sections this feature does not build (R3, `§ D11`). Keep `title`, `regenerate`, `regenerating`,
   `unknownError`, `generate.title`, `generate.cta`, `generate.generating`, `loadError.title` as they
   are. Add, using the mockup's own words wherever it has them:
   - `heading` (`"Onboarding for {repo}"`), `provenance`
     (`"Generated from index of {files} files · last refreshed {ago} ago"`), `onThisPage` (`"ON THIS PAGE"`),
     `shareLink` (`"Share link"`), `shareCopied`.
   - `section.architecture` … `section.firstTasks` — the five headings **verbatim from the mockup**:
     `Architecture overview`, `Critical paths`, `How to run locally`, `Guided reading path`, `First tasks`.
   - One `empty.<kind>` per section: the explicit text each shows when it has nothing (R11, R14, R15, R26).
     None of them may read as "loading", and none may claim a count of zero as a result.
   - `diagramNote` — the sentence that takes verified-path status away from the diagram's nodes (R10/AC-77).
   - `open` (`"Open"`), `copy`, `copied`, `commandsFromRepo` (names the repository as the commands' source
     and says DevDigest does not run them — R13/AC-69, AC-22).
   - `noPackages` — names the walk depth and the skipped directories **from parameters**, never as literal
     text (R13/AC-24); `packagesHidden` and `tasksHidden` — ICU plurals carrying the hidden count.
   - `complexity.low` / `.medium` / `.high` → `"Low complexity"`, `"Medium complexity"`, `"High complexity"`
     (the mockup's words; R15/AC-33).
   - `refusal.noIndex.*`, `refusal.indexFailed.*`, `refusal.unsupportedLanguage.*` — three distinct texts.
     The first says a ready index is absent and **stops there**: `IndexStatus` has no "building" state, so
     "wait, it is nearly ready" is a promise the system cannot keep (R18/AC-84).
   - `notConfigured`, `notConfiguredLink` (R19), `stale` (names both index states, R20), `partial` (ICU
     plural over skipped files, R21), `generateFailed` (R25).
   - `inputs.title`, `inputs.status.{included,truncated,dropped,missing}`, and one label per input id —
     **`inputs.id.repo_map`**, `package_configs`, `critical_paths`, `file_samples`, `project_docs`
     (R22). The ids are the canon in § Constraints; a key named for the losing spelling renders a blank
     label and nothing fails.
   Every `{count}` string is ICU plural, and its test asserts **both** branches — a hard-coded
   `"{count} packages"` satisfies a `2`-assertion forever (`client/INSIGHTS.md:400-433`). Sweep with
   `grep -n '{count}' client/messages/en/onboarding.json` before finishing. *Serves R3, R4, R5, R10, R11,
   R13, R14, R15, R16, R18, R19, R20, R21, R22, R25, R26, R28.*
8. **Promote `relativeTime`.** It moves from `app/repos/[repoId]/pulls/helpers.ts:11-21` to
   `client/src/lib/relative-time.ts` unchanged; `PRRow.tsx` and any test importing it are repointed in the
   same step. A second consumer in a different route is the promotion signal, and importing across routes
   is what `/pr-self-review` cited last time (`client/INSIGHTS.md:928-938`). `sizeOf` stays where it is.
   *Serves R4.*

**Check:** `cd client && pnpm lint && pnpm typecheck && pnpm test`.

### P2 — The five sections and their controls

**Agent:** implementer · **Depends on:** P1 (types, hooks contract, every message key)

**Owns** — all new unless marked, all under
`client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/_components/`:
- `sections.ts` (the descriptor), `SectionCard/**`, `ArchitectureSection/**`, `CriticalPathsSection/**`,
  `RunLocallySection/**`, `ReadingPathSection/**`, `FirstTasksSection/**`
- `CommandRow/**`, `ComplexityBadge/**`, `TourProse/**`, `CopyButton/**`, `hooks/useCopyToClipboard.ts`
- **existing:** `client/src/components/context-doc-view/DocumentReader.tsx` and its two call sites,
  `client/src/components/context-docs/DocPreview.tsx` and
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/_components/DocPanel/DocPanel.tsx`

**Contract this package publishes:** `SECTION_ORDER` from `./sections` — the five kinds in the mockup's
order, each with its anchor id, `IconName` and message key — plus the five section components and
`CopyButton`. P3 renders its rail from `SECTION_ORDER` and never restates the order.

**Steps:**

1. **`sections.ts`.** One array, module-level, five entries in the mockup's order:
   `architecture` (`Workflow`, `#architecture`) · `critical_paths` (`Activity`, `#critical-paths`) ·
   `how_to_run` (`Command`, `#how-to-run`) · `reading_path` (`ListChecks`, `#reading-path`) ·
   `first_tasks` (`Target`, `#first-tasks`). Icons are chosen against the mockup's glyphs and all five
   exist in `vendor/ui/icons.tsx`. Kinds come from the contract union (P1 · 6), so a rename there is a
   compile error here rather than a section that silently stops rendering. *Serves R2, R5, R29.*
2. **`SectionCard`.** The frame every section shares: a header row with the icon, the heading from
   `messages/en` (never the model's `title` — R16), the anchor `id` from the descriptor, and the
   mockup's collapse chevron. Use a native `<details open>` with the marker hidden in `globals.css` —
   the `.dd-brief-disclosure` rule at `globals.css:231-237` already does exactly this and says why a
   `styles.ts` cannot. Body is `children`. In tests, assert what the card **contains**, never
   visible/hidden: jsdom does not hide closed `<details>` content (`client/INSIGHTS.md:1160`).
   *Serves R16, R26, R29.*
3. **`ArchitectureSection`.** Prose through `TourProse` (step 8), then `MermaidDiagram` when a diagram
   string is present. Three rules, each with a test: the diagram renders **only** for this kind; a
   nullish, empty or whitespace `diagram` renders nothing at all and no empty box (`MermaidDiagram`
   already returns `null`, and an empty string must not reach it as "a diagram"); and the prose and the
   `diagramNote` line stay on screen when the diagram does not render — the failure of a diagram may not
   take the section, and must never take the page (R10/AC-12). Nothing wraps the diagram in a link and
   no `onClick` is attached: the nodes are labels, not paths (AC-13), and `securityLevel: "strict"` is
   what keeps mermaid's own `click` directives inert. *Serves R10.*
4. **`CriticalPathsSection`.** One row per step: the mono path, the model's short note, and an `Open`
   control on the right, as the mockup draws it. The control is built by the shared rule in step 7.
   Slice A returns `flows[]`, each with a `title` and its own `steps[]`, while the mockup draws **one
   flat list of four rows** — so: with a single flow, render its steps flat, exactly as drawn; with more
   than one, put the flow's `title` above its rows as a plain sub-label. It is model content, not a UI
   heading, so AC-85 is untouched — and dropping it would merge two flows into one list that reads as a
   single path. **Ruled on by the coordinator, 2026-08-17** (§ Recommendations 5): this is settled, not
   open. Say so in the component's header comment, with the date, because it is a deliberate step past
   the mockup and the next reader will otherwise take it for drift.
   A section whose `state` is `empty` → the `empty.critical_paths` text inside the card, and the card
   stays (R11/AC-18, AC-66). Never substitutes top-ranked files for missing chains.
   *Serves R11, R26, R27.*
5. **`RunLocallySection`.** One block per package: the package name as a sub-heading, then its commands
   in the order received — the server fixes both the block order and the command order (AC-92, AC-94), and
   the client reorders nothing. Each command is a `CommandRow`: mono text plus a `CopyButton` copying the
   **exact** string rendered, whole, never a truncated or re-joined version (R13/AC-20). No control that
   runs anything, anywhere in this section (AC-22). Below the blocks: the `commandsFromRepo` line (AC-69)
   and, when `tour.package_scan.found > tour.package_scan.shown`, `packagesHidden` carrying the
   **difference** (AC-90). Zero packages → `noPackages` rendered with `tour.package_scan.depth` and
   `tour.package_scan.excluded_dirs.join(", ")` — never a literal `2` and never a hand-typed directory
   list, which would be a second copy of a server constant and would drift on its first change
   (R13/AC-24).
   **The blocks are `tour.packages`; the walk's facts are `tour.package_scan`** — two different fields,
   and reading the count off the array is the collision § Constraints records. A package whose `manager`
   is `null` renders without an install command rather than with a guessed one (AC-87 is slice A's, and
   this is the render half that keeps it true). *Serves R13, R27.*
6. **`ReadingPathSection`.** An ordered list, the mockup's numbered circles, each item a path plus its
   reason underneath, each activating through the same rule as step 7. Empty → `empty.reading_path`
   inside the card. *Serves R14, R26.*
7. **The one rule for turning a path into a control** — written here in full because four sections use
   it and no other file states it. A path becomes a `github.com` blob link, opened in a new tab, **only**
   when all three hold: `tour.index_state.last_indexed_sha` is a **non-empty** string (slice B publishes
   `""` for "no index at all", so a `!= null` check passes on a value that names no commit);
   `activeRepo?.full_name` is known; and
   `isLinkablePath(path)` returns true (`@/lib/github-urls`). Otherwise it renders as `<span className="mono">`
   — plain text, never a `MonoLink` without an `href`, which is a `<button>` with nothing behind it.
   - The sha is the **tour's own index sha**, never the repository head: the path was verified against the
     clone at that state (AC-37), and a link built at another commit can open a file whose contents make
     the row a lie. `BlastRadiusCard.tsx:97-102` is the same decision — it links `link_sha`, never the
     head, and says so on screen — and `INSIGHTS.md:418-432` (the **root** file, § *A line number is only
     meaningful together with the commit it was measured at*) is what getting it wrong looked like: the
     link opened, the file existed, the line existed, and it was a comment.
   - `isLinkablePath` is not a second grounding pass: membership says the server verified the string,
     this says the string is safe inside a URL. Both must hold, and the predicate is imported, never
     restated (`client/INSIGHTS.md:697-709`).
   Put it in one component (`CriticalPathsSection/FileRef.tsx` or a sibling) imported by the sections that
   need it — one definition, four consumers. *Serves R11, R12, R14, R15.*
8. **`TourProse` and the `DocumentReader` change.** Model prose renders through the existing
   `DocumentReader` — the one untrusted renderer, and `AC-68` names having a second copy as the failure.
   Give it a **required** prop `resolvePath: ((path: string) => string | undefined) | null`, applied inside
   its existing `a` renderer: a repo-relative href (one `isSafeUrl` refuses today, because it is not
   `http(s)`) is passed to `resolvePath`, and the result either becomes the anchor or leaves the text
   plain. Both existing call sites pass `null` explicitly — required, not optional with a default, because
   a prop that selects between two whole behaviours and carries a default is invisible to `tsc`, and this
   repo has shipped that bug twice (`client/INSIGHTS.md:340-361`, `:400-433`). Do not add `rehype-raw`, do
   not open a `dangerouslySetInnerHTML` path, and do not touch the protocol checks: measured, this stack
   renders GFM tables without the plugin (`client/INSIGHTS.md:1201-1220`).
   **How a verified path arrives is settled** (`plans/12` § its contract): each section carries
   `verified_paths: string[]` — the paths inside `body` proven to exist — and the body itself is never
   rewritten. So `TourProse` takes `body` and `verified_paths`, and linkifies **only exact members of
   that list**, matched as whole strings inside text nodes, each through step 7's rule; everything else
   stays plain text. Nothing is matched by pattern, ever: a regex over prose would link an invented path,
   which is the one thing AC-39 exists to prevent. `resolvePath` then also covers the case of the model
   writing a markdown link with a repo-relative href — the href is resolved when it is a verified path
   and left unclickable otherwise, which is what `isSafeUrl` already does today. *Serves R17.*
9. **`FirstTasksSection` and `ComplexityBadge`.** A card per task: title, mono path, and the badge. The
   badge's text comes from `messages/en` keyed on the contract enum, so the level is legible without
   colour (R15/AC-33) and the wording is the UI's, not the model's (AC-85). A value outside the three is
   not normalised and not defaulted — the server already rejected it (AC-32); if one still arrives, render
   the task without a badge rather than inventing a level, and do not crash the section
   (`client/INSIGHTS.md:889-905`, where an out-of-contract severity took down a page). Six cards, the rest
   behind one disclosure carrying `tasksHidden` with the hidden count. No control creates, sends or
   registers anything (AC-36). Zero tasks → `empty.first_tasks`, never a `0` (AC-35). *Serves R15, R27.*
10. **`CopyButton` + `useCopyToClipboard`.** Icon-only button (`Copy` → `Check` for
    `COPIED_FEEDBACK_MS`), with an `aria-label` from `messages` — an icon-only control without one is
    invisible to a screen reader. The hook holds the `copied` flag and calls
    `navigator.clipboard?.writeText(text).then(ok, () => {})`: `navigator.clipboard` is undefined outside a
    secure context and absent in jsdom, so a failed copy leaves the icon alone rather than claiming success
    (`ConventionCard.tsx:41-52`). Two consumers, both in this route — colocated, not promoted
    (frontend-architecture principle 2). *Serves R13, R28.*
11. **Tests**, one file per component. The ones that must exist because nothing else would catch them:
    - `ArchitectureSection`: an unparsable diagram leaves prose + note and renders no diagram container;
      `diagram: ""` renders none either; the other four kinds never render one. Assert `parse` directly on
      a hand-built chart where the assertion has teeth — a "the chart contains the label" test passes with
      the escaping deleted (`client/INSIGHTS.md:434-459`, `:1178-1200`).
    - `CriticalPathsSection` / `ReadingPathSection` / `FirstTasksSection`: with no sha, every path is text
      and **no** anchor is in the tree; a path with a `..` segment or a control character is text
      (build the input with `String.fromCodePoint(9)`, and query with `{ normalizer: v => v }` or RTL
      collapses the very character under test — `client/INSIGHTS.md:1866-1879`); an empty list keeps the
      card and shows its text; seven tasks show six plus a disclosure reading `1`.
    - `RunLocallySection`: the copied string equals the rendered string for a command containing a `#`
      comment and a pipe; no element in the section has an `onClick` that would execute anything; zero
      packages renders the parameters it was given and not a hard-coded number; a dropped-package count
      renders in both the `1` and the `2` plural branches.
    - `DocumentReader`: the existing two call sites still render exactly as before with `null`, and a
      repo-relative href becomes an anchor only when `resolvePath` returns a URL.

**Check:** `cd client && pnpm lint && pnpm typecheck && pnpm test`.

### P3 — The page, the composition, the rail and the states

**Agent:** implementer · **Depends on:** P1 (hooks, messages), P2 (`SECTION_ORDER`, the five sections, `CopyButton`)

**Owns:**
- `client/src/app/repos/[repoId]/onboarding/page.tsx` (new)
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/{OnboardingTourView.tsx,
  OnboardingTourView.test.tsx, helpers.ts, helpers.test.ts, styles.ts, constants.ts, index.ts}` (new)
- `…/OnboardingTourView/_components/{TourHeader/**, OnThisPageRail/**, TourStates/**, InputStates/**}` (new)
- `client/src/app/globals.css`

**Steps:**

1. **The route.** `page.tsx` is the thin entry the two sibling routes already are — `"use client"`,
   `useParams<{ repoId: string }>()`, render `<OnboardingTourView repoId={params.repoId} />`, nothing else
   (`conventions/page.tsx` is the model). *Serves R1.*
2. **`OnboardingTourView`** — the only component here that owns data. It calls the two P1 hooks,
   `useActiveRepo()` and `useRepoNotFound(repoId)`, and passes everything else down as props. Crumb is
   `[{ label: repoFullName, mono: true }, { label: t("title") }]` — the same two-segment crumb the two
   sibling screens use, and exactly what the mockup shows. `repoNotFound` → `<RepoNotFound />` inside the
   shell, before anything else renders (AC-9's client half). Branch order, none masking another, each an
   early return: repo-not-found → load error → **no tour yet** → tour. A disabled TanStack v5 query reports
   `isLoading === false` with `data === undefined`, so "not asked yet" must land in a real branch and not
   in a skeleton that never resolves (`client/INSIGHTS.md:1133-1159`). *Serves R1, R23.*
3. **`TourHeader`.** `Onboarding for <repo>` — the mockup uses the **short** name in the heading
   (`payments-api`) and the full slug in the breadcrumb, so take the segment after `/`. Under it the
   provenance line: `tour.index_state.files_indexed` and `relativeTime(tour.generated_at)`, as two facts
   in one line (R4/AC-3). The count is printed as it arrives and is captioned "index of N files" — never "N
   files in the repository", because the indexer stops at `MAX_INDEXED_FILES = 5000` and the honest number
   under a dishonest caption is worse than either (AC-75, AC-81). No number on this page is computed
   client-side (AC-78). To the right, in the mockup's order: `Regenerate` (secondary, `RefreshCw`) and
   `Share link`. *Serves R4, R30.*
4. **The fragment, and what "active section" means.** `helpers.ts` gets `activeSectionFrom(hash)`:
   a fragment matching one of `SECTION_ORDER`'s anchors wins; anything else, including an empty hash,
   yields the first section. Unit-test it directly — it is the whole of R6 and R28's correctness. The view
   reads `window.location.hash` **in an effect**, never during render (hydration), keeps it in state, and
   subscribes to `hashchange` with a cleanup. *Serves R6, R28.*
5. **`OnThisPageRail`.** Built by mapping `SECTION_ORDER` — five real `<a href="#…">` anchors carrying the
   section headings from `messages/en`, so keyboard and middle-click work without a handler and the URL
   updates for free (R5, R6). The active one is styled from step 4's state. Every entry stays in the rail
   even when its section came back empty (AC-66). Scrolling to the anchor after the query resolves needs
   an effect keyed on **both** the target and whether the tour is on screen: an effect keyed on the target
   alone runs against the tree that is about to be replaced and scrolls nowhere
   (`client/INSIGHTS.md:545-566`). *Serves R5, R6, R26.*
6. **`Share link`.** Copies `window.location.href` with the active section's anchor appended when the URL
   carries none — so the copied link always names a section, which is what makes AC-5 worth having
   (`§ D17`). It uses P2's `CopyButton`/hook, shows `shareCopied` on success, and copies nothing else: not
   markdown, not an export, not a public URL (`§ N11`). *Serves R28.*
7. **`TourStates`** — every non-tour state on this page, each with its own text and none masking another:
   - **no tour** → `EmptyState` with `generate.title` / the rewritten `generate.body` / `generate.cta`,
     wired to the mutation. Nothing fires on mount (R23/AC-62).
   - **refused** → one of the three `refusal.*` texts, selected on `generate_blocked` from the read
     (`index_missing` | `index_failed` | `language_unsupported`) and, after a press, on the 409
     `error.code` (`onboarding_index_missing` | `onboarding_index_failed` |
     `onboarding_language_unsupported`). One mapping, in `helpers.ts`, unit-tested — never a generic
     apology, never a fourth text assembled from two, and never a default branch that silently picks the
     first. Because `generate_blocked` arrives on the **read**, this state renders before anyone presses
     anything, and the Generate action is not offered in it (R18/AC-83, AC-84).
   - **model not configured** → `notConfigured` plus the `/settings/models` link, keyed on
     `ApiError.code === "config_error"` exactly as `PrBriefBanner.tsx:264-275` does (R19/AC-53).
   - **generating** → the running state, with the previous tour never captioned as the new one (R24/AC-58).
   - **generation failed** → `generateFailed` plus the server's own sentence, rendered **beside** the tour
     that is still on screen. Derive "is there a tour" from `data` alone and never from the mutation's
     error: `useMutation().error` is sticky, and one failed regeneration otherwise empties the page for the
     rest of the mount (R25/AC-60; `client/INSIGHTS.md:626-645`).
   - The action is disabled by `generate.isPending` **and nothing else** — a retry disabled by the state it
     recovers from is absent exactly when it is needed (`client/INSIGHTS.md:460-475`).
   *Serves R18, R19, R23, R24, R25.*
8. **`InputStates`, staleness and partiality.** Under the sections, `tour.inputs[]` — one row per input
   with its `status` word from `messages/en` and its `detail`, so a sample cut by a ceiling and packages
   dropped by the package ceiling are both visible (R22/AC-65, AC-86). Above the sections, two notes when
   they apply: the staleness note, rendered **when `stale === true`** and naming both states —
   `shortSha(tour.index_state.last_indexed_sha)` and `shortSha(index.last_indexed_sha)`, the
   `BlastRadiusCard.tsx:97-102` form — and the partial-index note with `tour.index_state.files_skipped`
   when that state was `partial` (R20, R21). **`stale` is read, never computed:** slice B's rule carries
   an empty-sha guard that stops a perfectly good tour reading as stale the moment the index row goes
   missing, and a client-side `!==` would reintroduce exactly that. `useRepoIntelStatus` is not used here
   and must not be added — the envelope already carries the current state. Neither note triggers
   anything; the staleness note is information, not a button (`§ D22`). *Serves R20, R21, R22.*
9. **The composition.** In DOM order: crumb → `TourHeader` → notes → a two-column body with
   `OnThisPageRail` on the left and the five sections on the right, mapped from `SECTION_ORDER` so their
   order cannot drift from the rail's → `InputStates`. All five cards render whatever the payload says,
   including the empty ones (AC-66), and nothing is padded with sample rows (AC-67). *Serves R2, R5, R26, R27.*
10. **CSS.** The rail/content split and its stacking live in `globals.css` on a `dd-tour-layout` class,
    **not** in `styles.ts` — an inline style beats a media query whatever the selector, and the layout then
    silently stops responding (`client/AGENTS.md:23-29`). Follow the existing block's shape: the base rule
    beside the other `dd-` rules, the collapse inside the `900px` or `1024px` query, and a comment saying
    which property is CSS's alone and why. Grid tracks use `minmax(0, 1fr)`, never `1fr` — this page is
    full of unbreakable mono paths, and the note above `.dd-overview-cards` explains what a `1fr` track
    does to them. Add the marker-hiding rule P2 · 2 needs if `.dd-brief-disclosure` cannot be reused as is.
11. **Tests** (`OnboardingTourView.test.tsx`, `helpers.test.ts`, plus one per new component):
    - **Order, not presence.** Assert the five sections appear in the mockup's order with
      `compareDocumentPosition`, in the state that has all five — three presence assertions passed for a
      whole round while a section sat in the wrong place (`client/INSIGHTS.md:110-132`). Assert the rail's
      five labels equal the five headings, and that the rail sits before the sections.
    - `activeSectionFrom` directly: a known anchor, an unknown one, an empty hash, and a hash with a
      trailing slash.
    - A failed regeneration keeps the tour rendered and shows the reason beside it; the action is still
      enabled after that failure; it is disabled only while `isPending`.
    - `config_error` renders the Settings link; each of the three refusal codes renders its own text and
      not another's; the no-index text does not contain any promise about waiting (assert on the string
      that is rendered, so a copy change cannot quietly reintroduce one).
    - An empty section keeps both its card and its rail entry.
    - Mount the query alongside the mutation when asserting that the mutation writes where the query reads
      — a `setQueryData` write into a client with `gcTime: 0` is collected before the assertion
      (`client/INSIGHTS.md:1849-1865`).
    - Use `renderWithProviders` from `src/test/render.tsx` with the `onboarding` namespace; `fireEvent`,
      not `user-event`, which is not installed here.

**Check:** `cd client && pnpm lint && pnpm typecheck && pnpm test`.

### Dispatch order

**Strictly sequential: P1 → P2 → P3.** Each package compiles only once its predecessor has landed —
P2 imports P1's types and message keys, P3 imports P2's `SECTION_ORDER` and its five sections. The
alternative is stub files, which typecheck and lie; a sequence keeps the tree green at every landing and
each package's `Check` meaningful.

The parallelism that is available, if the coordinator wants it: **P2 splits cleanly along component
boundaries** — `sections.ts` + `SectionCard` + `TourProse` + `CopyButton` in one package, and the five
section components in another, since the five never import each other. Nothing else here can be run in
parallel without two agents editing one file, which is the failure the split exists to prevent.

**This slice is not runnable end to end until slices A and B land.** Every test above passes on
hand-written fixtures, which is deliberate; `## Verification` runs once, at the end, against the real API.

## Tests

| Suite | Files | Command |
|---|---|---|
| client unit | P1: `nav.test.ts`, `app-shell/helpers.test.ts`, `lib/hooks/onboarding.test.tsx` · P2: one per component in its folder · P3: `OnboardingTourView.test.tsx`, `helpers.test.ts`, one per new component | `cd client && pnpm test` |
| server unit / integration | none — this slice writes no server file | — |
| e2e | **`e2e/specs/06-onboarding.flow.json`, run unedited**, once after P1 lands. It is the only automated check that AC-8 still holds, and P1 is where the nav and `activeKeyFor` change | `./scripts/e2e.sh` (local only; brings up an isolated stack on 5433/3101/3100) |

No new e2e flow (`§ N8`), and no `*.flow.json` is edited by anyone in this plan.

## Gates

Copied verbatim from `.claude/skills/pr-self-review/gates.md`:

```sh
cd client && pnpm lint          # eslint .
cd client && pnpm typecheck     # tsc --noEmit
cd client && pnpm test          # vitest run
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

The last two run on every branch regardless of what changed. The vendor diff must be clean **without
this plan having touched either copy** — if it fails here, the drift is slice A's to resolve, not this
slice's to patch. No `server` gate applies: nothing under `server/` is written.

## Risks (from INSIGHTS.md)

| Already cost someone time | What this plan does |
|---|---|
| "An optional prop with a `= false` default disables a whole feature in silence" (`client/INSIGHTS.md:340-361`), and it "shipped a second time" (`:400-433`) | `DocumentReader`'s `resolvePath` is **required**, so both existing call sites become compile errors until they pass `null` (P2 · 8) |
| "A placement requirement needs an ORDER assertion, not three presence assertions" (`:110-132`) | The five sections and the rail are asserted with `compareDocumentPosition`, in the state that has all five (P3 · 11) |
| "A mutation's `error` is sticky, so deriving 'is there data' from it empties the page for good" (`:626-645`) | The tour is derived from `data` alone; the failure renders beside it (P3 · 7) |
| "Disabling a retry button on the state it recovers from removes it exactly when it is needed" (`:460-475`) | The action is disabled by its own `isPending` and nothing else (P3 · 7) |
| "A jump effect keyed only on its target scrolls inside the tree that is about to be replaced" (`:545-566`) | The anchor-scroll effect is keyed on the target **and** on whether the tour subtree is mounted (P3 · 5) |
| "A mermaid label built from repository content: the quotes carry it, and the test can be vacuous" (`:434-459`) | The diagram tests assert `parse` on a hand-built control, not that a chart contains a label (P2 · 11) |
| "`setQueryData` writes nothing you can read back when the test client has `gcTime: 0`" (`:1849-1865`) | The hook test mounts the query alongside the mutation (P3 · 11) |
| "RTL's default text matcher collapses the exact whitespace a control-character test is about" (`:1866-1879`) | Path-safety tests build the input with `String.fromCodePoint` and pass an identity normalizer (P2 · 11) |
| "An unexpected `severity` value takes down the whole findings page" (`:1368-1385`) | An out-of-enum `complexity` renders the task without a badge instead of throwing (P2 · 9) |
| "The cost of `useTranslations` is the test provider, so migrating two strings costs what migrating nine does" (`:906-927`) | Every string in this feature is in `messages/en/onboarding.json` from the first commit; no component hardcodes one (P1 · 7) |
| "1 skills" — a `{count}` string with no plural, asserted only on the plural branch (`:400-433`) | Every ICU plural here is asserted on **both** branches, with a `grep '{count}'` sweep before P1 finishes |
| `INSIGHTS.md:205-212` — invented rows "describe code the PR does not contain, and the rows outlive the screenshot" | R27: no section is padded; every empty section gets its own sentence, and zero is never rendered as a result |

## Alternatives rejected

- **`?section=` instead of a fragment.** It is the repo's precedent (`?doc=`, `?tab=`) and it costs a
  `router.replace` per click plus a Suspense boundary around `useSearchParams`. Rejected because AC-82
  asks for an *anchor*, a real `<a href="#…">` gives keyboard, middle-click and native scroll for nothing,
  and the rail is literally titled `ON THIS PAGE`.
- **A scrollspy driven by scroll position.** No criterion asks for it and it adds an observer plus its
  test. Offered as Recommendation #1 instead, with what it buys named.
- **A second markdown renderer for tour prose**, or `rehype-raw` to make some table work. `AC-68` names
  exactly this as the failure, and the measurement in `client/INSIGHTS.md:1201-1220` shows GFM tables
  already render without the plugin.
- **An in-app file viewer for `Open`.** The context reader serves scanned documents only, so
  `src/server.ts` would 404, and a viewer route is a server surface `§ Module interactions` does not have.
  R12 is recorded as `assumed` for exactly this reason.
- **Linkifying paths in prose by pattern on the client.** That is verification, it belongs on the server
  (AC-37), and a client-side regex would turn an invented path into a link — the one thing AC-39 exists to
  prevent.
- **Hard-coding the walk depth and excluded directories in the empty-packages copy.** Two copies of a
  server constant, drifting on the first change. P2 · 5 takes them from the response or stops.
- **Rendering `OnboardingSection.title`** because the field exists. `§ D20` and AC-85: the page would show
  two headings for one section, in two languages.

## Verification

Observable, in order, after all three slices have landed. Steps 1-4 are checkable from this slice alone.

1. `cd client && pnpm lint && pnpm typecheck && pnpm test` — green. *(all R)*
2. `grep -rn "onboarding" client/messages/en/onboarding.json` — `generate.body` names the five sections the
   page actually builds and none of `overview`, `key modules`, `conventions & gotchas`. *(R3)*
3. `./scripts/dev.sh`, then press `g` `o`: the sidebar shows **Onboarding Tour** between Pull Requests and
   Project Context, highlighted, and the route is `/repos/<id>/onboarding`. `⌘K` lists
   *Go to Onboarding Tour*; `?` lists `g o`. *(R7, R8)*
4. Open `http://localhost:3000/onboarding`: the add-repository screen renders unchanged and **no** sidebar
   row is highlighted. Then `./scripts/e2e.sh` — `06-onboarding.flow.json` passes with no edit to the file.
   *(R9)*
5. On a repository with no tour: the empty state with `Generate onboarding tour`, no spinner, and the
   network tab shows no POST until the button is pressed. *(R23)*
6. Press it. While it runs, the running state shows and no previous tour is captioned as new; when it
   returns, the five sections appear **in the mockup's order**, with the mockup's headings. *(R2, R24)*
7. Walk the screen against `specs/assets/SPEC-03-onboarding-tour.png` element by element, answering
   *matches / differs / absent* for placement, the shape of each value, every label in the design's own
   words, and what each element does — `client/AGENTS.md` § *A design is an acceptance criterion* makes this
   a requirement, and a difference is **reported**, not silently resolved either way. Known and deliberate
   divergences, which must **not** be "fixed": no `used by 14 routes` on a critical-path row (`§ D21`,
   AC-43), and a file count that is `filesIndexed` and can never read `12,450` (`§ D7`, AC-75). *(R4, R29, R30)*
8. Click each rail entry: the URL gains that section's fragment; reload the URL and the page lands on the
   same section. Press `Share link`; paste — the clipboard holds that URL, fragment included. *(R5, R6, R28)*
9. In the critical-paths section press `Open`: a new tab opens the file on GitHub **at the tour's index
   sha**, not at the branch head. Compare the sha in the URL against the one in the staleness note. *(R11, R12)*
10. In How to run locally: each block is one package, named; press a copy control and paste — the string is
    byte-identical to the one on screen, including any `#` comment; the attribution line is present; there
    is no control anywhere that would run a command. *(R13)*
11. Against a repository whose index is partial: the incompleteness note and the skipped-file count show,
    and the tour still renders. Against one with an empty import graph: Critical paths and Guided reading
    path each show their own sentence, keep their cards and keep their rail entries; neither is padded.
    *(R21, R26, R27)*
12. Against a Python or Go repository: generation is refused with the *language not supported* text, and it
    differs from the *no ready index* text, which contains no promise that waiting helps. *(R18)*
13. With no provider key on the machine: the not-configured copy and a working link to `/settings/models` —
    not a raw server error. *(R19)*
14. Regenerate against a repository whose index moved on: the staleness note names both states before the
    press and is gone after it. Then force a failure (stop the API mid-request): the tour stays on screen,
    the reason appears beside it, and the action is still pressable. *(R20, R25)*
15. End to end, through the real entry point: `./scripts/dev.sh` → sidebar → **Onboarding Tour** → Generate
    → read the five sections → open a critical-path file → copy a command → share a section link. Every
    heading, badge and button on screen is English; every piece of prose is Ukrainian; no section heading
    appears twice in two languages. *(R16, and the feature as a whole)*

## Open questions

_None._

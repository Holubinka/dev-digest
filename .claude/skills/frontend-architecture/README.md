# Frontend Architecture Skill

Card, sources and change history. The skill files hold the rules; this file holds everything
*about* the skill.

## Contents

1. [Focus](#1-focus)
2. [File map](#2-file-map)
3. [What it covers, and what it does not](#3-what-it-covers-and-what-it-does-not)
4. [Cases it is built for](#4-cases-it-is-built-for)
5. [Related skills, and who owns what](#5-related-skills-and-who-owns-what)
6. [Sources](#6-sources) — all 41, grouped A–G and N
7. [Conflicts this skill resolves](#7-conflicts-this-skill-resolves)
8. [Version and changelog](#8-version-and-changelog)
9. [How this skill was tested](#9-how-this-skill-was-tested)

---

## 1. Focus

One question: **where does this piece of frontend code go, and should it be one file or
three?** Everything in the skill serves a placement or a decomposition decision — the folder
for a new component, the home for a constant, whether logic belongs in a hook or a pure
function, which side of the Server/Client boundary a file sits on.

It deliberately does **not** teach React or Next.js. It assumes both are known and answers
only the filing question, because that is the question the framework docs leave open and the
one that produces a different answer from every reviewer.

## 2. File map

Split by the question being asked, so a placement question loads one topic file rather than
the whole skill. All references are one level deep from `SKILL.md`, per the authoring guide.

| File | Lines | Holds |
|---|---|---|
| [SKILL.md](SKILL.md) | 137 | The six principles, the five-step procedure, the folder table, the sibling-skill boundary, red flags, the review checklist. Loaded whenever the skill activates. |
| [folder-structure.md](folder-structure.md) | 256 | The four strategies (flat / by-type / feature / FSD) and why this repo uses route-colocation. Colocation, the promotion rule, component folder anatomy, constants, types, styles, **utils vs helpers vs lib**, barrels, import paths, naming, the repo tree. |
| [component-organization.md](component-organization.md) | 233 | When to split and where to draw the boundary, composition over prop drilling, the three layers of logic, extracting hooks, which `hooks/` folder, the data layer, state placement, derived state. |
| [nextjs-organization.md](nextjs-organization.md) | 171 | What goes in `app/`, private folders and route groups, the `'use client'` boundary and how this repo inverts it, keeping server code out of the client graph, the three data-access approaches, Server Actions. |
| README.md | 341 | This file. |

Good/bad code pairs live inside the topic file they belong to, not in a separate
`examples.md` — one hop from the rule to its example.

## 3. What it covers, and what it does not

| Covered | Not covered — go here instead |
|---|---|
| Which folder a component, hook, constant, type or style goes in | How to write the component — `react-best-practices` |
| When one component becomes three, and on what evidence | Whether a hook has the right deps — `react-best-practices` |
| Hook vs pure function vs component body | What `loading.tsx` or `generateMetadata` do — `next-best-practices` |
| Local vs URL vs server-cache state placement | Cache semantics, `revalidate`, ISR — `next-best-practices` |
| Barrels, import aliases, naming | Testing structure — `react-testing-library` |
| Which side of the `'use client'` boundary a file belongs on | RSC error taxonomy, hydration bugs — `next-best-practices` |
| `features/` and FSD as alternatives, with their triggers | Auth, input validation, secrets — `security` |

## 4. Cases it is built for

The skill should load on prompts shaped like these:

- "Where do I put a new `X` component?" / "Should this live in `components/` or next to the page?"
- "This component is getting long — split it?"
- "Should this be a custom hook?"
- "Where do these constants / labels / colours go?"
- "`utils` or `helpers`?"
- "This filter needs to survive a reload — where does the state live?"
- "Where does `'use client'` go?" / "Can this be a Server Component?"
- Reviewing a PR that adds files and asking whether they are in the right place.

It should **not** load for "why is this re-rendering", "fix this hydration error", or "write
a test for this" — those belong to the sibling skills in §3.

## 5. Related skills, and who owns what

Three skills touch React in this repo. The split is by **question asked**, not by technology:

| Skill | Answers | Owns |
|---|---|---|
| `frontend-architecture` (this) | *Where does it go?* | folders, splitting, placement, boundaries |
| `react-best-practices` | *Is it written correctly?* | purity, hooks misuse, keys, memoization, a11y |
| `next-best-practices` | *What does the framework do?* | file conventions, RSC mechanics, metadata, caching |

**They overlap in two places, resolved as follows.**

*Line and prop limits.* `react-best-practices` states "max 200 lines per component" and
"max 5–7 props". This skill treats those as a prompt to check for a splitting symptom, not as
a rule — the source it rests on rejects count-based splitting outright (`[B2]`). When they
disagree, this skill wins on placement questions. `react-best-practices` now points here for
anything structural.

*The Server/Client boundary.* `next-best-practices` owns the mechanics (what the directive
does, what breaks RSC). This skill owns the placement consequence (which file gets the
directive, and what that means for the folder). Read both for new server-side work.

## 6. Sources

Every link was fetched and read while writing the skill (2026-08-01). The "What we take from
it" column records the specific claim used, so any rule can be traced back without re-reading
the source. Tags (`[A3]`, `[N1]`, …) are the ones cited across `SKILL.md` and the three topic files.

**Tier 1** — primary or authoritative (framework docs, the author of the idea).
**Tier 2** — well-known practitioner, widely cited.
**Tier 3** — supporting; used for framing, never as the sole basis for a rule.

A few entries (A2, C4, C5, D3, G1–G3, N5) carry no inline tag: they were read and shaped the
conclusions but no single rule rests on them. Section **G** properly belongs to
`react-best-practices`; it is kept here so the research record stays whole.

### A. Folder structure and where components live

| # | Source | Tier | What we take from it |
|---|---|---|---|
| A1 | [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | 1 | The `src/{app,components,config,features,hooks,lib,stores,testing,types,utils}` tree; per-feature segments; unidirectional flow `shared → features → app`; the `import/no-restricted-paths` zones enforcing it; `lib/` = preconfigured integrations. |
| A2 | [bulletproof-react — project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) | 1 | Lint/format/naming standards backing the structure. |
| A3 | [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) | 1 | Colocation inside `app/` is safe — a folder is not routable until it holds `page`/`route`. Private folders `_folder` opt out of routing. Route groups `(group)`. The three sanctioned strategies, including **split by feature/route**. |
| A4 | [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) | 1 | Layers `app → pages → widgets → features → entities → shared`; "modules on one layer can only import from layers strictly below". |
| A5 | [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments) | 1 | Segment vocabulary `ui / api / model / lib / config`; public API per slice; zero coupling, high cohesion. |
| A6 | [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/) | 2 | The staged progression from one file to feature folders to packages. Per-component file layout. Only *reusable* hooks belong in `hooks/`; styles live in the component folder; types and constants colocate and are promoted on sharing. |
| A7 | [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) | 2 | The counter-argument to feature folders. One component per directory with an `index.ts` forwarder. **helpers = project-specific, utils = portable.** "Promote when reused." |
| A8 | [Profy.dev — Screaming Architecture](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) | 2 | Global `contexts/` and `hooks/` folders become dumping grounds. Two entry points (features + pages). Structure should name the business, not the framework. ([Canonical URL](https://profy.dev/article/react-folder-structure) did not resolve; DEV mirror used.) |
| A9 | [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) | 1 | "Place code as close to where it's relevant as possible." Benefits: maintainability, applicability, ease of use. Tests beside their module. Utilities stay in the consuming file until reuse appears. E2E tests are the exception. |

### B. How to split a component

| # | Source | Tier | What we take from it |
|---|---|---|---|
| B1 | [React docs — Thinking in React](https://react.dev/learn/thinking-in-react) | 1 | Three ways to draw boundaries: single responsibility, CSS selectors, the data model. The three questions that disqualify data from being state, and the common-owner algorithm. |
| B2 | [Kent C. Dodds — When to break up a component](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) | 1 | The symptom list, and the explicit rejection of size-based rules — "don't be afraid of a growing component until you start experiencing real problems". Sandi Metz: "duplication is far cheaper than the wrong abstraction". |
| B3 | [React docs — Keeping Components Pure](https://react.dev/learn/keeping-components-pure) | 1 | "Minds its own business" + "same inputs, same output". Side effects in event handlers first, `useEffect` last. Local mutation of same-render objects is allowed. |
| B4 | [patterns.dev — Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) | 2 | The pattern and its trade-offs; hooks achieve the same separation without the wrapper. |
| B5 | [Dan Abramov — Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) | 1 | The author's retraction: "I don't suggest splitting your components like this anymore." |
| B6 | [React docs — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) | 1 | "Before you use context": pass props, then extract components and pass JSX as `children`. Valid uses: theming, account, routing, deep state. |

### C. Where business logic lives

| # | Source | Tier | What we take from it |
|---|---|---|---|
| C1 | [React docs — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | 1 | `use` + capital letter. **A function that calls no hooks must not be a hook.** Hooks share stateful *logic*, not state. Concrete use cases only; no `useMount`/`useEffectOnce`. Extract when duplicated, complex, or nameable. |
| C2 | [React docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | 1 | The twelve cases and their alternatives: derive during render, `useMemo`, reset with `key`, adjust during render, event handlers, shared handler, no Effect chains, init guard, controlled component, parent fetches, `useSyncExternalStore`, race-condition cleanup. |
| C3 | [React docs — Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) | 1 | Group related; avoid contradictions; avoid redundancy; avoid duplication; avoid deep nesting. |
| C4 | [Profy.dev — Clean(er) React Architecture: Business Logic](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection) | 2 | Business logic as pure functions independent of React; application logic in hooks. |
| C5 | [Felix Gerschau — Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) | 3 | What a hook can reach (context, state) that a plain module cannot. |
| C6 | [TkDodo — Practical React Query](https://tkdodo.eu/blog/practical-react-query) | 2 | Wrap `useQuery` in a custom hook. "If you get data from `useQuery`, try not to put that data into local state." Query keys behave like a dependency array. Hooks live in a per-feature file. |
| C7 | [TkDodo — Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys) | 2 | One key factory per feature, generic → specific, beside the queries rather than in a global registry. |

### D. Constants, utils, barrels, naming

| # | Source | Tier | What we take from it |
|---|---|---|---|
| D1 | [TkDodo — Please stop using barrel files](https://tkdodo.eu/blog/please-stop-using-barrel-files) | 2 | Circular imports that crash bundlers; a real Next.js project went 11k → 3.5k modules after removal; `optimizePackageImports` cannot optimize a barrel with any non-re-export line. Only exception: a library's published entry point. |
| D2 | [Next.js — `optimizePackageImports`](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports) | 1 | The framework-level mitigation, and its limits. |
| D3 | [Josh W. Comeau — file structure](https://www.joshwcomeau.com/react/file-structure/) | 2 | `src/constants.ts` app-wide, `Component.helpers.ts` local. (Same source as A7.) |
| D4 | [DEV — Are `utils` a code smell?](https://dev.to/noway/are-utils-folder-where-you-put-random-stuff-you-don-t-know-where-to-put-otherwise-a-code-smell-3054) | 3 | The dumping-ground failure mode the promotion rule prevents. |
| D5 | [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/tree/master/react) | 1 | PascalCase filenames matching the exported component; PascalCase components, camelCase instances. |
| D6 | [ESLint — `no-magic-numbers`](https://eslint.org/docs/latest/rules/no-magic-numbers) | 1 | The enforceable half of "name your constants". Not enabled in this repo. |
| D7 | [Climb the Ladder — JavaScript constants file best practices](https://climbtheladder.com/10-javascript-constants-file-best-practices/) | 3 | Grouping, `SCREAMING_SNAKE`, single source of truth, `as const`. |

### E. State placement (server / client / URL)

| # | Source | Tier | What we take from it |
|---|---|---|---|
| E1 | [TkDodo — React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager) | 2 | Server state is not client state; do not mirror it into `useState`. |
| E2 | [nuqs — type-safe search-param state](https://nuqs.dev/) · [GitHub](https://github.com/47ng/nuqs) | 1 | The URL is the home for anything bookmarkable, shareable or back-button-restorable. (Not installed here; `useSearchParams` is the built-in equivalent and the placement rule stands alone.) |
| E3 | [React docs — Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) | 1 | Lift state to the closest common ancestor — and no higher. |

### F. Enforcing architecture in CI

None of these is installed here. Listed so a future decision has the options in one place.

| # | Source | Tier | What we take from it |
|---|---|---|---|
| F1 | [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) · [npm](https://www.npmjs.com/package/eslint-plugin-boundaries) | 1 | Element types plus rules `dependencies`, `entry-point`, `external`, `no-private`, `no-unknown`. |
| F2 | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | 1 | Allowed-import rules, cycle detection, orphan detection, dependency graphs. |
| F3 | [Xebia — Taking Frontend Architecture Serious with dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) | 2 | A worked example of encoding layer rules. |
| F4 | [`import/no-restricted-paths`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md) | 1 | The zone configuration bulletproof-react uses to block cross-feature imports. |
| F5 | [Steiger — FSD linter](https://github.com/feature-sliced/steiger) | 2 | Architecture linting when FSD is the chosen structure. |

### G. Memoization — background only

| # | Source | Tier | What we take from it |
|---|---|---|---|
| G1 | [React docs — React Compiler](https://react.dev/learn/react-compiler) | 1 | The compiler removes the need for manual `useMemo`, `useCallback` and `React.memo`; following the Rules of React is the precondition. |
| G2 | [React blog — React Compiler v1.0](https://react.dev/blog/2025/10/07/react-compiler-1) | 1 | Stable since October 2025; new code should not hand-write memoization. |
| G3 | [LogRocket — I let React Compiler handle memoization: what actually broke](https://blog.logrocket.com/react-compiler-memoization-what-actually-broke/) | 3 | The exception: third-party libraries that key on function identity. Do not bulk-delete existing memoization. |

### N. Next.js App Router architecture

| # | Source | Tier | What we take from it |
|---|---|---|---|
| N1 | [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 1 | `'use client'` is a **module-graph boundary**: "all of its imports and the components it directly renders are included in the client bundle" — but *not* Server Components passed as `children`/props. Add the directive to specific interactive components. Props must be serializable. "Render providers as deep as possible in the tree." Wrap client-only third-party components. `server-only` / `client-only`, and the `NEXT_PUBLIC_` rule. |
| N2 | [Next.js — How to think about data security](https://nextjs.org/docs/app/guides/data-security) | 1 | The three data-fetching approaches — external HTTP APIs, **Data Access Layer**, component-level — and "choose one and avoid mixing them". A DAL is server-only, performs authorization, returns minimal DTOs, and is the only place reading `process.env`. An exported Server Action is reachable by direct POST, so re-verify authentication *and* ownership inside it. Keep actions thin; control return values; never mutate during render. |
| N3 | [Next.js — `use server` directive](https://nextjs.org/docs/app/api-reference/directives/use-server) | 1 | File-level vs inline. "To use Server Functions in Client Components you need to create your Server Functions in a dedicated file using the `use server` directive at the top of the file." Read auth from cookies/headers, never from a parameter. |
| N4 | [Next.js — Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data) | 1 | Identical `fetch` requests in one tree are memoized, "so you can fetch data in the component that needs it instead of drilling props". `loading.js` streams a segment; `<Suspense>` goes closer to the uncached access. Sequential `await`s block — use `Promise.all`. |
| N5 | [React — Server Components](https://react.dev/reference/rsc/server-components) · [`use client`](https://react.dev/reference/rsc/use-client) | 1 | The upstream React definitions the Next.js docs build on. |

### Skill-authoring sources

Used to build the skill itself rather than its content:

- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — concise-is-key, degrees of freedom, progressive disclosure, one-level-deep references, the 500-line body limit, evaluation-driven development.
- [Agent Skills specification](https://agentskills.io/specification) — the frontmatter contract: only `name` and `description` are required, `name` must match the directory, and **there is no top-level `version` field** — `metadata` is where it goes.
- `superpowers:writing-skills` — the RED→GREEN discipline used in §9, and "match the form to the failure".

## 7. Conflicts this skill resolves

The sources genuinely disagree. Recorded so a future reader does not think a side was missed.

1. **Feature folders vs. group-by-type.** A1, A4, A6 and A8 argue for features; A7 argues
   features blur and grouping by type stays predictable. → **Route-colocation**, which is
   what `client/` already does and one of the three strategies Next.js sanctions (A3). It
   satisfies both camps: grouped by the route that owns them, type-named files inside.
2. **A public `index.ts` per unit vs. no barrel files.** A5, A6, A7, A8 want a public API per
   unit; D1 shows barrels are a measurable build-time trap. → **Leaf barrels only.**
   Aggregating `export *` barrels are banned for new code; the nine that exist stay.
3. **Line-count limits.** `react-best-practices` asserts "max 200 lines, max 5–7 props"; B2
   rejects count-based rules outright. → **Counts prompt a check for a symptom, never a
   split.** Stated in both skills so they do not contradict each other in review.
4. **`utils` vs `helpers`.** A7 draws a real distinction; A6 and D4 treat `utils/` as an
   inevitable dumping ground. → **Adopt A7's distinction and pair it with the promotion
   rule**, which is what actually keeps the folder from rotting.
5. **Where data fetching lives.** N4 says fetch in the component that needs it (Server
   Components, memoized); C6 says wrap every call in a custom hook (client, React Query). →
   **Not a real conflict** — they address opposite sides of the boundary. This repo is
   client-side, so C6 governs; N4 governs new server-side work.

## 8. Version and changelog

Current: **`1.0.0`** — declared in `SKILL.md` frontmatter under `metadata.version`, the only
place the [Agent Skills spec](https://agentskills.io/specification) allows a version. Semver
read as: **major** = a prescribed rule reverses; **minor** = a new rule or section; **patch**
= corrections, examples, wording.

### 1.0.0 — 2026-08-01

First tested release. Rules for placement, splitting, logic and state homes, constants,
utils/helpers/lib, barrels, import paths, naming, the Next.js Server/Client boundary, and
`features/`/FSD as alternatives. 41 sources, RED→GREEN tested (§9).

**Structure.** Split into a thin `SKILL.md` hub plus three topic files (§2). `SKILL.md` holds
only what is needed to route a question — six principles, a five-step procedure, the folder
table, the sibling-skill boundary, red flags, the checklist — so activating the skill loads
~140 lines instead of ~600. Detail loads on demand, one level deep. `examples.md` was
dissolved into the topic files: a good/bad pair now sits next to the rule it demonstrates
rather than one hop away. This restructure changed no rule, so the version stays 1.0.0 — it
happened before the skill was ever committed.

**Content.** Built from an untested draft written the same day. Changes against that draft,
all driven by the baseline in §9:

- **Cut** the full `client/src` tree and the long-form folder-anatomy walkthrough. Baseline
  agents reproduced both from `client/AGENTS.md` and the existing folders without help, so
  they were pure context cost. The anatomy survives as a one-line file list.
- **Added** a decision-tree row for stateful non-data hooks → `<Owner>/hooks/`. The draft had
  no row for it and baseline agents had to reason it out from
  `src/components/app-shell/hooks/`.
- **Added** a decision-tree row sending user-facing text to `messages/<locale>/*.json`, and
  the warning that `SEV[x].label` is hardcoded English inside a vendored copy.
- **Corrected** the `SEV_COLOR` duplication count from one local copy to two — the draft
  missed `RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx:12`.
- **Rewrote the Server/Client section** (now `nextjs-organization.md`) around a repo fact the draft got wrong by omission: `src/vendor/ui` carries
  zero `'use client'` markers while its primitives call `useState`, so in this repo any
  component rendering `@devdigest/ui` must itself be a Client Component — which inverts the
  "push the directive to the leaves" advice. Also recorded that `server-only` is **not
  installed** here, and that the directive must never go on a barrel.
- **Added** a Red flags table and an opening instruction to answer with a path, not an essay.
- **Merged** `references.md` into this file and deleted it, so the links have one home.
- **Added** `metadata.version` and this changelog.

## 9. How this skill was tested

Method: [`superpowers:writing-skills`](https://github.com/anthropics/skills) RED→GREEN.
Baseline scenarios run first by subagents instructed not to read anything under
`.claude/skills/`, then re-run with the skill available.

**Read this before trusting the result.** The baseline is **contaminated and not a
clean room**. Insights extracted while writing the draft had already been committed to
`client/INSIGHTS.md`, and baseline agents cited those entries by line number. What §9 measures
is therefore "agent + repo docs" versus "agent + repo docs + skill", not "agent" versus
"agent + skill".

### Baseline (RED)

| # | Scenario | Result |
|---|---|---|
| S1 | Place a new `SeverityLegend`, then promote it when a second route needs it | **Passed.** Correct colocated path, correct kebab-case promotion, labels to `next-intl`, reused the vendored `SEV` instead of writing a map. |
| S2 | Decide whether `RunTraceDrawer/TraceBody` should be split | **Passed, and exceeded the draft.** Reached "extract on a seam, not a line count" unaided, and found a `SEV_COLOR` copy the draft did not know about. |
| S3 | Add a reload-surviving severity filter | **Passed.** URL state, no `fetch` in the component, data through `src/lib/hooks/`. |
| S4 | Draw the Server/Client boundary for a new server-rendered route | **Passed, and exceeded the draft.** Found that `vendor/ui` has no `'use client'`, inverting the leaves rule, and that `server-only` is not installed. |

Two of the four agents noticed the skill existed from `INSIGHTS.md` and flagged it as worth
reconciling — good evidence for discoverability, and further proof the baseline is not clean.

### What the baseline changed

Four passes out of four is not a licence to keep every rule. The honest reading is that a
capable agent with this repo's docs **derives most of these rules unaided**, so the skill was
cut down rather than expanded. What survives is what the baseline could not supply:

- **Speed and consistency.** Baseline answers ran 800–1500 words and reasoned from scratch
  each time; four runs would produce four defensible-but-different structures. The decision
  tree makes the answer immediate and identical. This is now stated at the top of SKILL.md.
- **Rationale the repo cannot carry.** *Why* symptoms beat line counts (B2, Metz), the
  measured barrel cost (D1), the Server-Action-is-a-public-endpoint rule (N2).
- **Counted facts.** 43 deep relative imports vs 29 aliased, nine `export *` barrels, two
  local `SEV_COLOR` copies, `server-only` absent — none visible from reading a single file.
- **Alternatives with triggers.** `features/` and FSD, and the conditions that would justify
  either. Nothing in the repo hints at these.

### Verification (GREEN)

The four scenarios were re-run against the rewritten skill, plus two new ones probing the
rules the baseline had exposed as missing.

| Probe | Result |
|---|---|
| `SeverityLegend` placement and promotion | Correct, and now rejects `SEV[x].label` as "hardcoded English inside a vendored copy" — the rule added in this release. |
| Factor out duplicated copy-to-clipboard | Landed on `RunTraceDrawer/hooks/useCopyToClipboard.ts`, citing the hook test verbatim and ruling out `src/lib/hooks/` as data-only. The decision-tree row added in this release did its job. |
| Third `SEV_COLOR` copy | Called "a third copy is the red flag" — the red-flags wording surfacing verbatim. |
| Reload-surviving "hide resolved" toggle | URL via the existing `setParam`, filtering extended in `FindingsPanel/helpers.ts`; explicitly named the local `hideLow` `useState` as "the existing exception to the rule, not the pattern". |
| Server/Client boundary for a new route | Reproduced the `vendor/ui` inversion, put the directive on leaf files and "never in the folder's `index.ts`", and independently re-verified that `server-only` is absent. |

**The clearest signal is the shape of the answer, not its content.** Baseline answers ran
800–1500 words of prose and re-derived the reasoning each time. GREEN answers came back as
tables — path, one line of why — averaging under 400 words, and cited section numbers. That
is the value the skill actually adds here, and it is why the "give the answer, not an essay"
instruction now opens SKILL.md.

Two findings came *out* of the GREEN runs and are worth acting on separately: `vendor/ui/
LiveLogStream.tsx:37-42` is a third copy of the copy-flash behaviour (untouchable — vendored),
and `client/AGENTS.md` still asserts "no RSC data fetching and no server actions", which any
server-rendered route would contradict.

### Navigation (after the split)

Three questions, one per topic file, put to a fresh agent to check that the hub actually
routes rather than forcing a full read.

| Question | Files opened | Verdict |
|---|---|---|
| `utils` vs `helpers`, and where two named functions go | `SKILL.md` → `folder-structure.md` | Correct file, first try |
| Should a 240-line panel be split? | `SKILL.md` → `component-organization.md` | Correct file; also corrected the premise — the file is 91 lines, and it refused to split without a symptom |
| Can a header using `<Card>` be a Server Component? | `SKILL.md` → `nextjs-organization.md` | Correct file; reproduced the `vendor/ui` inversion and flagged the stale `AGENTS.md` line |

Two of the three answers applied principle 6 unprompted, finding that `formatSeconds` and
`SEVERITY_ORDER` already exist rather than proposing new ones — which is the behaviour the
principle was written to produce. No question caused all three topic files to be read.

Every factual claim added to SKILL.md in this release was verified directly against the tree
with `grep`/`ls` rather than taken from a subagent's report.

**Known gap:** no true clean-room baseline exists, and re-establishing one would mean
reverting the `client/INSIGHTS.md` entries. That was judged not worth it. The next editor
should treat §9 as evidence about *marginal* value over the repo docs, which is the decision
that actually matters here.

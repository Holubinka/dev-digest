---
name: frontend-architecture
description: "Decides where frontend code goes and how it is split. Use when adding a component and choosing between a colocated and a shared folder, splitting a component that grew too big, deciding between a hook / a pure function / a component body for logic, placing constants, types, styles, utils or helpers, choosing where state lives (local, URL, or server cache), or drawing the Next.js Server/Client boundary. Covers React and Next.js App Router file and folder structure."
metadata:
  version: "1.0.0"
  tags: react, nextjs, app-router, project-structure, folder-structure, colocation, component-splitting, state-placement, rsc
---

# Frontend Architecture — where code goes

Placement and decomposition for React + Next.js App Router.

**Give the answer, not an essay.** For a placement question the output is a path and one
line of why. Tested agents reach the right answer without this skill but take 800–1500 words
to get there — this skill exists to make the answer immediate and identical every time.

## Navigation

| Read | For |
|---|---|
| **This file** | The six principles, the five-step procedure, the boundary with sibling skills |
| [folder-structure.md](folder-structure.md) | Which folder. Strategies (flat / by-type / feature / FSD), colocation, naming, constants, types, styles, barrels, imports, **utils vs helpers** |
| [component-organization.md](component-organization.md) | Which file, and how many. Splitting, composition, business-logic layers, hook extraction, state placement |
| [nextjs-organization.md](nextjs-organization.md) | App Router specifics. `_private` folders, route groups, `src/`, the `'use client'` boundary, RSC data access, Server Actions |
| [README.md](README.md) | Scope, related skills, all 41 sources, version and changelog, how the skill was tested |

Source tags (`[A3]`, `[N1]`, …) used across these files resolve in [README.md](README.md) §6.

---

## The six principles

Everything in the topic files is an application of one of these. When a rule and a principle
seem to disagree, the principle wins and the rule is wrong.

1. **Colocate by default.** Place code as close to where it is used as possible. Distance
   from the consumer is a cost you pay on every read `[A9]`.
2. **Promotion needs a second consumer.** Nothing moves to a shared folder before a real
   second caller exists — and nothing stays shared once it drops back to one `[A7][A9]`.
3. **Symptoms split components, never counts.** A long component with no problem is fine.
   Name the symptom or leave it alone `[B2]`.
4. **The home follows the kind of code.** Pure calculation → a function. Stateful behaviour →
   a hook. Wiring props into JSX → the component body. A function that calls no hook is not a
   hook `[C1]`.
5. **State lives at its narrowest correct scope.** Server data → the query cache. Shareable →
   the URL. Otherwise local. Derivable from what you already have → nowhere `[C2][E1][E2][E3]`.
6. **Reuse before you create.** Grep `vendor/ui`, `vendor/shared` and `src/lib` before adding
   a token, a helper, a hook or an endpoint. Two definitions of one concept drift on the next
   change.

## The five-step procedure

Run these in order for any "where does this go" question. Stop as soon as the answer is
determined.

**1 — Name what it is.** Component · hook · pure function · constant · type · style ·
user-facing text · server-only module. The kind decides the file; the consumers decide the
folder. If you cannot name it, it is not ready to be extracted.

**2 — Check it already doesn't exist.** Principle 6. `SEV` and `CAT` in
`vendor/ui/primitives/tokens.ts`, helpers in `src/lib/`, hooks in `src/lib/hooks/`. Two
files in this repo already restate `SEV`'s colours locally — do not add a third.

**3 — Count the consumers.** One → colocate beside it. Two or more, in different routes →
promote to the shared folder for that kind. Zero — you are speculating; go back to step 1.

**4 — Pick the folder.**

| It is… | It goes in |
|---|---|
| a component used by one route | `app/<route>/_components/<Name>/` |
| a component used by 2+ routes | `src/components/<kebab-name>/` |
| a hook that calls the API | `src/lib/hooks/<domain>.ts` |
| a hook with state but no API call | `<Owner>/hooks/use<Name>.ts` — never `src/lib/hooks/` |
| a contract type shared with the server | `src/lib/types.ts` (re-export, never redefine) |
| user-facing text | `messages/<locale>/*.json` — **not** `constants.ts` |
| a project-specific function | `helpers.ts` beside it, or `src/lib/` once shared |
| a portable function | `src/lib/` |
| a constant | `constants.ts` beside it |
| a style | `styles.ts` beside it |
| anything reading a secret, token or DB | a `server-only` module |

Detail and rationale for each row: [folder-structure.md](folder-structure.md).

**5 — Check the boundaries you just crossed.** Does it need `'use client'`, and is the
directive on a leaf rather than a layout or a barrel? Would it add an aggregating `export *`
barrel? Does the import cross a layer, so it should use `@/` instead of `../../../../`? Is
anything secret now reachable from the client graph?

## Boundary with the sibling skills

Three skills touch React here. The split is by **question asked**, not by technology.

| Skill | Answers | Owns |
|---|---|---|
| **frontend-architecture** (this) | *Where does it go?* | folders, splitting, placement, boundaries |
| `react-best-practices` | *Is it written correctly?* | purity, hooks misuse, keys, memoization, a11y |
| `next-best-practices` | *What does the framework do?* | file conventions, RSC mechanics, metadata, caching |

They overlap in two places:

- **Line and prop limits.** `react-best-practices` states "max 200 lines" and "max 5–7 props".
  Principle 3 overrides that: counts prompt a check for a symptom, never a split.
- **The Server/Client boundary.** `next-best-practices` owns the mechanics; this skill owns
  the placement consequence — which file gets the directive, and what that means for the
  folder.

Do not load this skill for "why is this re-rendering", "fix this hydration error", or "write
a test for this".

## Red flags

Stop when you catch yourself writing any of these.

| Red flag | Principle broken |
|---|---|
| "I'll put it in `components/` since it might be reused" | 2 — one consumer, one home |
| "It's over 200 lines, so split it" | 3 — name the symptom or leave it |
| "`useSeverityLabel` reads better" | 4 — it calls no hook, so it is not a hook |
| "I'll copy the finding into `useState` so I can filter it" | 5 — derive during render |
| "The filter can just be `useState`" | 5 — it is shareable, so it is URL state |
| "I'll add a small `SEV_COLOR` map here" | 6 — third copy; `SEV` already exists |
| "One more `export *` in `index.ts` is tidier" | 1 — it drags five module graphs with it |
| "`'use client'` on the layout is simpler" | 1 — it drags the whole subtree client-side |

## Review checklist

- [ ] New file sits at the shallowest level with ≥1 consumer, and no shallower (1, 2)
- [ ] Nothing was created that already existed in `vendor/` or `src/lib/` (6)
- [ ] Any split names a symptom, not a line count (3)
- [ ] Nothing named `use*` that calls no hook (4)
- [ ] No `fetch` outside `lib/hooks/`; no query data copied into `useState` (5)
- [ ] Shareable state is in the URL (5)
- [ ] No magic value in JSX; no constant restating a vendored token (6)
- [ ] No new aggregating barrel; no new `../../../../` import
- [ ] `'use client'` on the leaf, not the layout or a barrel
- [ ] Nothing secret is reachable from the client module graph

# Folder structure

Which folder a file goes in, and what it is named. Applies principles 1, 2 and 6 from
[SKILL.md](SKILL.md). Source tags resolve in [README.md](README.md) §6.

## Contents

- [The four strategies, and which one this repo uses](#the-four-strategies-and-which-one-this-repo-uses)
- [Colocation](#colocation)
- [The promotion rule](#the-promotion-rule)
- [Component folder anatomy](#component-folder-anatomy)
- [Constants](#constants)
- [Types and styles](#types-and-styles)
- [utils vs helpers vs lib](#utils-vs-helpers-vs-lib)
- [Barrels](#barrels)
- [Import paths](#import-paths)
- [Naming](#naming)
- [This repo's tree](#this-repos-tree)

---

## The four strategies, and which one this repo uses

| Strategy | Shape | Breaks when | Enforcement |
|---|---|---|---|
| **Flat** | everything in `src/` | ~20 files | none needed |
| **By type** | `components/ hooks/ utils/ contexts/` | one feature's code scatters across four folders; the global folders become dumping grounds `[A8][D4]` | none possible |
| **By feature** | `features/<name>/{api,components,hooks,types,utils}` + `shared → features → app` | needs lint zones or cross-feature imports creep back `[A1]` | `import/no-restricted-paths` `[F4]`, `eslint-plugin-boundaries` `[F1]` |
| **FSD** | layers `app → pages → widgets → features → entities → shared`, segments `ui/api/model/lib/config`, public API per slice `[A4][A5]` | high entry cost; needs a whole team on board | `steiger` `[F5]`, `dependency-cruiser` `[F2][F3]` |

**This repo uses route-colocation** — a fifth option that the App Router makes possible and
Next.js explicitly sanctions as "split project files by feature or route" `[A3]`. Feature code
lives under the route that owns it; only genuinely shared code moves up.

It also settles a real disagreement in the sources: A1, A4, A6 and A8 argue for feature
folders, while A7 argues features blur over time and grouping by type stays predictable.
Route-colocation satisfies both — files are grouped by the route that owns them, with
type-named files (`constants.ts`, `helpers.ts`, `styles.ts`) *inside* the folder.

**When an alternative would win:** move to `features/` once the same domain code is consumed
by many routes and cross-feature imports need policing. Move to FSD at multi-team scale.
Either decays without enforcement — and none of the tools above is installed here, so do not
cite a rule the build does not check.

## Colocation

Place code as close to where it is used as possible `[A9]`. Dodds's three benefits:
maintainability (related files stay in sync), applicability (you find what exists), and ease
of use (no context switch).

In the App Router this is safe by construction: a folder is **not routable** until it contains
`page` or `route`, so project files sit inside route segments without becoming URLs `[A3]`.

Tests colocate too — `FindingCard.test.tsx` beside `FindingCard.tsx`, never a mirrored
`__tests__/` tree. E2E tests are the stated exception and live at the project root (`e2e/`).

## The promotion rule

**Code starts colocated and moves up only when a second consumer appears** `[A7][A9]`.

- Never pre-place a file in a shared folder "because it might be reused".
- Promote in the same commit that adds the second consumer, and update both imports there.
- The inverse holds: a shared folder with one consumer is wrong — move it back down.

This is the only thing that stops `utils/` and `hooks/` becoming dumping grounds `[D4][A8]`.

**Worked example.** A `SeverityLegend` used only by the PR detail page lives at
`app/repos/[repoId]/pulls/[number]/_components/SeverityLegend/`. When the PR list page needs
it too, the folder moves to `src/components/severity-legend/` and both routes import
`@/components/severity-legend`. It does **not** go to `pulls/_components/` — that folder is
the list route's own, not a shared parent.

**Bad:** creating `src/components/severity-legend/` on day one. One consumer means one home.

## Component folder anatomy

One component per folder. The folder is the unit; the files inside are its segments `[A6][A7]`.

```
FindingCard/
├── FindingCard.tsx        the component — JSX and wiring, nothing else
├── FindingCard.test.tsx   colocated
├── constants.ts           literals used only here
├── helpers.ts             pure functions — no hooks, no JSX
├── styles.ts              typed CSSProperties
└── index.ts               one re-export
```

Add a file only when it earns its place — a component with no constants has no `constants.ts`.
Sub-components used only by this one nest as `_components/` inside it.

**Never in the component file:** a second exported component, a helper that takes no props, a
magic value, an API call.

**Bad** — the same code as one file:

```tsx
// FindingCard.tsx — 400 lines
const SEV_COLOR = { CRITICAL: "var(--crit)", /* … */ };   // ✗ un-shareable, un-greppable
function lineLabel(f) { /* … */ }                          // ✗ can't be tested alone
export function FindingCard() { /* … */ }
export function FindingsList() { /* … */ }                 // ✗ second component in the file
```

**Good** — `helpers.ts` holds a pure function, testable on its own:

```ts
/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
```

## Constants

**Check for an existing token first** (principle 6). `@devdigest/ui` exports a full severity
token — colour, background, icon *and* label:

```ts
// src/vendor/ui/primitives/tokens.ts
export const SEV: Record<Severity, { c: string; bg: string; icon: IconName; label: string }> = {
  CRITICAL: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon", label: "Critical" },
  // …
};
```

Two files already restate its colour field locally — `_components/FindingCard/constants.ts`
and `_components/RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx:12`. That is
drift, not precedent; a third copy is the red flag. Consume the token, and do not edit
`vendor/**` to extend it — the server copy is the source of truth.

**But do not use `SEV[x].label` as display text.** Those labels are hardcoded English inside a
vendored copy. User-facing strings go through `next-intl`.

Otherwise: `constants.ts` beside the component, `SCREAMING_SNAKE`, `as const` `[D7]`; promote
by the rule above. **No magic value in JSX** — an unnamed number or string in a template is a
constant that has not been named yet `[D6]`.

```tsx
// ✗ Bad
{findings.slice(0, 50).map(/* … */)}
<div style={{ maxHeight: 420 }} />
```

```ts
// ✓ Good — constants.ts beside the component
/** Findings rendered before the list virtualises. */
export const FINDINGS_PAGE_SIZE = 50;
/** Panel height cap, px — matches the diff pane. */
export const PANEL_MAX_HEIGHT = 420;
```

`50` and `420` mean nothing at the call site, and the next person changing one has no way to
find the other place it was pasted.

## Types and styles

**Types follow their consumer.** Component props stay in the component file. Types shared
across the app go to `src/lib/types.ts`. Contract types shared with the server are
**re-exported**, never redefined — `src/lib/types.ts` re-exports `z.infer` results, not the
schemas.

**Styles stay in the component folder** `[A6]`. Here that is a typed `CSSProperties` object in
`styles.ts`; Tailwind supplies the theme tokens and CSS variables. Follow whichever the
surrounding component already uses rather than mixing both in one folder.

## utils vs helpers vs lib

A real distinction, worth holding `[A7]`:

| Kind | Test | Example | Home |
|---|---|---|---|
| **helper** | knows our domain | `lineLabel(finding)` | beside its component, or `src/lib/` once shared |
| **helper** | knows our rules | `githubBlobUrl(repo, sha, file, line)` | `src/lib/github-urls.ts` |
| **util** | would drop into an unrelated project unchanged | `clamp(n, lo, hi)` | `src/lib/` |
| **lib** | a preconfigured integration, not a function | the API client, the query client `[A1]` | `src/lib/` |

If you cannot say which of the three a new file is, it is not ready to be extracted — leave it
in the component that uses it.

## Barrels

**Allowed:** a leaf `index.ts` re-exporting one component's public surface.

```ts
export { FindingCard, FindingCard as default } from "./FindingCard";
```

```ts
/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
```

**Not allowed:** new aggregating barrels. Importing one symbol from an `export *` barrel pulls
the whole module graph — circular imports, slower dev builds (one measured case went 11k → 3.5k
modules after removal), and `optimizePackageImports` cannot rescue a barrel containing any
non-re-export line `[D1][D2]`.

Nine already exist here — `lib/hooks/`, `components/{app-shell,findings-preview,page-shell,
run-cost-badge,showcase}/`, `_components/RunFindings/`, and both `vendor/` roots. Leave them;
do not add a tenth.

```ts
import { usePrActiveRuns } from "@/lib/hooks/reviews";   // ✓ one module
import { usePrActiveRuns } from "@/lib/hooks";           // ✗ pulls agents, trace, repo-intel too
```

## Import paths

`@/*` → `./src/*` is configured in `client/tsconfig.json`. Use the alias for anything outside
the current folder; relative paths only for same-folder siblings (`./constants`, `./helpers`).

```ts
// ✗ Bad — real code in SettingsApiKeys.tsx
import { useTestConnection, useSecretsStatus } from "../../../../../../../lib/hooks";
import { ApiError } from "../../../../../../../lib/api";

// ✓ Good
import { useTestConnection, useSecretsStatus } from "@/lib/hooks/core";
import { ApiError } from "@/lib/api";
```

The tree holds 43 imports starting `../../../../` against 29 using the alias. Seven levels of
`../` break the moment a folder moves and hide which layer is being crossed. Do not add more;
fix the ones you touch.

## Naming

- Component file = component name, PascalCase: `FindingCard.tsx` exports `FindingCard` `[D5]`.
- Route-colocated component folders are PascalCase, matching the component.
- Shared component folders under `src/components/` are kebab-case: `diff-viewer/`.
- Non-component modules are kebab-case: `github-urls.ts`, `model-label.ts`.
- Hooks are `use` + capital letter — and only if they call a hook `[C1]`.

## This repo's tree

```
client/src/
├── app/                                   # routes; pages stay thin
│   └── repos/[repoId]/pulls/[number]/
│       ├── page.tsx
│       └── _components/                   # private folder — not routable
│           ├── FindingCard/               # the anatomy above
│           └── RunTraceDrawer/
│               └── _components/           # nested, single-parent sub-components
├── components/<kebab-name>/               # used by 2+ routes
│   └── app-shell/hooks/                   # non-data hooks, owned by their tree
├── lib/
│   ├── hooks/<domain>.ts                  # every TanStack Query hook
│   ├── api.ts · types.ts · <name>.ts      # client, re-exported types, helpers and utils
└── vendor/{shared,ui}/                    # vendored — do not edit here
```

`src/vendor/**` mirrors `server/`. Change the server copy first, then mirror deliberately.

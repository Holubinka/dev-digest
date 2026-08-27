# client/ — `@devdigest/web`

Next.js 15 App Router + React 19. Repo-wide rules live in the root `AGENTS.md`; this
file only covers what is specific to this package.

## Conventions

- **App Router, but almost everything is `"use client"`.** There is no RSC data
  fetching and no server actions. `app/layout.tsx` is the one async server component
  (it loads the `next-intl` locale). Do not assume a component runs on the server.
- **All data goes through TanStack Query**, via hooks in `src/lib/hooks/*`. Do not call
  `fetch` from a component; add or reuse a hook.
- **`src/lib/api.ts` does not validate responses at runtime.** It types them with
  generics only — no `.parse()`. A server contract change surfaces as an undefined
  property deep in a component, not as an error at the boundary. Widen types with care.
- **`src/lib/types.ts` re-exports types, not schemas** (`z.infer` results). Import the
  schema itself only if you intend to validate.
- **Pages stay thin.** Feature logic lives in colocated `_components/<Name>/` folders,
  each with its own `*.test.tsx`.
- **Styling is a hybrid.** Tailwind 4 supplies the theme tokens and CSS variables;
  individual components use typed `CSSProperties` objects in a colocated `styles.ts`
  rather than utility classes. Follow whichever the surrounding component already uses.
- **Responsive rules live in `app/globals.css`, never in `styles.ts`.** An inline style
  beats a stylesheet rule whatever the selector, so a property a breakpoint changes —
  `flexDirection`, `width`, `padding`, `gap` — must be declared ONLY in the media-query
  block, keyed on a `dd-` class the component sets alongside its inline `style`. Leave it
  inline as well and the layout silently stops responding. Breakpoints in use: 900px (the
  sidebar becomes an overlay drawer), 1024px (a convention card stacks), 680px (page
  header and toolbar stop being single rows).
- **`src/vendor/shared` is a vendored copy**, not a package. The server's copy is the
  source of truth; mirror any contract change there and verify with
  `diff -rq ../server/src/vendor/shared src/vendor/shared`.
- **`src/vendor/ui` is our design kit** — same folder, opposite rule. No paired copy, no
  mirror gate, and it is editable: a primitive that gains a prop is how the second caller
  reuses it rather than cloning it. Widen it for a shape more than one caller needs, and
  remember the edit goes unlinted (§ *Lint*).

## A design is an acceptance criterion

**When a mockup, a screenshot or a ticket came with the request, the screen is not done until
somebody has compared the built screen against it.** Gates cannot do this. Lint, typecheck and RTL
all pass on a component that renders the right data in the wrong shape, in the wrong place, at the
wrong altitude — they assert against the code, and the design is the one requirement that lives
outside it.

Compare against **both** sources, because they fail differently. The **mockup** carries what prose
routinely omits: where a block sits, what is one section versus three, which value is a number and
which is a word, what an item links to, what a count badge counts. The **written description**
carries what a picture cannot: behaviour, states, what happens on failure.

Walk it element by element and answer each with *matches / differs / absent*:

- **Placement and hierarchy.** Is it one card, or a banner plus two cards plus a full-width
  section? A component that renders every field but sits inside the wrong container has not
  implemented the design.
- **The shape of each value.** A word where the design shows a gauge is a different feature, not a
  styling choice — a 0-100 score and a three-value enum answer different questions, and the
  contract usually has to change for one to become the other.
- **Every label, in the design's own words.** `Where to look first` and `REVIEW FOCUS — READ THESE
  FIRST` are not the same string, and the second is what the reader was promised.
- **What each element does.** Which items are controls, where they navigate, what expands.
- **What the design shows that the contract cannot express.** `src/config.ts:12` needs a line
  number; a `ref: string` of paths cannot carry one. That is a finding about the contract, and it
  belongs in the report before anyone styles anything.

**The walk is written down once, and then it *is* the design.** Whoever opens the image first
answers those five axes into `specs/assets/<SPEC>-DESIGN-WALK.md`, beside the PNG. Every later agent
is handed the walk and opens the image only to settle what the walk cannot answer — then appends
that row before moving on, so the Nth read is the last one instead of the first of many. This is
the single exception to *never trust prose about a layout*: a walk is a transcription made with the
image open, and it names the axes it could not fill. Four PNGs cost nineteen agent-reads on SPEC-05
for want of one.

**Differences are reported, not silently resolved either way.** Building past the design and
"improving" it are the same failure — the design is a requirement someone approved, and a change to
it is theirs to make.

The dispatch side of this — never describe a mockup to an agent, hand it over — is
`.claude/agents/README.md` § *Five habits that outrank every agent here*, along with the run where
skipping it cost a whole feature's shape.

## i18n

`next-intl`, with messages under `messages/en/*.json`. Keys already exist for screens
that later course lessons build (`blast`, `brief`, `ci`, `conformance`, `eval`,
`memory`, `skills`). An unused message file is scaffolding, not dead code.

## Tests

Vitest + jsdom. `fetch` is mocked per test — the suite needs no running API and no
browser. Real browser journeys live in `../e2e/`.

## Lint

`pnpm lint` — ESLint 9 flat config (`eslint.config.mjs`), `next/core-web-vitals` +
`next/typescript`. **This is the only package in the repo with a linter**, so do not
assume `pnpm lint` exists next door. `src/vendor/**` is ignored — for `shared` that is
right, a violation in a mirrored copy is not ours to fix; for `ui`, which we do edit, it
means your change is never linted and you read it yourself.

Two rules carry local intent. `reportUnusedDisableDirectives` is an **error** — an
`eslint-disable` that suppresses nothing is a claim about the code that is no longer
true. And `no-unused-vars` honours a leading underscore, which is how this codebase
marks a binding destructured only to exclude it (`prId: _prId` in
`lib/hooks/reviews.ts`).

CI runs it before `typecheck` in `.github/workflows/client.yml`.

## Read when

- **Read `README.md`** for the route map before adding a page.
- **Read `INSIGHTS.md`** before debugging anything here.
- **Read `../server/README.md`** before consuming a new endpoint — the client does not
  validate responses, so the server's contract is the only guarantee you get.

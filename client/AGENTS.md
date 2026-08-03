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
- **`src/vendor/shared` and `src/vendor/ui` are vendored copies**, not packages. The
  server's copy of `shared` is the source of truth; mirror any contract change there and
  verify with `diff -rq ../server/src/vendor/shared src/vendor/shared`.

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
assume `pnpm lint` exists next door. `src/vendor/**` is ignored: it is a read-only
copy, and a violation there is not ours to fix.

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

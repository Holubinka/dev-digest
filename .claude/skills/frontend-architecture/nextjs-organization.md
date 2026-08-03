# Next.js App Router organization

Structural rules specific to the App Router: what belongs in `app/`, where the Server/Client
boundary falls, and where server-side data access and mutations live. Applies principles 1
and 6 from [SKILL.md](SKILL.md). Source tags resolve in [README.md](README.md) §6.

This file owns the **placement consequences**. For framework mechanics — what `loading.tsx`
does, caching semantics, hydration errors — use the `next-best-practices` skill.

## Contents

- [What goes in `app/`](#what-goes-in-app)
- [Private folders, route groups, `src/`](#private-folders-route-groups-src)
- [The `'use client'` boundary](#the-use-client-boundary)
- [How this repo inverts the leaves rule](#how-this-repo-inverts-the-leaves-rule)
- [Keeping server code out of the client graph](#keeping-server-code-out-of-the-client-graph)
- [Data access: pick one approach](#data-access-pick-one-approach)
- [Server Actions](#server-actions)
- [What applies to this repo today](#what-applies-to-this-repo-today)

---

## What goes in `app/`

`app/` holds **routing plus what only that route uses**. Next.js is deliberately unopinionated
and sanctions three strategies `[A3]`:

1. project files outside `app/`, with `app/` kept purely for routing;
2. project files in top-level folders inside `app/`;
3. **split by feature or route** — globally shared code at the root, route-specific code inside
   the segment that uses it.

**This repo uses the third.** Colocation is safe by construction: a route is not publicly
accessible until a `page` or `route` file exists, and only what those files return is sent to
the client, so colocated project files never become URLs `[A3]`.

## Private folders, route groups, `src/`

| Convention | Use it for |
|---|---|
| `_folder` | Colocated non-routable code — `_components/`, `_lib/`. Opts the folder **and all subfolders** out of routing `[A3]` |
| `(group)` | Grouping routes by section or team, and giving a subset its own layout, without touching the URL `[A3]` |
| `@slot` / `(.)folder` | Parallel and intercepting routes — slot layouts, modal routing |
| `src/` | Separates application code from root config files `[A3]` |

Private folders are **not required** for colocation, but use them anyway. Next.js lists the
reasons: separating UI from routing logic, consistent organization across the ecosystem,
grouping in editors, and — the one that actually bites — avoiding collisions with future
reserved file conventions `[A3]`.

Reserved names (`page`, `layout`, `loading`, `error`, `not-found`, `route`, `template`,
`default`) and their render hierarchy belong to `next-best-practices`.

## The `'use client'` boundary

`'use client'` declares a **module-graph boundary**, not a tree boundary. Once a file carries
it, everything it imports and every component it *directly renders* joins the client
bundle `[N1]`.

Rules that follow:

- **Push the directive to the leaves.** Mark the interactive component — the search box, the
  filter bar, the button — not the layout that contains it `[N1]`.
- **Components passed as `children` or props are not in that graph.** They render on the server
  and arrive as rendered output. This is the escape hatch: a client `<Modal>` can wrap a server
  `<Cart>` `[N1]`.
- **Put the directive in the component file, never in an `index.ts` barrel.** A barrel directive
  silently drags every re-export across the boundary.
- **Render providers as deep as possible**, wrapping `{children}` rather than the whole
  `<html>` `[N1]`.
- **Props crossing the boundary must be serializable** `[N1]`. Pass ISO strings, not `Date`.
- **Wrap a client-only third-party component** in your own one-line `'use client'` module rather
  than marking your page `[N1]`.

```tsx
// ✗ Bad — now Logo, Breadcrumbs and everything else is client code
"use client";
export default function Layout({ children }) {
  return <nav><Logo /><Search /></nav>;
}

// ✓ Good — layout.tsx stays a Server Component; 'use client' lives in search.tsx
import Search from "./search";
export default function Layout({ children }) {
  return <><nav><Logo /><Search /></nav><main>{children}</main></>;
}
```

```ts
// ✗ Bad — a directive on a barrel crosses everything it re-exports
// _components/InsightsChart/index.ts
"use client";
export * from "./InsightsChart";
```

This is also why `app/layout.tsx` can stay a Server Component while rendering the client
`Providers`: `children` is a slot, not an import.

## How this repo inverts the leaves rule

`src/vendor/ui` carries **zero** `'use client'` markers, and its primitives (`Card`, `Button`,
`Chip`, `IconBtn`, `MonoLink`) call `useState`. `vendor/**` is do-not-touch, so the directive
cannot be added there.

**Therefore: any component that renders `@devdigest/ui` must itself be a Client Component.**

What still moves to the server is the *data fetch and the props*, not the markup. That is a
real win — data lands in the initial HTML with no client fetch waterfall — and client
components still server-render to HTML on the first request. But do not plan a route around
"this component tree stays on the server" if it uses the design system.

## Keeping server code out of the client graph

A module reachable from both sides is where secrets leak.

- `import 'server-only'` turns a leak into a **build error** instead of a silent bundle `[N1]`.
  **It is not installed here** — adding it means `pnpm add server-only` in `client/`.
  `client-only`, its mirror for `window`-dependent code, is present.
- Only `NEXT_PUBLIC_`-prefixed env vars reach the browser. Everything else is replaced with an
  empty string — a silent failure, not an error `[N1]`.
- In this repo secrets never pass through `process.env` at all; they go through
  `SecretsProvider` on the Fastify side. A Next server process should not be reading them.

## Data access: pick one approach

Next.js names three and says explicitly **not to mix them** `[N2]`:

| Approach | When | Shape |
|---|---|---|
| **External HTTP API** from Server Components | an API already exists and owns its auth ← *this repo, via the Fastify API* | `fetch` with the caller's credentials forwarded |
| **Data Access Layer** | new projects with direct DB access | a `server-only` module that performs authorization and returns minimal DTOs |
| **Component-level queries** | prototypes and learning only | queries inline in Server Components |

If a DAL is ever introduced here, it is the only place that reads `process.env`, it performs
the authorization check, and it returns a DTO rather than a database row `[N2]`.

Placement rules that hold regardless of approach:

- **Fetch in the component that needs the data.** Identical `fetch` requests in one tree are
  memoized, so prop-drilling to "fetch once" is unnecessary `[N4]`.
- **`loading.tsx` streams a whole segment; `<Suspense>` streams a part.** Put the boundary as
  close to the slow or uncached data as you can `[N4]`.
- **Start independent requests together** and `await` with `Promise.all` — sequential `await`s
  in one component are a waterfall `[N4]`.

## Server Actions

- Anything a Client Component imports must live in a **dedicated file** with `'use server'` on
  line 1. Inline `'use server'` is for closures defined inside a Server Component `[N3]`.
- **An exported action is a public POST endpoint.** A page-level auth check does not cover it.
  Re-verify authentication *and* resource ownership inside every action `[N2]`.
- **Validate the arguments in the action.** They are attacker-controllable regardless of what
  the button passed. Read auth from cookies or headers, never from a parameter `[N3]`.
- **Keep actions thin** — delegate to the data layer, then `revalidatePath` `[N2]`.
- **Return only what the UI needs.** Return values are serialized to the client `[N2]`.
- **Never mutate during render** — no cookie writes, no revalidation in a component body `[N2]`.

## What applies to this repo today

`client/` is almost entirely `"use client"`: `app/layout.tsx` is the only async Server
Component, there is no RSC data fetching, and there are no Server Actions. Data goes through
TanStack Query hooks in `src/lib/hooks/` over the Fastify API.

So this file governs **new server-side work**, not retrofits. Two things to handle if that work
lands:

- `client/AGENTS.md` currently asserts "no RSC data fetching and no server actions" — that line
  needs updating in the same change.
- Mixing an RSC-fetched route into an app that otherwise uses TanStack Query is exactly the
  mixing `[N2]` warns against. Decide deliberately, and write down which approach the new route
  belongs to.

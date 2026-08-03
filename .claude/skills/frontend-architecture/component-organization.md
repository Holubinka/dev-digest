# Component organization

How many components, and which file each piece of logic lives in. Applies principles 3, 4 and
5 from [SKILL.md](SKILL.md). Source tags resolve in [README.md](README.md) §6.

## Contents

- [When to split a component](#when-to-split-a-component)
- [Where to draw the boundary](#where-to-draw-the-boundary)
- [Composition over prop drilling](#composition-over-prop-drilling)
- [The three layers of logic](#the-three-layers-of-logic)
- [Extracting a hook](#extracting-a-hook)
- [Which `hooks/` folder](#which-hooks-folder)
- [The data layer](#the-data-layer)
- [State placement](#state-placement)
- [Derived state](#derived-state)

---

## When to split a component

Split on a **symptom**, never on a number `[B2]`:

- another component needs the same markup
- you can no longer tell which state belongs to which JSX
- a case is only reachable through the whole component, so tests get long
- a state change re-renders far more than it should
- two people keep colliding in the same file
- a third-party library needs its own mount point

"Duplication is far cheaper than the wrong abstraction" `[B2]`. A long component with none of
those symptoms is fine — leave it. Dodds is explicit: *don't be afraid of a growing component
until you start experiencing real problems.*

Past ~200 lines or ~7 props, **check** for a symptom. Finding none is a valid answer and ends
the question. This deliberately overrides the hard limits stated in `react-best-practices`.

**Extract on a seam, not on size.** A child earns its own file when it owns state, is reused,
or has behaviour worth asserting without rendering the parent. Moving 30 lines and one prop
into a new folder plus an `index.ts` plus an import, for a block with none of those, is folder
tax for no seam.

## Where to draw the boundary

Three complementary ways to decide, from the React docs `[B1]`:

1. **Single responsibility** — a component should ideally be concerned with one thing.
2. **CSS** — what you would give a class selector to, though components are less granular.
3. **The data model** — a well-structured payload maps onto a component tree, because UI and
   data models usually share the same information architecture.

**Do not reach for container/presentational splitting.** Its author retracted it — *"I don't
suggest splitting your components like this anymore"* `[B5]` — and hooks achieve the same
separation without the wrapper layer `[B4]`. The pattern survives only as vocabulary.

**A repetition that the type system already describes should be a loop, not hand-written JSX.**
Seven near-identical `<PromptBlock>` lines against an eight-field schema is how a field goes
missing — and one did in `RunTraceDrawer`. A typed, ordered constant array plus `.map()` makes
the next addition a one-line edit.

## Composition over prop drilling

Before reaching for context, in this order `[B6]`:

1. **Pass props.** Through two or three levels this is normal and makes the data flow legible.
2. **Extract components and pass JSX as `children`.** If an intermediate component does not
   use the data, restructure so it does not receive it:

```tsx
<Layout posts={posts} />              // ✗ Layout doesn't use posts
<Layout><Posts posts={posts} /></Layout>   // ✓ Layout just renders a slot
```

3. **Only then, context.** Legitimate uses: theme, current account, routing, and state genuinely
   needed by distant components. Context is dependency injection, not a state manager — every
   consumer re-renders when the value changes, so split contexts by concern.

## The three layers of logic

| Kind of logic | Home | How it is tested |
|---|---|---|
| calculation, formatting, validation, mapping | **pure function** in `helpers.ts` / `src/lib/` | plain unit test |
| stateful behaviour, subscriptions, side effects | **custom hook** | through a component |
| wiring props into JSX | the **component body** | render test |

**The hook test: if a function calls no hook, it is not a hook** `[C1]`.

```ts
export function useSeverityLabel(sev: Severity) {   // ✗ not a hook
  return SEV_LABEL[sev] ?? "Unknown";
}

export function severityLabel(sev: Severity) {      // ✓ callable conditionally, in loops
  return SEV_LABEL[sev] ?? "Unknown";
}
```

The `use` prefix costs you conditional calls and buys nothing. It also lies to the linter,
which then stops protecting the real hooks.

**Keep the component body pure** — same props in, same JSX out; never mutate anything created
outside this render `[B3]`. Side effects go in event handlers first, Effects only as a last
resort `[B3][C2]`. Mutating an object you created during the same render is fine.

Business logic — the calculations, validation and formatting — should be pure functions
independent of React `[C4]`. That is what keeps it testable without a renderer and portable if
the view layer ever changes.

## Extracting a hook

Extract when the logic is **duplicated across components**, is **complex enough that hiding it
aids reading**, or **has a name you can state plainly** `[C1]`.

Keep hooks on concrete, high-level use cases — `useOnlineStatus`, `useChatRoom`, `useCopyFlash`.
Never build `useMount` / `useEffectOnce` / `useUpdateEffect` lifecycle wrappers: they hide the
reactive nature of Effects and make missing dependencies easy `[C1]`.

Custom hooks share stateful **logic, not state**. Two components calling the same hook get two
independent states. If they must share a value, lift it `[C1][E3]`.

**Before writing a `useEffect`, check it against the twelve cases in `[C2]`.** Most Effects
found in review are one of: derived state, event-handler logic, or a chain of Effects that
should have been one event handler.

## Which `hooks/` folder

`src/lib/hooks/` is **data-only** — TanStack Query hooks over the API. A stateful hook that
makes no request does not belong there.

**Good** — a non-data hook owned by the component tree that uses it:

```
src/components/app-shell/hooks/
├── useGlobalShortcuts.ts
├── useShellCommands.ts
└── useShellContext.ts
```

**Good** — a new one, colocated the same way at the shallowest folder with a consumer:

```ts
// _components/RunTraceDrawer/hooks/useCopyFlash.ts
export function useCopyFlash(text: string, ms = 1500) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), ms);
    return () => clearTimeout(id);        // cleanup, or it fires after unmount
  }, [copied, ms]);
  return { copied, copy: () => { navigator.clipboard.writeText(text); setCopied(true); } };
}
```

**Bad** — `src/lib/hooks/useCopyFlash.ts`. It touches no endpoint, so it would sit in the data
barrel and be pulled in by every `@/lib/hooks` import.

**Bad** — leaving it in `helpers.ts`. Helpers are pure; this one holds state and a timer.

## The data layer

- **Every API call sits behind a hook in `src/lib/hooks/<domain>.ts`.** No `fetch` in a
  component `[C6]`.
- **Never copy query data into `useState`** — it opts the component out of every background
  refetch and leaves a stale duplicate `[C6][E1]`.
- **Query keys live beside their query**, in the same domain file, structured generic →
  specific. The hook is the exported surface; the query function and key stay local `[C7]`.
- Loading, error and empty states are handled by the component that owns the hook.

```tsx
// ✓ Good
const { data: runs, isLoading } = usePrActiveRuns(prId);

// ✗ Bad — three violations at once
const [runs, setRuns] = useState([]);                    // server data in local state
useEffect(() => {                                        // fetch in a component
  fetch(`${API_BASE}/pulls/${prId}/runs`)                // no hook, no key, no cache
    .then((r) => r.json()).then(setRuns);
}, [prId]);
```

The `useState` copy is the worst of the three — it is silent, and it disables exactly the
behaviour the cache was added for.

## State placement

| The state is… | It lives in |
|---|---|
| server data | the query cache — it is not client state `[E1]` |
| bookmarkable or shareable (filters, pagination, search, tabs) | URL search params `[E2]` |
| used by one component | `useState` there |
| used by siblings | `useState` in their **closest** common ancestor — no higher `[E3]` |
| derivable from props or other state | **nowhere** — compute during render `[C2][C3]` |

```tsx
// ✗ Bad — lost on reload, cannot be shared
const [severity, setSeverity] = useState<Severity | "ALL">("ALL");

// ✓ Good — survives reload, back/forward and copy-paste
const searchParams = useSearchParams();
const severity = (searchParams.get("severity") ?? "ALL") as Severity | "ALL";
```

Validate what comes back from the URL. An unknown `?sev=MAJOR` reaching a lookup with no
fallback takes the route down — narrow it to a known value or `null` first.

**Structure the state you keep** `[C3]`: group what updates together, avoid contradictory
flags, avoid redundancy, avoid duplication, keep it flat. "Make your state as simple as it can
be — but no simpler."

To decide whether something *is* state at all, ask `[B1]`: does it stay unchanged over time?
Is it passed in via props? Can it be computed from existing state or props? A yes to any means
it is not state.

## Derived state

```tsx
// ✗ Bad — an extra render pass and a value that can disagree with its source
const [visible, setVisible] = useState<FindingRecord[]>([]);
useEffect(() => {
  setVisible(findings.filter((f) => f.severity === sev));
}, [findings, sev]);

// ✓ Good
const visible = findings.filter((f) => f.severity === sev);
```

Computing derived values in the render body is correct — do **not** convert them to
`useState` + `useEffect` `[C2]`.

`useMemo` only when the input is genuinely large and the work is real — filtering every line of
a full system prompt on each keystroke, for instance. Be consistent within a component: memoize
both derived values or neither, so the next reader is not left guessing why one was singled
out. With React Compiler enabled, do not hand-write memoization at all unless measured `[G1][G2]`.

PR Self-Review — PASS        0 critical · 7 major · 1 minor
base e59ab57 → HEAD c84d590 · branch test/psr-eval-fixture-3-frontend · mode full

GATES
  --    server  arch  not run — no server file in the diff
  --    server  typecheck  not run — no server file in the diff
  --    server  test  not run — no server file in the diff
  ok    client  lint  
  ok    client  typecheck  
  ok    client  test  
  --    reviewer-core  typecheck  not run — no reviewer-core file in the diff
  --    reviewer-core  test  not run — no reviewer-core file in the diff
  ok    repo  vendor  
  ok    repo  registry  lock and directories agree

MAJOR — 7
  .claude/skills/react-testing-library/SKILL.md:603  [gate registry]
     SKILL.md is 603 lines, over the 500-line cap in .claude/skills/README.md
     Fix: move detail into a topic file and link it from the navigation table
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:22  [agent security · security §A05 Injection]
     fetch(`/api/repos/${repoId}/labels`) interpolates repoId into the request path with no
     encoding and no validation.
     Verifier: REFUTED from critical, downgraded to major — the mechanism (percent-encoded
     dot-segment traversal) checks out, but the component is dead code (zero importers), the
     fetch never reaches the real backend (no /api proxy on this origin), and no /admin route
     exists to reach. Mechanism confirmed, but unreachable and pointed at nothing today.
     Fix: Route this through api.get(`/repos/${encodeURIComponent(repoId)}/labels`) so the
     request goes through the app's fixed API_BASE origin, and encode the path segment.
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:11  [agent conventions · frontend-architecture §Review checklist]
     LabelQuickFilter has zero consumers — grep across client/src finds no import of it outside
     its own folder, and pulls/page.tsx never renders it. Checklist step 3: "Zero — you are
     speculating; go back to step 1."
     Fix: Render <LabelQuickFilter repoId={repoId} /> from pulls/page.tsx and wire it into the
     existing filtered list, or drop the file until there is a real caller.
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:13  [agent conventions · frontend-architecture §Review checklist]
     cachedPulls mirrors the TanStack Query result from usePulls into local useState, synced by
     a useEffect. This is exactly the checklist's "no query data copied into useState"
     violation — principle 5 says derive during render.
     Fix: Delete cachedPulls/setCachedPulls and the sync effect; filter pulls ?? [] directly
     from the usePulls() result each render.
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:22  [agent conventions · frontend-architecture §Review checklist]
     Raw fetch('/api/repos/${repoId}/labels') is called directly inside the component's
     useEffect. The checklist explicitly forbids fetch outside lib/hooks/. It also bypasses
     TanStack Query entirely, so there is no loading/error state, no caching, no request
     cancellation on repoId change.
     Fix: Add a useLabels(repoId) hook in src/lib/hooks/*.ts built on useQuery, and call that
     from the component instead of a raw fetch.
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:14  [agent conventions · frontend-architecture §Review checklist]
     selectedLabel is a shareable filter kept in local useState rather than the URL. The
     checklist requires shareable state to be in the URL, and the sibling page pulls/page.tsx
     already puts its status filter in ?status= via useSearchParams/router.replace — the exact
     pattern this should reuse.
     Fix: Move selectedLabel into a ?label= search param (useSearchParams + router.replace),
     following the status param already implemented in pulls/page.tsx.
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:1  [agent conventions · frontend-architecture §Review checklist]
     New component with no accompanying test file — the folder contains only
     LabelQuickFilter.tsx and index.ts. client/AGENTS.md requires every colocated
     _components/<Name>/ folder to carry its own *.test.tsx.
     Fix: Add LabelQuickFilter.test.tsx in the same folder covering the label filter, the
     async label fetch, and the matching count.

MINOR — 1
  client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx:24  [agent conventions · typescript-expert §Code Review Checklist]
     .then((labels: string[]) => setAvailableLabels(labels)) asserts the JSON body is string[]
     by parameter annotation alone — res.json() resolves Promise<any>, so nothing checks the
     response actually is an array of strings.
     Fix: Type the response as unknown and narrow with Array.isArray(x) &&
     x.every(v => typeof v === 'string') before calling setAvailableLabels.

NOTE — 10
  10 skills-lock.json entries, unrelated to this diff. Omitted here; see the fixture's
  last-run.json for the full set.

SKIPPED

This skill checks conventions, not correctness. For logic bugs run /code-review.

## Review: LabelQuickFilter

**Finding 1 — Fetches a `/api/...` path that doesn't exist in this app**
File: `client/src/app/repos/[repoId]/pulls/_components/LabelQuickFilter/LabelQuickFilter.tsx`, line 20
Severity: Critical (broken feature)
`fetch('/api/repos/${repoId}/labels')` is a relative fetch that resolves against the Next.js server, not the Fastify API. This client has no `app/api/**` route handlers at all, and every other fetch goes through `API_BASE` (`http://localhost:3001`, no `/api` prefix) in `src/lib/api.ts`. Grepped `server/src/modules` for "labels" and found nothing resembling a route either. This call will 404 every time, so `availableLabels` stays permanently empty and the dropdown never offers anything but "All labels".

**Finding 2 — Raw `fetch` in a component instead of a TanStack Query hook**
File: same file, lines 19-22
Severity: Major (explicit convention violation)
Cited `client/AGENTS.md`: data should go through TanStack Query, via hooks in `src/lib/hooks/*`, not `fetch` called directly from a component. This bypasses `src/lib/api.ts` (which normalizes errors to `ApiError`) and has no `.catch` — a failed/non-JSON response is an unhandled promise rejection.

**Finding 3 — "Label" filter actually substring-matches the title, not real PR labels**
File: same file, lines 24-26
Severity: Major (functional/semantic bug)
`pr.title.includes(selectedLabel)` treats a label like "bug" as a plain substring of the title. `PrMeta` has no `labels` field at all — there's no such data on a PR in this schema. A PR actually labeled "bug" but titled "Fix login redirect" never matches; a PR titled "bug: typo in footer" matches regardless of its real labels.

**Finding 4 — Redundant state+effect mirroring already-reactive query data**
File: same file, lines 15-18
Severity: Minor (anti-pattern)
`cachedPulls` is local state synced from `pulls` via `useEffect`. Since `pulls` is already reactive (TanStack Query), this just adds an extra render on every data change with no behavioral benefit over reading `pulls` directly in the `visible` computation.

**Finding 5 — Hardcoded English strings instead of `next-intl`**
File: same file, lines 34, 41
Severity: Minor (convention violation)
"All labels" and "{n} matching" are hardcoded, unlike every sibling in this folder (`FilterBar` uses `t("list.filterPlaceholder")`, etc.).

**Finding 6 — Plain `<select>`/`<span>` instead of the shared UI kit; no `styles.ts`**
File: same file, lines 33-43
Severity: Minor (consistency)
Siblings (`FilterBar`, `PRRow`, `FindingsCell`) are built from `@devdigest/ui` primitives plus a colocated `styles.ts`. This uses bare unstyled elements instead.

**Finding 7 — No test file**
File: `LabelQuickFilter/` folder (missing `LabelQuickFilter.test.tsx`)
Severity: Minor (convention violation)
Sibling folders `FindingsCell` and `PRRow` both have one, this one has none.

**Finding 8 — Component is added but never wired up anywhere**
File: `client/src/app/repos/[repoId]/pulls/page.tsx` / `_components/FilterBar/FilterBar.tsx` (not touched by this diff)
Severity: Minor (dead code / incomplete PR)
Not imported into `page.tsx`, `FilterBar`, or anywhere else.

**Bottom line:** Findings 1 and 3 mean the feature as shipped won't do what it claims. Findings 2, 5, 6, 7 are deviations from conventions already established by this exact folder's siblings and from `client/AGENTS.md`. No mention of URL-shareable filter state.

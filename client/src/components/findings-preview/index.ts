/* Explicit re-exports, not `export *`. This was three `export *` lines over
   `FindingsPreview`, `helpers` and `styles` — the aggregating kind INSIGHTS.md
   names as costly, as against a leaf barrel re-exporting one component.

   It was not theoretical: `SeverityFilterBar/constants.ts` wanted only
   `SEVERITY_LEVELS`, a three-string array, and got `FindingsPreview.tsx`, React,
   `@devdigest/ui`, `FileRef` and `@/lib/github-urls` in its module graph with
   it. That consumer now imports `./helpers` directly, which is type-only at
   runtime, so nothing named here reaches it.

   Keep this list to what a consumer outside the folder actually imports. The
   card's internals — `styles`, `FileRef`, `shortPath`, `lineRef`, `PAGE_SIZE` —
   are deliberately absent: nothing outside uses them, and re-exporting them
   would put the whole component back in every importer's graph. */
export { FindingsPreview, type SeverityCount } from "./FindingsPreview";
export { rankFindings } from "./helpers";

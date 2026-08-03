/* Explicit re-exports, not `export *`, and deliberately just the component.

   `SEVERITY_LEVELS`, `countBySeverity` and `isSeverityLevel` used to be named
   here too, so a consumer that wanted a three-string array or a pure predicate
   got `SeverityFilterBar.tsx` — React, `next-intl`, `@devdigest/ui` and
   `./styles` — in its module graph with it. `RunFindings` and the PR-detail
   page now import `./constants` and `./helpers` directly.

   `SeverityLevel` stays: a type re-export is erased at compile time, so it adds
   no runtime edge, and four siblings read the type from here.

   Same rule as `components/findings-preview/index.ts` — keep this list to what
   a consumer outside the folder actually imports at runtime. */
export { SeverityFilterBar, SeverityFilterBar as default } from "./SeverityFilterBar";
export type { SeverityLevel } from "./constants";

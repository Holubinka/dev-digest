/* Only what a consumer outside this folder imports: the badge, and
   `severityColor` for `FindingCard`'s left border. `isKnownSeverity` is used by
   `FindingSeverityBadge.tsx`, `severityColor` and the test, all of which reach
   it as `./helpers`. Same rule as `components/findings-preview/index.ts`. */
export { FindingSeverityBadge } from "./FindingSeverityBadge";
export { severityColor } from "./helpers";

/* Only what a consumer outside this folder imports. `isKnownCategory` is used
   by `FindingCategoryTag.tsx` and its test, both of which reach it as
   `./helpers` — naming it here would widen the folder's public surface for
   nobody. Same rule as `components/findings-preview/index.ts`. */
export { FindingCategoryTag } from "./FindingCategoryTag";

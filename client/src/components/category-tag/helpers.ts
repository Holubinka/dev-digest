import { CAT, type Category } from "@devdigest/ui";

/**
 * Own-property check, never `value in CAT` and never a bare `CAT[value]`
 * truthiness test.
 *
 * `CAT` is a plain object literal, so it carries `Object.prototype`:
 * `CAT["constructor"]` is `Object`, `CAT["toString"]` is a function, and both
 * are truthy. That is why `CategoryTag`'s own `if (!c) return null` does not
 * save it — the guard never fires, `c.icon` is `undefined`, and `Icon[undefined]`
 * throws `Element type is invalid`, taking the route down rather than dropping
 * one tag. Verified by render: the vendored tag throws for `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty` and `isPrototypeOf`, while a merely
 * unknown string like `"nonsense"` is handled correctly.
 *
 * `findings.category` is an unconstrained `text` column filled from LLM agent
 * JSON, so any of those strings can reach here.
 *
 * This is the `isKnownSeverity` shape from `components/severity-badge`, keyed on
 * the same table the renderer reads.
 */
export function isKnownCategory(value: unknown): value is Category {
  return typeof value === "string" && Object.hasOwn(CAT, value);
}

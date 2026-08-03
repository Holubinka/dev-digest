import { SEV, type Severity } from "@devdigest/ui";

/**
 * Keyed off `SEV`, not the `Severity` contract enum — they are different sets.
 * `@devdigest/shared` has three levels, the vendored `SEV` table has four (it
 * adds INFO), so testing against the contract would reject a renderable INFO.
 *
 * `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `"toString"`,
 * `"constructor"`, `"valueOf"`, `"hasOwnProperty"` and `"__proto__"` all
 * answered true on this plain object literal. Such a value passed the guard,
 * `SEV[severity]` resolved to a method on `Object.prototype`, and the `.icon`
 * read below it yielded `undefined` — the route-killing `Element type is
 * invalid` in INSIGHTS.md. `severity` is a plain `text` column, so any of them
 * can reach here.
 */
export function isKnownSeverity(value: unknown): value is Severity {
  return typeof value === "string" && Object.hasOwn(SEV, value);
}

/**
 * The `SEV[severity]` read below is only safe because the guard above is an
 * own-property check. Keep it going through `isKnownSeverity` — a bare
 * `severity in SEV` here would return `undefined` typed as `string` for every
 * prototype key.
 */
export function severityColor(severity: string): string {
  return isKnownSeverity(severity) ? SEV[severity].c : "var(--text-muted)";
}

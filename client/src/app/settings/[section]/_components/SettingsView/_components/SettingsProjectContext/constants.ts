import { SettingsKnown } from "@devdigest/shared";

/**
 * The values in effect when the workspace has never set either key.
 *
 * `GET /settings` returns the stored rows only, so an unset key arrives as
 * `undefined` and this screen has to know what "unset" means in order to show it
 * as the value in effect rather than as an empty field.
 *
 * Asking the schema for them rather than restating them is the point: this screen
 * exists to print the value the server will use, and a literal here would keep
 * printing the old number for as long as nobody noticed the schema had moved —
 * nothing type-checks a copy against its original. `parse(undefined)` returns the
 * declared default because both fields carry one.
 */
export const DEFAULT_CONTEXT_SCAN_ROOTS: readonly string[] =
  SettingsKnown.shape.context_scan_roots.parse(undefined);
export const DEFAULT_CONTEXT_BUDGET_TOKENS: number =
  SettingsKnown.shape.context_token_budget.parse(undefined);

/**
 * A comma-separated list of folder names, cleaned.
 *
 * Blank entries are dropped, and a leading `/` or a `..` segment with them: a
 * root is a repo-relative folder name, and the server refuses anything else
 * anyway — this only keeps the field from saving something it will not honour.
 */
export function parseRoots(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0 && !part.split("/").includes(".."));
}

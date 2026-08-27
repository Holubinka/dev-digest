/** Pure helpers for the Export Wizard. */

import type { Repo } from "@/lib/types";
import { FALLBACK_BASE } from "./constants";

/**
 * The size AC-24 reports, in BYTES.
 *
 * `String.length` counts UTF-16 code units, so it under-reports every non-ASCII
 * byte and would name a size the target repository will not have — the same
 * trap `server/INSIGHTS.md` records for `String.slice` over emoji.
 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The base branch of a repo by `owner/name`, falling back to the contract's. */
export function baseBranchOf(repos: Repo[], fullName: string): string {
  return repos.find((r) => r.full_name === fullName)?.default_branch || FALLBACK_BASE;
}

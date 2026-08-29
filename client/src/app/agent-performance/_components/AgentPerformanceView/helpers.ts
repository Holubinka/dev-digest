import type { AgentPerfRow } from "@/lib/types";
import { DEFAULT_SORT, sortValue, type SortKey, type SortState } from "./constants";

/**
 * Sorting, pure — because it is a rule the screen is judged on: reordering the
 * table must not reach the API (AC-31). Reading the period off the URL lives in
 * `@/components/period-picker`, which the Stats tab reads too.
 */

/**
 * Rows in the order the table draws them.
 *
 * Two rules the browser's default comparator does not give you:
 *
 * A row with NO value sorts last in BOTH directions. "Cheapest first" must not
 * open with the three agents whose cost is unknown — an absent number is not a
 * small one, and putting it at the top answers a question the reader did not ask.
 *
 * Sorting by accept rate puts the agents with enough decisions FIRST, whichever
 * way the column points, and only then the small samples (AC-29). One accepted
 * finding is 100%, and above a 78% earned over two hundred decisions it is not a
 * ranking, it is noise with a badge on it.
 */
export function sortRows(
  rows: AgentPerfRow[],
  sort: SortState,
  minDecisions: number,
): AgentPerfRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "accept") {
      const rankedA = a.judged >= minDecisions ? 0 : 1;
      const rankedB = b.judged >= minDecisions ? 0 : 1;
      if (rankedA !== rankedB) return rankedA - rankedB;
    }
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null || vb === null) {
      if (va === vb) return a.agent_name.localeCompare(b.agent_name);
      return va === null ? 1 : -1;
    }
    if (typeof va === "string" && typeof vb === "string") {
      return dir * va.localeCompare(vb) || a.agent_name.localeCompare(b.agent_name);
    }
    return dir * ((va as number) - (vb as number)) || a.agent_name.localeCompare(b.agent_name);
  });
}

/** Clicking the active column flips it; clicking another starts it descending. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: key === "agent" ? "asc" : "desc" };
  return { key, dir: current.dir === "desc" ? "asc" : "desc" };
}

export { DEFAULT_SORT };
export type { SortKey, SortState };

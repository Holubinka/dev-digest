import type { AgentPerfRow } from "@/lib/types";

/** Which column a click on a header sorts by, and how it reads a row. */
export type SortKey = "agent" | "runs" | "cost" | "duration" | "accept" | "lastRun";

export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export interface SortColumn {
  key: SortKey;
  /** Message key under the `agentPerformance` namespace. */
  labelKey: string;
  numeric: boolean;
}

/**
 * The table's columns, in the order the mockup draws them
 * (`specs/assets/SPEC-07-agent-performance-dashboard.jpg`). `View` is not here:
 * it is an action, and there is nothing to sort a link by.
 */
export const SORT_COLUMNS: readonly SortColumn[] = [
  { key: "agent", labelKey: "table.agent", numeric: false },
  { key: "runs", labelKey: "table.runs", numeric: true },
  { key: "cost", labelKey: "table.avgCost", numeric: true },
  { key: "duration", labelKey: "table.avgDuration", numeric: true },
  { key: "accept", labelKey: "table.accept", numeric: true },
  { key: "lastRun", labelKey: "table.lastRun", numeric: false },
];

/** The mockup opens sorted by accept rate, descending, with the arrow on it. */
export const DEFAULT_SORT: SortState = { key: "accept", dir: "desc" };

/** Skeleton rows while the first answer is in flight — never zeros (AC-38). */
export const SKELETON_ROWS = 3;

/** What a row's sort key reads. `null` means "no value", never "the smallest". */
export function sortValue(row: AgentPerfRow, key: SortKey): number | string | null {
  switch (key) {
    case "agent":
      return row.agent_name;
    case "runs":
      return row.runs;
    case "cost":
      return row.avg_cost_usd;
    case "duration":
      return row.avg_duration_ms;
    case "accept":
      return row.accept_rate;
    case "lastRun":
      return row.last_run_at === null ? null : Date.parse(row.last_run_at);
  }
}

/**
 * The period a screen is showing, carried in the URL.
 *
 * It lives here rather than in either screen because two of them read it: the
 * Agent Performance dashboard and the agent editor's Stats tab, which the
 * dashboard's «View» links into WITH the period attached — so the tab opens on
 * the same window the row was counted over (SPEC-07 AC-46, AC-47).
 */
import type { PerfPeriodQuery } from "@/lib/hooks/performance";
import type { PerfRange } from "@/lib/types";

/** The window when the URL says nothing, or says something unusable. */
export const DEFAULT_PERIOD: PerfPeriodQuery = { range: "30d" };

/**
 * An unusable custom range falls back to the default rather than throwing: the
 * URL is user-editable, and a hand-typed `?from=yesterday` should land the
 * reader on a working screen with the default window, not on an error.
 */
export function periodFromParams(params: URLSearchParams): PerfPeriodQuery {
  const range = params.get("range") as PerfRange | null;
  if (range === "1d" || range === "30d") return { range };
  if (range === "custom") {
    const from = params.get("from");
    const to = params.get("to");
    if (isUsable(from) && isUsable(to) && Date.parse(from) < Date.parse(to)) {
      return { range: "custom", from, to };
    }
  }
  return DEFAULT_PERIOD;
}

function isUsable(value: string | null): value is string {
  return value !== null && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** The query string that carries a period in the address bar. */
export function periodToSearch(period: PerfPeriodQuery): string {
  const params = new URLSearchParams({ range: period.range });
  if (period.range === "custom" && period.from && period.to) {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return params.toString();
}

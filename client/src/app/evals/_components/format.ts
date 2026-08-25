/** Display helpers shared by the two eval screens. Pure; no hooks, no JSX. */

/** 0…1 → the whole percent the mockups print beside every bar. */
export function pct(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

/**
 * `2026-05-29 09:14`, the shape both mockups' tables use — LOCAL time, because
 * "when did I run this" is a question about the reader's clock. Built from the
 * date's own components rather than `toLocaleString`, whose separators and
 * ordering change with the runtime locale and would make the column ragged.
 */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/**
 * The date-range options the toolbar offers.
 *
 * `labelKey` is stored beside each range rather than built as
 * `` `dashboard.range.${key}` ``: the URL value is `30d` and the message key is
 * `d30` — a JSON key cannot usefully start with a digit here — so the template
 * form silently rendered `eval.dashboard.range.30d` as the visible option text.
 * Every gate stayed green through it: `toHaveValue("30d")` asserts the option's
 * VALUE, and the label was only wrong on screen.
 */
export const RANGES = [
  { key: "7d", labelKey: "dashboard.range.d7" },
  { key: "30d", labelKey: "dashboard.range.d30" },
  { key: "90d", labelKey: "dashboard.range.d90" },
  { key: "all", labelKey: "dashboard.range.all" },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export const RANGE_KEYS: readonly RangeKey[] = RANGES.map((r) => r.key);

/** The mockup's default. Anything the URL cannot be read as falls back to it. */
export const DEFAULT_RANGE: RangeKey = "30d";

export function readRange(raw: string | null | undefined): RangeKey {
  return RANGE_KEYS.includes(raw as RangeKey) ? (raw as RangeKey) : DEFAULT_RANGE;
}

/**
 * The range as the API takes it. `from` only: an open-ended upper bound is what
 * "the last 30 days" means, and pinning `to` to now would silently drop a batch
 * that finished between the render and the request.
 *
 * AC-58 is satisfied by this being ONE request: the server bounds the trend and
 * the batch table with the same pair, so the chart and the table below it can
 * never disagree about which runs are in range.
 */
export function rangeToQuery(range: RangeKey, now: Date = new Date()): { from?: string } {
  if (range === "all") return {};
  const days = Number(range.replace("d", ""));
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString() };
}

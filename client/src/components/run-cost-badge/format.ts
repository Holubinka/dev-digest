/**
 * Formatters for run cost and token counts.
 *
 * These live here rather than beside the run-trace drawer because four separate
 * surfaces render the same numbers (PR list, timeline, verdict plaque, trace
 * Stats) and they must agree to the digit.
 */

/** Em-dash: "we have no number", as opposed to a real cost of zero. */
export const NO_DATA = "—";

/**
 * USD cost, with precision scaled to magnitude.
 *
 * A flat 2-decimal format collapses every cheap run to "$0.00", which reads as
 * free rather than as sub-cent; a flat 4-decimal format buries a $12 run in
 * noise. So: the cheaper the run, the more decimals it earns.
 *
 * Only null/undefined — genuinely no data — becomes "—". A real 0 (a free
 * OpenRouter model) formats as "$0.0000", because that IS the cost.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return NO_DATA;
  const abs = Math.abs(usd);
  if (abs < 0.01) return `$${usd.toFixed(4)}`;
  if (abs < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

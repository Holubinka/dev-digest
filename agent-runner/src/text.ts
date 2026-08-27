/**
 * Cut `text` to `max` CODE POINTS.
 *
 * `String.slice` counts UTF-16 units and splits a surrogate pair, sending the
 * model a lone high surrogate; the whole repo cuts by code point instead
 * (server/INSIGHTS.md, "Cut by code point"; reviewer-core does the same in
 * `assemblePrompt`).
 */
export function truncate(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}

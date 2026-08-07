/** `:12` for one line, `:12-18` for a range, nothing when the line is unknown. */
export function lineLabel(line: number | null, endLine: number | null): string {
  if (line == null) return "";
  return endLine != null && endLine !== line ? `:${line}-${endLine}` : `:${line}`;
}

/** Green / amber / red, on the same thresholds the findings list uses. */
export function confidenceColor(percent: number): string {
  if (percent >= 80) return "var(--ok)";
  if (percent >= 60) return "var(--warn)";
  return "var(--crit)";
}

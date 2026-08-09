/** `:12` for one line, `:12-18` for a range, nothing when the line is unknown. */
export function lineLabel(line: number | null, endLine: number | null): string {
  if (line == null) return "";
  return endLine != null && endLine !== line ? `:${line}-${endLine}` : `:${line}`;
}

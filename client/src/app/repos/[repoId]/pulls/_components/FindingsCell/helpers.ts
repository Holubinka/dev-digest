/** Longest `file` string the hover card shows before eliding folders. */
export const PATH_BUDGET_CHARS = 46;

/**
 * Shorten a repo path from the LEFT, at a folder boundary: the filename is what
 * identifies a finding, so it is the part that must survive. A path that fits is
 * returned untouched.
 *
 * `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
 * → `…/FindingsPanel/FindingsPanel.tsx`
 *
 * The card also clips with `text-overflow: ellipsis`, but only this keeps the
 * informative end of the path — CSS would drop the filename instead.
 */
export function shortPath(file: string, budget: number = PATH_BUDGET_CHARS): string {
  if (file.length <= budget) return file;
  const parts = file.split("/");
  let out = parts[parts.length - 1] ?? file;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length + 2 > budget) break;
    out = next;
  }
  return `…/${out}`;
}

/** `file:line` as the card shows it — a range only when the lines differ. */
export function lineRef(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

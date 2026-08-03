export type DiffOp = "same" | "add" | "remove";

export interface DiffRow {
  op: DiffOp;
  text: string;
}

/** Beyond this, the quadratic table is not worth building for a skill body. */
const LCS_LIMIT = 400;

/**
 * Line diff between two bodies.
 *
 * Hand-rolled rather than a dependency: a skill body is tens of lines, the
 * output is three op kinds, and the alternative is shipping a diff library to
 * render one tab.
 *
 * Common prefix and suffix are stripped first, which is what makes it cheap —
 * a real edit touches a few lines in the middle, so the quadratic part almost
 * never runs on the whole body. If what remains is still large, the middle is
 * emitted as one removed block followed by one added block rather than spending
 * seconds to align it prettily.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  // "".split("\n") is [""], one empty line — which would render an empty body
  // as a removed blank line. An absent body has no lines at all.
  const toLines = (text: string) => (text === "" ? [] : text.split("\n"));
  const a = toLines(before);
  const b = toLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const rows: DiffRow[] = a.slice(0, head).map((text) => ({ op: "same" as const, text }));
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  rows.push(...middle(midA, midB));
  rows.push(
    ...a.slice(a.length - tail).map((text) => ({ op: "same" as const, text })),
  );
  return rows;
}

function middle(a: string[], b: string[]): DiffRow[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((text) => ({ op: "add", text }));
  if (b.length === 0) return a.map((text) => ({ op: "remove", text }));
  if (a.length > LCS_LIMIT || b.length > LCS_LIMIT) {
    return [
      ...a.map((text): DiffRow => ({ op: "remove", text })),
      ...b.map((text): DiffRow => ({ op: "add", text })),
    ];
  }

  // Longest common subsequence over the lines that actually differ.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push({ op: "remove", text: a[i]! });
      i++;
    } else {
      rows.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) rows.push({ op: "remove", text: a[i++]! });
  while (j < b.length) rows.push({ op: "add", text: b[j++]! });
  return rows;
}

/** How many lines the change added and removed. */
export function diffStat(rows: DiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter((r) => r.op === "add").length,
    removed: rows.filter((r) => r.op === "remove").length,
  };
}

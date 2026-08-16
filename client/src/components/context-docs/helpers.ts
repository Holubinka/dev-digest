import type { AttachedContextDoc, InheritedContextDoc, SpecFile } from "@/lib/types";

/**
 * Shared logic for the two Context tabs — an agent's and a skill's.
 *
 * It sits in `src/components/` rather than beside either editor because both
 * routes consume it: `app/agents/[id]/…/ContextTab` and
 * `app/skills/…/SkillDetail/…/ContextTab`. One consumer would have kept it
 * colocated; two in different routes is what promotes it.
 */

/**
 * Every scanned document, attached ones first in SAVED order, then the rest
 * alphabetically — one list, the way the Skills tab shows skills.
 *
 * A saved path the current scan no longer holds is kept, at its saved position,
 * so a document that left the clone is visible as attached-and-missing rather
 * than silently gone.
 */
export function orderDocuments(
  scanned: SpecFile[],
  attached: AttachedContextDoc[],
): { path: string; doc: SpecFile | undefined; attachedIndex: number }[] {
  const byPath = new Map(scanned.map((doc) => [doc.path, doc]));
  const attachedPaths = [...attached]
    .sort((a, b) => a.position - b.position)
    .map((a) => a.path);
  const rest = scanned.filter((doc) => !attachedPaths.includes(doc.path)).map((doc) => doc.path);
  return [...attachedPaths, ...rest].map((path) => ({
    path,
    doc: byPath.get(path),
    attachedIndex: attachedPaths.indexOf(path),
  }));
}

/** Move one item, returning a new array. Out-of-range or no-op moves pass through. */
export function moveAt<T>(xs: readonly T[], from: number, to: number): T[] {
  const next = [...xs];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Add a path, or drop it — a checkbox in one function. New paths go last. */
export function togglePath(paths: readonly string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path];
}

/**
 * The token total for the EFFECTIVE set: own attachments plus inherited ones,
 * de-duplicated by path so a document attached in both places counts ONCE.
 *
 * Every number summed here is the `tokens` field the server sent, counted by the
 * same tokenizer the run measures the budget with. `approxTokens`
 * (`lib/tokens.ts`) is deliberately not used: it is `ceil(length / 4)`, which is
 * right for a size badge and wrong for a budget decision — the editor's figure
 * has to be the server's figure or the over-budget warning is about a different
 * number from the one the run enforces.
 *
 * A document with no `tokens` (attached but not in the current scan) contributes
 * nothing, which is the honest answer: nobody has counted it.
 */
export function effectiveTokens(
  attached: AttachedContextDoc[],
  inherited: InheritedContextDoc[],
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const doc of [...attached, ...inherited]) {
    if (seen.has(doc.path)) continue;
    seen.add(doc.path);
    total += doc.tokens ?? 0;
  }
  return total;
}

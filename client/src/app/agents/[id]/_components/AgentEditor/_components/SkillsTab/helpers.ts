import type { AgentSkillLink, SkillListItem } from "@devdigest/shared";

/**
 * Split every skill in the workspace into the ones this agent binds — in
 * binding order, which is prompt order — and the ones it does not.
 */
export function partitionSkills(
  all: SkillListItem[],
  links: AgentSkillLink[],
): { linked: SkillListItem[]; unlinked: SkillListItem[] } {
  const orderById = new Map(links.map((l) => [l.skill_id, l.order]));
  const linked = all
    .filter((sk) => orderById.has(sk.id))
    .sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  const unlinked = all.filter((sk) => !orderById.has(sk.id));
  return { linked, unlinked };
}

/** Move one item, returning a new array. Out-of-range or no-op moves pass through. */
export function moveAt<T>(xs: readonly T[], from: number, to: number): T[] {
  const next = [...xs];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Add an id, or drop it — a checkbox in one function. New ids go last. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

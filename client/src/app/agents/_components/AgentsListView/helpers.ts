import type { Agent } from "@devdigest/shared";

/**
 * Case-insensitive filter over an agent's name + description. Generic in the row
 * so the caller gets back what it passed in — the list holds `AgentListItem`,
 * and the card it feeds needs the `skill_count` to survive the filter.
 */
export function filterAgents<T extends Pick<Agent, "name" | "description">>(
  agents: T[],
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter((a) => `${a.name} ${a.description}`.toLowerCase().includes(q));
}

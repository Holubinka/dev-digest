/* agent-color.ts — the one colour an agent is drawn in, everywhere it appears.

   SPEC-05 AC-44/AC-45: the picker, the result column, the tab and the take in
   "Where agents disagree" must paint the same agent the same colour, and that
   colour has to come from the agent's IMMUTABLE id and nothing else. Indexing a
   palette by the agent's position in a list is the obvious alternative and it is
   the wrong one: the picker lists every agent and the results list only the
   chosen ones, so an agent would change colour between the two screens the
   colour exists to connect.

   The palette is finite, so two agents in one workspace can land on the same
   colour. That is accepted — it is why AC-45 requires the agent's NAME beside
   every use of the colour, and why nothing here is ever the only thing telling
   two agents apart. */

/**
 * Hex, not `var(--…)`, for two reasons. A caller composes a tint from it —
 * `color + "1f"` is how the mockup fills the agent's icon square and its selected
 * card — and string concatenation onto `var(--crit)` produces nothing a browser
 * will parse. And an agent's identity should not change between the light and the
 * dark theme the way a severity token deliberately does.
 */
export const AGENT_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#a855f7", // purple
  "#10b981", // green
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

/**
 * FNV-1a, 32-bit. Chosen because it is four lines, has no dependency and is
 * stable across runs and machines — `String.prototype.hashCode` does not exist
 * and anything seeded or random would repaint the agents on reload.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619 without overflowing into float territory.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The colour this agent is drawn in on every surface of the feature. */
export function agentColor(agentId: string): AgentColor {
  return AGENT_COLORS[fnv1a(agentId) % AGENT_COLORS.length]!;
}

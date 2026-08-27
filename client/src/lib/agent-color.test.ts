import { describe, it, expect } from "vitest";
import { AGENT_COLORS, agentColor } from "./agent-color";

const IDS = [
  "3f1c2b8e-0000-4000-8000-000000000001",
  "3f1c2b8e-0000-4000-8000-000000000002",
  "9a7d5c1f-0000-4000-8000-00000000000a",
  "security",
  "",
];

describe("agentColor", () => {
  it("gives the same id the same colour every time it is asked", () => {
    for (const id of IDS) {
      expect(agentColor(id)).toBe(agentColor(id));
    }
  });

  /**
   * The reason the function takes an id and not an index. The picker lists every
   * agent and the results list only the chosen ones, so any position-derived
   * colour changes between the two screens — which is exactly the connection the
   * colour was added to make (AC-44).
   */
  it("does not depend on the order the ids arrive in", () => {
    const forward = IDS.map(agentColor);
    const backward = [...IDS].reverse().map(agentColor).reverse();
    expect(backward).toEqual(forward);
    const shuffled = [IDS[3]!, IDS[0]!, IDS[4]!, IDS[2]!, IDS[1]!];
    expect(shuffled.map(agentColor)).toEqual([
      forward[3],
      forward[0],
      forward[4],
      forward[2],
      forward[1],
    ]);
  });

  it("only ever returns a colour from the palette", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `agent-${i}-${i * 7919}`);
    for (const id of [...ids, ...IDS]) {
      expect(AGENT_COLORS).toContain(agentColor(id));
    }
  });

  /**
   * Pins the hash itself. Changing it is allowed, but it repaints every agent in
   * every workspace, so it should be a deliberate edit to this list rather than a
   * side effect of tidying the hash function.
   */
  it("maps known ids to known colours", () => {
    expect(agentColor("security")).toBe("#a855f7");
    expect(agentColor("performance")).toBe("#06b6d4");
    expect(agentColor("3f1c2b8e-0000-4000-8000-000000000001")).toBe("#10b981");
  });

  it("spreads a realistic workspace over more than one colour", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-0000000000${i}`);
    expect(new Set(ids.map(agentColor)).size).toBeGreaterThan(1);
  });
});

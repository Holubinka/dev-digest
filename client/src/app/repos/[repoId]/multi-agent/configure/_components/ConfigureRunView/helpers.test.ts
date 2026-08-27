import { describe, it, expect } from "vitest";
import type { AgentListItem, LastSuccessfulRun } from "@devdigest/shared";
import { defaultSelection } from "@/lib/agent-selection";
import { estimateRun, isAllSelected } from "./helpers";

/* The estimate is tested as arithmetic and not through the DOM: what AC-17…AC-23
   are about is which numbers enter which sum, and a rendered "≈ 8.2s · $0.20"
   cannot tell a maximum from a sum that happens to agree on the fixture. */

const row = (over: Partial<LastSuccessfulRun> & { agent_id: string }): LastSuccessfulRun => ({
  duration_ms: 1000,
  cost_usd: 0.01,
  ran_at: "2026-08-26T10:00:00.000Z",
  ...over,
});

describe("estimateRun", () => {
  it("takes the MAXIMUM duration and the SUM of cost over the chosen agents", () => {
    const rows = [
      row({ agent_id: "a", duration_ms: 8200, cost_usd: 0.06 }),
      row({ agent_id: "b", duration_ms: 7400, cost_usd: 0.05 }),
      row({ agent_id: "c", duration_ms: 9100, cost_usd: 0.07 }),
    ];

    // `c` is not chosen: neither its longer run nor its cost may show up.
    const est = estimateRun(["a", "b"], rows);

    expect(est.durationMs).toBe(8200);
    expect(est.costUsd).toBeCloseTo(0.11, 10);
    expect(est.missingTime).toBe(0);
    expect(est.missingCost).toBe(0);
  });

  it("counts an agent with no successful run out of BOTH sums and names it (AC-20, AC-22)", () => {
    const est = estimateRun(["a", "never-ran"], [row({ agent_id: "a", duration_ms: 3000, cost_usd: 0.02 })]);

    expect(est.durationMs).toBe(3000);
    expect(est.costUsd).toBeCloseTo(0.02, 10);
    expect(est.missingTime).toBe(1);
    expect(est.missingCost).toBe(1);
  });

  /* The one case where the two sums disagree about the same agent, and the
     reason `missingTime` and `missingCost` are two numbers rather than one. */
  it("keeps a null-cost run in the time maximum while leaving it out of the cost sum (AC-21)", () => {
    const est = estimateRun(
      ["cheap", "unpriced"],
      [
        row({ agent_id: "cheap", duration_ms: 1000, cost_usd: 0.01 }),
        row({ agent_id: "unpriced", duration_ms: 9000, cost_usd: null }),
      ],
    );

    expect(est.durationMs).toBe(9000);
    expect(est.costUsd).toBeCloseTo(0.01, 10);
    expect(est.missingTime).toBe(0);
    expect(est.missingCost).toBe(1);
  });

  it("answers null, never zero, when nothing contributed (AC-23)", () => {
    const est = estimateRun(["x", "y"], []);

    expect(est.durationMs).toBeNull();
    expect(est.costUsd).toBeNull();
    expect(est.missingTime).toBe(2);
    expect(est.missingCost).toBe(2);
  });

  /* A genuinely free run reports 0, and that is a measurement. Folding it into
     "no data" is exactly what AC-23 forbids in the other direction. */
  it("treats a real zero as a number", () => {
    const est = estimateRun(["free"], [row({ agent_id: "free", duration_ms: 0, cost_usd: 0 })]);

    expect(est.durationMs).toBe(0);
    expect(est.costUsd).toBe(0);
    expect(est.missingCost).toBe(0);
  });

  it("counts an agent named twice once (AC-29 in the client's own arithmetic)", () => {
    const est = estimateRun(["a", "a"], [row({ agent_id: "a", duration_ms: 1000, cost_usd: 0.5 })]);

    expect(est.costUsd).toBe(0.5);
    expect(est.missingCost).toBe(0);
  });
});

const agent = (over: Partial<AgentListItem> & { id: string }): AgentListItem =>
  ({
    name: "Agent",
    description: "",
    enabled: true,
    skill_count: 0,
    ...over,
  }) as AgentListItem;

describe("defaultSelection / isAllSelected", () => {
  it("pre-ticks every enabled agent and no disabled one (AC-9)", () => {
    const agents = [
      agent({ id: "a" }),
      agent({ id: "b", enabled: false }),
      agent({ id: "c" }),
    ];

    expect(defaultSelection(agents)).toEqual(["a", "c"]);
  });

  it("stops at the ceiling one request may name, so the default is never a refusal (AC-30)", () => {
    const agents = Array.from({ length: 14 }, (_, i) => agent({ id: `a${i}` }));

    expect(defaultSelection(agents)).toHaveLength(10);
  });

  it("reads 'all selected' only when every enabled agent is ticked (AC-10, AC-11)", () => {
    const agents = [agent({ id: "a" }), agent({ id: "b", enabled: false }), agent({ id: "c" })];

    expect(isAllSelected(agents, [])).toBe(false);
    expect(isAllSelected(agents, ["a"])).toBe(false);
    // The disabled one is not required, and ticking it by hand does not undo it.
    expect(isAllSelected(agents, ["a", "c"])).toBe(true);
    expect(isAllSelected(agents, ["a", "b", "c"])).toBe(true);
  });
});

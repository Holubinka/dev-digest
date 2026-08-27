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

  /* Every case above chooses at most 2 agents against the default concurrency
     of 3, so none of them ever forms a second wave. This is the one that does:
     4 chosen agents at concurrency 3 form two waves, [a,b,c] and [d], and the
     duration must be the SUM of the two waves' maxima — 9000 + 6000 — not a
     single max over all four (which the old one-wave formula would give) and
     not a plain sum over all four (AC-152, AC-153). */
  it("sums the maximum of EACH wave once the chosen count exceeds concurrency (AC-152, AC-153)", () => {
    const rows = [
      row({ agent_id: "a", duration_ms: 9000, cost_usd: 0.01 }),
      row({ agent_id: "b", duration_ms: 8000, cost_usd: 0.01 }),
      row({ agent_id: "c", duration_ms: 7000, cost_usd: 0.01 }),
      row({ agent_id: "d", duration_ms: 6000, cost_usd: 0.01 }),
    ];

    const est = estimateRun(["a", "b", "c", "d"], rows, 3);

    expect(est.durationMs).toBe(15000); // 9000 (wave 1 max) + 6000 (wave 2 max)
    expect(est.costUsd).toBeCloseTo(0.04, 10);
  });

  /* The boundary the wave test above depends on: choosing exactly `concurrency`
     agents must still form a single wave and equal the old one-wave formula. */
  it("stays a single wave — and equals the plain maximum — when the chosen count fits within concurrency", () => {
    const rows = [
      row({ agent_id: "a", duration_ms: 9000 }),
      row({ agent_id: "b", duration_ms: 5000 }),
      row({ agent_id: "c", duration_ms: 1000 }),
    ];

    const est = estimateRun(["a", "b", "c"], rows, 3);

    expect(est.durationMs).toBe(9000);
  });

  /* A custom concurrency of 2 over 5 agents forms three waves: [10,8]→10,
     [6,4]→6, [2]→2. Neither "max over all" (10000) nor "sum over all"
     (30000) would produce this number, which is what pins the wave-forming
     loop rather than one of the two simpler wrong implementations it could
     collapse into. */
  it("forms as many waves as the chosen count requires under a non-default concurrency", () => {
    const rows = [
      row({ agent_id: "a", duration_ms: 10000 }),
      row({ agent_id: "b", duration_ms: 8000 }),
      row({ agent_id: "c", duration_ms: 6000 }),
      row({ agent_id: "d", duration_ms: 4000 }),
      row({ agent_id: "e", duration_ms: 2000 }),
    ];

    const est = estimateRun(["a", "b", "c", "d", "e"], rows, 2);

    expect(est.durationMs).toBe(18000);
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

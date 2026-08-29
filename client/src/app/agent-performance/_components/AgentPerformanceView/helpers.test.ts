/**
 * Sorting rules, tested where they are decided.
 *
 * Two of them are not what a comparator does by default, and both are visible to
 * a reader who clicks a header: a row with no value stays at the bottom either
 * way, and a rate earned over one decision never outranks one earned over fifty.
 */
import { describe, it, expect } from "vitest";
import type { AgentPerfRow } from "@/lib/types";
import { nextSort, sortRows } from "./helpers";
import { DEFAULT_SORT } from "./constants";

function row(over: Partial<AgentPerfRow> = {}): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Agent",
    provider: "openai",
    model: "gpt-4.1",
    runs: 10,
    runs_with_cost: 10,
    runs_without_cost: 0,
    findings_total: 20,
    accepted: 8,
    dismissed: 2,
    pending: 10,
    judged: 10,
    accept_rate: 0.8,
    dismiss_rate: 0.2,
    low_sample: false,
    prev_accept_rate: null,
    avg_findings_per_run: 2,
    total_cost_usd: 1,
    avg_cost_usd: 0.1,
    avg_duration_ms: 5000,
    last_run_at: "2026-08-29T10:00:00.000Z",
    findings_by_severity: { CRITICAL: 1, WARNING: 9, SUGGESTION: 10 },
    ...over,
  };
}

const names = (rows: AgentPerfRow[]) => rows.map((r) => r.agent_name);

describe("sortRows", () => {
  it("opens on accept rate, highest first — the column the mockup marks", () => {
    expect(DEFAULT_SORT).toEqual({ key: "accept", dir: "desc" });
  });

  it("keeps a row with no value at the bottom in BOTH directions", () => {
    const rows = [
      row({ agent_id: "a1", agent_name: "Unknown", avg_cost_usd: null }),
      row({ agent_id: "a2", agent_name: "Cheap", avg_cost_usd: 0.01 }),
      row({ agent_id: "a3", agent_name: "Dear", avg_cost_usd: 0.9 }),
    ];
    expect(names(sortRows(rows, { key: "cost", dir: "asc" }, 10))).toEqual([
      "Cheap",
      "Dear",
      "Unknown",
    ]);
    expect(names(sortRows(rows, { key: "cost", dir: "desc" }, 10))).toEqual([
      "Dear",
      "Cheap",
      "Unknown",
    ]);
  });

  it("ranks the agents with enough decisions first, then the small samples", () => {
    const rows = [
      row({ agent_id: "a1", agent_name: "Perfect", accept_rate: 1, judged: 1 }),
      row({ agent_id: "a2", agent_name: "Proven", accept_rate: 0.78, judged: 50 }),
      row({ agent_id: "a3", agent_name: "Middling", accept_rate: 0.5, judged: 40 }),
    ];
    expect(names(sortRows(rows, { key: "accept", dir: "desc" }, 10))).toEqual([
      "Proven",
      "Middling",
      "Perfect",
    ]);
    // Reversing the column reverses the RANKED group; it does not promote the
    // small sample into it.
    expect(names(sortRows(rows, { key: "accept", dir: "asc" }, 10))).toEqual([
      "Middling",
      "Proven",
      "Perfect",
    ]);
  });

  it("breaks every tie on the name, so two loads agree", () => {
    const rows = [
      row({ agent_id: "a1", agent_name: "Zeta", runs: 5 }),
      row({ agent_id: "a2", agent_name: "Alpha", runs: 5 }),
    ];
    expect(names(sortRows(rows, { key: "runs", dir: "desc" }, 10))).toEqual(["Alpha", "Zeta"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [row({ agent_name: "B", runs: 1 }), row({ agent_name: "A", runs: 9 })];
    sortRows(rows, { key: "runs", dir: "desc" }, 10);
    expect(names(rows)).toEqual(["B", "A"]);
  });
});

describe("nextSort", () => {
  it("starts a numeric column descending and the name column ascending", () => {
    expect(nextSort({ key: "accept", dir: "desc" }, "runs")).toEqual({ key: "runs", dir: "desc" });
    expect(nextSort({ key: "accept", dir: "desc" }, "agent")).toEqual({ key: "agent", dir: "asc" });
  });

  it("flips the column that is already active", () => {
    expect(nextSort({ key: "runs", dir: "desc" }, "runs")).toEqual({ key: "runs", dir: "asc" });
    expect(nextSort({ key: "runs", dir: "asc" }, "runs")).toEqual({ key: "runs", dir: "desc" });
  });
});

import { describe, it, expect } from "vitest";
import type { ReviewRecord } from "@devdigest/shared";
import { runsWithSeverity } from "./helpers";

/** A review run carrying only the severities of its findings. */
function run(id: string, severities: string[]): ReviewRecord {
  return {
    id,
    pr_id: "pr1",
    agent_id: null,
    run_id: `run-${id}`,
    agent_name: `agent ${id}`,
    // null = written before `head_sha` existed; this fixture counts severities and
    // says nothing about which state of the PR the run saw.
    head_sha: null,
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 70,
    model: null,
    grounding: null,
    created_at: "2026-07-28T10:00:00.000Z",
    findings: severities.map((severity, i) => ({
      id: `${id}-f${i}`,
      severity: severity as "CRITICAL" | "WARNING" | "SUGGESTION",
      category: "bug" as const,
      title: `finding ${id}-${i}`,
      file: "src/index.ts",
      start_line: 1,
      end_line: 1,
      rationale: "because",
      suggestion: null,
      confidence: 0.9,
      kind: "finding" as const,
      trifecta_components: null,
      evidence: null,
      review_id: id,
      accepted_at: null,
      dismissed_at: null,
    })),
  };
}

const RUNS: ReviewRecord[] = [
  run("a", ["CRITICAL", "WARNING"]),
  run("b", ["SUGGESTION"]),
  run("c", []),
];

describe("runsWithSeverity", () => {
  it("returns every run when no severity is selected", () => {
    expect(runsWithSeverity(RUNS, null)).toHaveLength(3);
  });

  it("keeps only runs holding a finding at that severity", () => {
    expect(runsWithSeverity(RUNS, "CRITICAL").map((r) => r.id)).toEqual(["a"]);
    expect(runsWithSeverity(RUNS, "SUGGESTION").map((r) => r.id)).toEqual(["b"]);
  });

  it("returns nothing when no run holds that severity", () => {
    expect(runsWithSeverity([run("d", ["WARNING"])], "CRITICAL")).toEqual([]);
  });
});

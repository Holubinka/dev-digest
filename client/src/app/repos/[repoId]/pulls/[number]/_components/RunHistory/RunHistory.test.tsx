/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — cost badge", () => {
  it("a settled run shows what it cost and how many tokens it moved", () => {
    renderRuns([
      run({ status: "done", cost_usd: 0.0013, tokens_in: 9119, tokens_out: 220, score: 90 }),
    ]);
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
    expect(screen.getByText("9k→0.2k")).toBeInTheDocument();
  });

  it("a settled run with no recorded cost reads '—', never '$0.00'", () => {
    renderRuns([run({ status: "done", cost_usd: null, score: 90 })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("an unsettled run shows no cost at all — it hasn't finished spending", () => {
    renderRuns([run({ status: "running", cost_usd: null, score: null, blockers: null })]);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});

describe("RunHistory — per-run findings", () => {
  const finding = (id: string, severity: string): FindingRecord =>
    ({
      id,
      severity,
      category: "security",
      title: `Finding ${id}`,
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      rationale: "why",
      confidence: 0.9,
    }) as FindingRecord;

  function renderWithFindings(runs: RunSummary[], findingsByRun: Map<string, FindingRecord[]>) {
    return render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={runs} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
      </NextIntlClientProvider>,
    );
  }

  it("shows severity chips for a settled run whose review is on the page", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 2, blockers: 0, score: 61 })],
      new Map([["run-1", [finding("a", "CRITICAL"), finding("b", "WARNING")]]]),
    );
    expect(screen.getByLabelText("1 critical, 1 warning, 0 suggestion")).toBeInTheDocument();
    expect(screen.queryByText("2 finding(s)")).not.toBeInTheDocument();
  });

  it("keeps the plain count when the run's review is not in the payload", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 2, blockers: 0, score: 61 })],
      new Map(),
    );
    // Zeros would claim the run was clean; the count is all we actually know.
    expect(screen.getByText("2 finding(s)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/critical/)).not.toBeInTheDocument();
  });

  it("shows no chips on a run that has not settled", () => {
    renderWithFindings(
      [run({ status: "running", score: null, blockers: null })],
      new Map([["run-1", [finding("a", "CRITICAL")]]]),
    );
    expect(screen.queryByLabelText(/critical/)).not.toBeInTheDocument();
  });
});

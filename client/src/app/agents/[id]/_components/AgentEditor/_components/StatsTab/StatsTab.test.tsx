/**
 * StatsTab — the agent editor's own numbers.
 *
 * The claim under test is the one SPEC-07 AC-46 makes: this tab and the Agent
 * Performance dashboard show the same figures for the same agent over the same
 * period. The server guarantees the numbers (one aggregation, one row) and this
 * component guarantees the rendering (one panel), so what a test can add here is
 * that the tab asks for the period it was opened on and prints what came back
 * without inventing anything while it waits.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import agentPerformance from "@/../messages/en/agentPerformance.json";
import type { Agent } from "@devdigest/shared";
import type { AgentPerfDetail, AgentPerfRow } from "@/lib/types";

let search = new URLSearchParams("tab=stats&range=1d");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => search,
}));

const { StatsTab } = await import("./StatsTab");

const agent = {
  id: "a1",
  name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
} as unknown as Agent;

function row(over: Partial<AgentPerfRow> = {}): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    runs: 142,
    runs_with_cost: 140,
    runs_without_cost: 2,
    findings_total: 60,
    accepted: 39,
    dismissed: 11,
    pending: 10,
    judged: 50,
    accept_rate: 0.78,
    dismiss_rate: 0.22,
    low_sample: false,
    prev_accept_rate: 0.7,
    avg_findings_per_run: 0.42,
    total_cost_usd: 5.68,
    avg_cost_usd: 0.04,
    avg_duration_ms: 6200,
    last_run_at: "2026-08-29T11:56:00.000Z",
    findings_by_severity: { CRITICAL: 4, WARNING: 20, SUGGESTION: 36 },
    ...over,
  };
}

const detail = (over: Partial<AgentPerfDetail> = {}): AgentPerfDetail => ({
  period: { kind: "1d", from: "2026-08-28T12:00:00.000Z", to: "2026-08-29T12:00:00.000Z" },
  min_decisions_for_rank: 10,
  cost_basis: "estimated",
  agent: row(),
  runs_trend: [{ at: "2026-08-29T00:00:00.000Z", value: 9 }],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

function answerWith(body: AgentPerfDetail | null, init: { status?: number; never?: boolean } = {}) {
  fetchMock = vi.fn(() =>
    init.never
      ? new Promise(() => {})
      : Promise.resolve({
          ok: (init.status ?? 200) < 400,
          status: init.status ?? 200,
          json: async () => body,
          statusText: "",
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  search = new URLSearchParams("tab=stats&range=1d");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderTab = () => renderWithProviders(<StatsTab agent={agent} />, { agentPerformance });

describe("StatsTab", () => {
  it("asks for the period it was opened on, so it matches the row that linked here (AC-47)", async () => {
    answerWith(detail());
    renderTab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/agents/a1/stats?range=1d");
  });

  it("prints the accept rate with its denominator, as the dashboard row does (AC-24)", async () => {
    answerWith(detail());
    renderTab();

    expect(await screen.findByText("78%")).toBeInTheDocument();
    expect(screen.getByText("39/50")).toBeInTheDocument();
    expect(screen.getByText("Not acted on: 10")).toBeInTheDocument();
  });

  it("says the cost was measured over fewer runs than it counted (AC-15)", async () => {
    answerWith(detail());
    renderTab();
    expect(await screen.findByText("$5.68 over 140 of 142 runs")).toBeInTheDocument();
  });

  it("shows nothing rather than zeros while the answer is in flight (AC-38)", () => {
    answerWith(null, { never: true });
    const { container } = renderTab();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
  });

  it("offers a retry and no numbers when the request fails (AC-39)", async () => {
    answerWith(null, { status: 500 });
    const { container } = renderTab();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
  });

  it("shows an agent with no run in the period as dashes, not zeros (AC-23)", async () => {
    answerWith(
      detail({
        agent: row({
          runs: 0,
          runs_with_cost: 0,
          runs_without_cost: 0,
          findings_total: 0,
          accepted: 0,
          dismissed: 0,
          pending: 0,
          judged: 0,
          accept_rate: null,
          dismiss_rate: null,
          prev_accept_rate: null,
          avg_findings_per_run: null,
          total_cost_usd: null,
          avg_cost_usd: null,
          avg_duration_ms: null,
          last_run_at: null,
        }),
      }),
    );
    const { container } = renderTab();

    expect(await screen.findByText("Stats")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3));
    expect(container.textContent).not.toContain("$0.00");
    expect(container.textContent).not.toContain("0%");
  });
});

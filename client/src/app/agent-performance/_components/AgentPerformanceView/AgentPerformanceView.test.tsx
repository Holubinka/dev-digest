/**
 * AgentPerformanceView — the promises this screen makes about its numbers.
 *
 * `fetch` is mocked at the global boundary rather than the hook, because two of
 * the criteria are ABOUT requests: sorting the table and expanding a row must not
 * make one (AC-31, AC-44). With the hook stubbed there would be nothing to count.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import agentPerformance from "@/../messages/en/agentPerformance.json";
import type { AgentPerf, AgentPerfRow } from "@/lib/types";

const replace = vi.fn();
const push = vi.fn();
let search = new URLSearchParams("range=30d");

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => search,
}));

const { AgentPerformanceView } = await import("./AgentPerformanceView");

function row(over: Partial<AgentPerfRow> = {}): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    runs: 142,
    runs_with_cost: 142,
    runs_without_cost: 0,
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

function perf(over: Partial<AgentPerf> = {}): AgentPerf {
  const agents = over.agents ?? [row()];
  return {
    period: { kind: "30d", from: "2026-07-30T12:00:00.000Z", to: "2026-08-29T12:00:00.000Z" },
    min_decisions_for_rank: 10,
    cost_basis: "estimated",
    summary: {
      runs: 253,
      runs_without_agent: 0,
      total_cost_usd: 8.74,
      prev_total_cost_usd: 9.94,
      runs_with_cost: 253,
      runs_without_cost: 0,
      accepted: 39,
      dismissed: 11,
      judged: 50,
      avg_accept_rate: 0.78,
      most_active_agent: {
        agent_id: "a1",
        agent_name: "Security Reviewer",
        runs: 142,
        accept_rate: 0.78,
      },
      runs_trend: [
        { at: "2026-08-27T00:00:00.000Z", value: 4 },
        { at: "2026-08-28T00:00:00.000Z", value: 9 },
      ],
      ...over.summary,
    },
    agents,
    cost_by_agent: over.cost_by_agent ?? [{ agent_id: "a1", label: "Security Reviewer", value: 8.74 }],
    cost_by_model: over.cost_by_model ?? [{ label: "gpt-4.1", value: 8.74 }],
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function answerWith(body: AgentPerf | null, init: { status?: number; never?: boolean } = {}) {
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
  search = new URLSearchParams("range=30d");
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderView() {
  return renderWithProviders(<AgentPerformanceView />, { agentPerformance });
}

describe("AgentPerformanceView — states that must not invent numbers", () => {
  it("shows no figures at all while the answer is in flight (AC-38)", () => {
    answerWith(null, { never: true });
    const { container } = renderView();

    expect(screen.getByText("Agent Performance")).toBeInTheDocument();
    // Not "the tiles show zero" — the tiles are not there yet.
    expect(screen.queryByText(/TOTAL RUNS/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
  });

  it("shows no figures when the request fails, only a way to retry (AC-39)", async () => {
    answerWith(null, { status: 500 });
    const { container } = renderView();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Could not load agent performance.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
  });

  it("tells an empty workspace apart from a quiet period (AC-40, AC-41)", async () => {
    answerWith(
      perf({ agents: [], summary: { ...perf().summary, runs: 0 }, cost_by_agent: [], cost_by_model: [] }),
    );
    renderView();
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();

    cleanup();
    answerWith(
      perf({
        agents: [row({ runs: 0 })],
        summary: { ...perf().summary, runs: 0 },
        cost_by_agent: [],
        cost_by_model: [],
      }),
    );
    renderView();
    expect(await screen.findByText("No runs in this period")).toBeInTheDocument();
  });
});

describe("AgentPerformanceView — the summary", () => {
  it("prints the run count, the cost and the accept rate with its denominator (AC-17)", async () => {
    answerWith(perf());
    renderView();

    expect(await screen.findByText("253")).toBeInTheDocument();
    // Scoped to the tile: the same total also appears in the by-agent donut's
    // legend, and an unscoped match would pass on either one alone.
    const costTile = screen.getByText("TOTAL COST (30D)").closest("div")!.parentElement!;
    expect(within(costTile).getByText("$8.74")).toBeInTheDocument();
    const rateTile = screen.getByText("AVG ACCEPT RATE").closest("div")!.parentElement!;
    expect(within(rateTile).getByText("78%")).toBeInTheDocument();
    expect(screen.getByText(/50 decisions/)).toBeInTheDocument();
  });

  it("names the most-active agent with the runs that earned it the title (AC-20)", async () => {
    answerWith(perf());
    renderView();

    expect(await screen.findByText("MOST-ACTIVE AGENT")).toBeInTheDocument();
    expect(screen.getByText("142 runs · 78% accept")).toBeInTheDocument();
  });

  it("says when a total left runs out, and when runs had no agent (AC-15, AC-34)", async () => {
    answerWith(
      perf({
        summary: {
          ...perf().summary,
          runs_with_cost: 240,
          runs_without_cost: 13,
          runs_without_agent: 2,
        },
      }),
    );
    renderView();

    expect(await screen.findByText(/13 runs with no recorded cost/)).toBeInTheDocument();
    expect(screen.getByText(/2 runs from deleted agents/)).toBeInTheDocument();
  });

  it("says every cost figure is an estimate, not reconciled billing (AC-36, AC-37)", async () => {
    answerWith(perf());
    renderView();
    expect(
      await screen.findByText(
        "Estimated by DevDigest from the model price book. No provider billing data is reconciled.",
      ),
    ).toBeInTheDocument();
  });
});

describe("AgentPerformanceView — the table", () => {
  it("shows an agent that never ran as zero runs and dashes, never $0.00 (AC-23)", async () => {
    answerWith(
      perf({
        agents: [
          row({
            agent_id: "a2",
            agent_name: "Quiet Reviewer",
            runs: 0,
            runs_with_cost: 0,
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
        ],
      }),
    );
    const { container } = renderView();

    expect(await screen.findByText("Quiet Reviewer")).toBeInTheDocument();
    expect(container.textContent).not.toContain("$0.00");
    expect(container.textContent).not.toContain("0%");
    // Four dashes: avg cost, avg duration, accept rate, last run.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("carries the denominator on every row and marks a small sample (AC-24, AC-29)", async () => {
    answerWith(
      perf({
        agents: [
          row(),
          row({
            agent_id: "a2",
            agent_name: "New Reviewer",
            judged: 1,
            accepted: 1,
            dismissed: 0,
            accept_rate: 1,
            low_sample: true,
          }),
        ],
      }),
    );
    renderView();

    expect(await screen.findByText("39/50")).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.getByText("low sample")).toBeInTheDocument();
  });

  it("carries the period into «View», so the tab opens on the same window (AC-3)", async () => {
    answerWith(perf());
    renderView();

    const link = await screen.findByRole("link", {
      name: "Open the Stats tab for Security Reviewer",
    });
    expect(link).toHaveAttribute("href", "/agents/a1?tab=stats&range=30d");
  });
});

describe("AgentPerformanceView — sorting and expanding cost nothing", () => {
  const twoAgents = perf({
    agents: [
      row({ agent_id: "a1", agent_name: "Security Reviewer", accept_rate: 0.78, judged: 50 }),
      row({
        agent_id: "a2",
        agent_name: "New Reviewer",
        accept_rate: 1,
        judged: 1,
        accepted: 1,
        dismissed: 0,
        low_sample: true,
      }),
    ],
  });

  it("puts a small sample below a ranked agent, whatever its rate (AC-29)", async () => {
    answerWith(twoAgents);
    const { container } = renderView();
    // Two matches: the most-active tile and the table row.
    await screen.findAllByText("Security Reviewer");

    const names = Array.from(container.querySelectorAll("a[href^='/agents/']")).map((a) =>
      a.getAttribute("aria-label"),
    );
    expect(names[0]).toContain("Security Reviewer");
    expect(names[1]).toContain("New Reviewer");
  });

  it("reorders and expands without making a single further request (AC-31, AC-44)", async () => {
    answerWith(twoAgents);
    renderView();
    await screen.findAllByText("Security Reviewer");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Sort by RUNS/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show the detail for Security Reviewer/ }));

    expect(await screen.findByText("By severity")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expands to the panel the Stats tab mounts, denominator and all (AC-45)", async () => {
    answerWith(perf());
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Show the detail/ }));

    const panel = screen.getByText("By severity").closest("div")!.parentElement!;
    expect(within(panel).getByText("Not acted on: 10")).toBeInTheDocument();
  });
});

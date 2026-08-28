import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchSummary, EvalDashboardAll, EvalDashboardCard } from "@/lib/types";
import messages from "../../../../../messages/en/eval.json";

const hooks = vi.hoisted(() => ({
  useEvalDashboardAll: vi.fn(),
  runAll: vi.fn(),
  runAllState: { isPending: false, data: undefined as unknown },
  push: vi.fn(),
}));

vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboardAll: hooks.useEvalDashboardAll,
  useRunAllEvals: () => ({
    mutate: hooks.runAll,
    isPending: hooks.runAllState.isPending,
    data: hooks.runAllState.data,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }));
// The real shell mounts the command palette and the repo context, both of which
// want a QueryClient. What is under test is the dashboard, not the chrome.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalDashboardView } from "./EvalDashboardView";

const batch = (over: Partial<EvalBatchSummary>): EvalBatchSummary => ({
  batch_id: "b1",
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  agent_version: 7,
  ran_at: "2026-05-29T09:14:00.000Z",
  cases: 20,
  passed: 17,
  errored: 0,
  recall: 0.82,
  precision: 0.91,
  citation_accuracy: 0.95,
  cost_usd: 0.23,
  duration_ms: 41000,
  ...over,
});

const card = (over: Partial<EvalDashboardCard>): EvalDashboardCard => ({
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  cases_total: 20,
  latest: batch({}),
  trend: [],
  ...over,
});

const DATA: EvalDashboardAll = {
  cards: [
    card({}),
    card({
      agent_id: "ag2",
      agent_name: "Performance Reviewer",
      model: "gpt-4o",
      cases_total: 18,
      latest: batch({
        batch_id: "b2",
        agent_id: "ag2",
        agent_name: "Performance Reviewer",
        agent_version: 4,
        cases: 18,
        passed: 13,
        recall: 0.74,
        precision: 0.88,
        citation_accuracy: 0.9,
      }),
    }),
  ],
  recent: [
    batch({}),
    batch({ batch_id: "b2", agent_name: "Performance Reviewer", agent_version: 4 }),
    batch({ batch_id: "b3", agent_version: 6, passed: 16 }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.runAllState = { isPending: false, data: undefined };
  hooks.useEvalDashboardAll.mockReturnValue({
    data: DATA,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

/** AC-53: one card per agent with cases, carrying every field the mockup names. */
describe("EvalDashboardView — the agent cards", () => {
  it("draws one card per agent with name, model, last batch and three metrics", () => {
    renderView();
    // Queried through the card's own accessible name, because the agent name
    // also appears in the batch table below — and the card is what is asserted.
    const card1 = screen.getByRole("button", { name: "Open Security Reviewer" });
    const card2 = screen.getByRole("button", { name: "Open Performance Reviewer" });

    expect(within(card1).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(card1).getByText("gpt-4.1")).toBeInTheDocument();
    expect(within(card2).getByText("gpt-4o")).toBeInTheDocument();

    // Version, date and passed-of-total in one line, the way the mockup has it.
    expect(within(card1).getByText(/Last run v7 · .* · 17\/20 pass/)).toBeInTheDocument();
    expect(within(card2).getByText(/Last run v4 · .* · 13\/18 pass/)).toBeInTheDocument();

    // The card's own three figures, not the table's.
    expect(card1.textContent).toContain("82%");
    expect(card1.textContent).toContain("91%");
    expect(card1.textContent).toContain("95%");
  });

  it("says an agent has never completed a batch instead of printing v0 · 0/0", () => {
    hooks.useEvalDashboardAll.mockReturnValue({
      data: { cards: [card({ latest: null, cases_total: 3 })], recent: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText("No completed run yet · 3 cases")).toBeInTheDocument();
    expect(screen.queryByText(/Last run/)).not.toBeInTheDocument();
  });

  it("opens that agent's own history when its card is pressed", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Open Performance Reviewer" }));
    expect(hooks.push).toHaveBeenCalledWith("/evals/ag2");
  });
});

/** AC-54: one row per batch — not per agent, and not per case. */
describe("EvalDashboardView — the all-agents batch table", () => {
  it("draws exactly one row per recent batch", () => {
    const { container } = renderView();
    const versions = [...container.querySelectorAll("span")]
      .map((n) => n.textContent)
      .filter((x) => x === "v7" || x === "v6" || x === "v4");
    // Three batches in `recent`; the cards above carry no version chip.
    expect(versions).toHaveLength(3);
  });

  it("says so when no batch has completed yet, rather than drawing an empty box", () => {
    hooks.useEvalDashboardAll.mockReturnValue({
      data: { cards: [card({})], recent: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
  });

  it("explains what to do when no agent has cases at all", () => {
    hooks.useEvalDashboardAll.mockReturnValue({
      data: { cards: [], recent: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText(/No agent has eval cases yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeDisabled();
  });
});

/**
 * AC-37. The agents that were skipped are the half a reader cannot infer from
 * the results, so they are named — a count would leave "which ones?" open.
 */
describe("EvalDashboardView — Run all agents", () => {
  it("names the skipped agents after the run", () => {
    hooks.runAllState = {
      isPending: false,
      data: {
        batches: [],
        skipped: [
          { agent_id: "ag3", agent_name: "Custom Mentor", reason: "no_cases" },
          { agent_id: "ag4", agent_name: "Docs Reviewer", reason: "no_cases" },
        ],
      },
    };
    renderView();
    expect(screen.getByRole("status").textContent).toContain("Custom Mentor, Docs Reviewer");
  });

  it("says every agent ran when none was skipped", () => {
    hooks.runAllState = { isPending: false, data: { batches: [], skipped: [] } };
    renderView();
    expect(screen.getByRole("status").textContent).toContain("Every agent with eval cases ran.");
  });

  it("blocks a second start while the first is still running", () => {
    hooks.runAllState = { isPending: true, data: undefined };
    renderView();
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
  });
});

/**
 * The whole body of the dashboard — cards, batch table, empty states — sits
 * behind the same branch, so a failed load with no error state is a blank page
 * carrying a live «Run all agents» button. The error state is what says the
 * figures are MISSING rather than zero, and Retry is the only way back without
 * a browser reload.
 */
describe("EvalDashboardView — the request failed", () => {
  it("says the dashboard could not load, draws no cards, and refetches on Retry", () => {
    const refetch = vi.fn();
    hooks.useEvalDashboardAll.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderView();

    expect(screen.getByRole("alert").textContent).toContain("Could not load the eval dashboard.");
    expect(
      screen.queryByRole("button", { name: "Open Security Reviewer" }),
    ).not.toBeInTheDocument();
    // "No agent has eval cases yet" is a claim about the data, and a failed
    // request supports no claim about the data at all.
    expect(screen.queryByText(/No agent has eval cases yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No runs yet/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

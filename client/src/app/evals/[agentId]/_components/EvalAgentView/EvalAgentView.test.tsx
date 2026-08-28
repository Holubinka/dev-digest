import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentDashboard, EvalBatchSummary } from "@/lib/types";
import messages from "../../../../../../messages/en/eval.json";

const hooks = vi.hoisted(() => ({
  useEvalAgentDashboard: vi.fn(),
  useEvalCompare: vi.fn(),
  runSet: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("@/lib/hooks/eval", () => ({
  useEvalAgentDashboard: hooks.useEvalAgentDashboard,
  useEvalCompare: hooks.useEvalCompare,
  useRunEvalSet: () => ({ mutate: hooks.runSet, isPending: false }),
  usePromoteAgentVersion: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: { id: "ag1", name: "Security Reviewer", model: "gpt-4.1" } }),
  useAgents: () => ({ data: [{ id: "ag1", name: "Security Reviewer" }] }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: hooks.replace, push: hooks.push }),
  useSearchParams: () => hooks.search,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalAgentView } from "./EvalAgentView";

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

const BATCHES = [
  batch({ batch_id: "b7", agent_version: 7, ran_at: "2026-05-29T09:14:00.000Z" }),
  batch({ batch_id: "b6", agent_version: 6, ran_at: "2026-05-27T16:40:00.000Z", passed: 16 }),
  batch({ batch_id: "b5", agent_version: 5, ran_at: "2026-05-25T11:02:00.000Z", passed: 16 }),
];

function dashboard(batches: EvalBatchSummary[], alert: string | null): EvalAgentDashboard {
  return {
    dashboard: {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 20,
      current: {
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        cost_usd: 0.23,
      },
      delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
      trend: batches.map((b) => ({
        ran_at: b.ran_at,
        recall: b.recall,
        precision: b.precision,
        citation_accuracy: b.citation_accuracy,
        pass_rate: b.passed / b.cases,
        cost_usd: b.cost_usd,
      })),
      recent_runs: [],
      alert,
    },
    batches,
  };
}

function mockDash(batches: EvalBatchSummary[], alert: string | null = "Precision dipped 2pts on v7") {
  hooks.useEvalAgentDashboard.mockReturnValue({
    data: dashboard(batches, alert),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.search = new URLSearchParams();
  hooks.useEvalCompare.mockReturnValue({ data: undefined, isLoading: true });
  mockDash(BATCHES);
});
afterEach(cleanup);

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalAgentView agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

const rowBoxes = () => screen.getAllByRole("checkbox");

/**
 * AC-59. "Exactly two" is the whole rule, and three is the case a naive
 * implementation gets wrong — «take the last two» is a guess about which two
 * the reader meant.
 */
describe("EvalAgentView — Compare is enabled at exactly two selected rows", () => {
  it("is disabled with nothing selected", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("is disabled with one selected", () => {
    renderView();
    fireEvent.click(rowBoxes()[0]!);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  it("is enabled with exactly two selected", () => {
    renderView();
    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();
  });

  it("is disabled again at three selected", () => {
    renderView();
    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);
    fireEvent.click(rowBoxes()[2]!);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  it("opens the comparison older→newer whatever order the rows were ticked", () => {
    renderView();
    // Tick the NEWER run first; the modal must still read v6 → v7.
    fireEvent.click(rowBoxes()[0]!);
    fireEvent.click(rowBoxes()[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(hooks.useEvalCompare).toHaveBeenCalledWith("b6", "b7");
  });
});

/**
 * `disabled={runSet.isPending || (dashboard?.cases_total ?? 0) === 0}` — the
 * button reads two independent reasons to be inert through one prop, and a
 * change to either half is invisible to `tsc`. This covers the half that is
 * not "a run is already in flight": an agent with no eval cases at all has
 * nothing for `useRunEvalSet` to run, so the button must not fire it.
 */
describe("EvalAgentView — Run eval is disabled when the agent has no cases", () => {
  it("is disabled at cases_total: 0", () => {
    const withoutCases = dashboard(BATCHES, null);
    withoutCases.dashboard.cases_total = 0;
    hooks.useEvalAgentDashboard.mockReturnValue({
      data: withoutCases,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    const btn = screen.getByRole("button", { name: "Run eval" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(hooks.runSet, "a disabled control must not start a batch").not.toHaveBeenCalled();
  });

  it("is enabled once the agent has at least one case", () => {
    mockDash(BATCHES); // cases_total: 20, from the shared fixture
    renderView();
    expect(screen.getByRole("button", { name: "Run eval" })).toBeEnabled();
  });
});

/**
 * AC-56. One batch has nothing to be a delta against, and a banner about a
 * change nobody can point at is worse than no banner.
 */
describe("EvalAgentView — below two completed batches", () => {
  it("shows neither a delta nor the banner on a single batch", () => {
    mockDash([BATCHES[0]!]);
    const { container } = renderView();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(container.textContent).not.toContain("0.04");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows neither on an agent with no completed batch at all", () => {
    mockDash([]);
    renderView();
    expect(screen.getByText("No completed runs in this range.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows both once a second batch exists", () => {
    mockDash(BATCHES.slice(0, 2));
    const { container } = renderView();
    expect(container.textContent).toContain("0.04");
    expect(screen.getByRole("status").textContent).toContain("Precision dipped 2pts on v7");
  });

  it("draws no banner when the server generated none, even with two batches", () => {
    mockDash(BATCHES, null);
    renderView();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

/** AC-55: the batch table carries a cost column the trend cannot show. */
describe("EvalAgentView — the batch table", () => {
  it("draws one row per batch, with its version, pass count and cost", () => {
    renderView();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
    // `formatCost` is the repo's shared rule and it scales precision to
    // magnitude — a sub-dollar run gets three decimals, so a $0.0004 batch does
    // not read as free. That is why the column says `$0.230` and not `$0.23`.
    expect(screen.getAllByText("$0.230")).toHaveLength(3);
  });
});

/**
 * AC-58 · C18. The range is URL state: the whole point is that the window a
 * reader is looking at survives a reload and can be handed to someone else.
 * One request carries it, so the chart and the table cannot disagree.
 */
describe("EvalAgentView — the date range", () => {
  it("labels every option in words, not as a message key", () => {
    // `eval.dashboard.range.30d` shipped as the visible option text once, with
    // lint, typecheck and `toHaveValue` all green — a missing key renders as its
    // own path, and only an assertion on the TEXT sees that.
    renderView();
    expect(screen.getByRole("option", { name: "7 days" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "30 days" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "90 days" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All time" })).toBeInTheDocument();
  });

  it("defaults to 30 days and writes the choice into the URL", () => {
    renderView();
    const select = screen.getByLabelText("Date range");
    expect(select).toHaveValue("30d");
    fireEvent.change(select, { target: { value: "7d" } });
    expect(hooks.replace).toHaveBeenCalledWith("/evals/ag1?range=7d");
  });

  it("reads the range back out of the URL", () => {
    hooks.search = new URLSearchParams("range=90d");
    renderView();
    expect(screen.getByLabelText("Date range")).toHaveValue("90d");
  });

  it("bounds the trend and the table with ONE request, so they cannot disagree", () => {
    hooks.search = new URLSearchParams("range=all");
    renderView();
    // `all` sends no `from`, and both halves of the screen read this one call.
    expect(hooks.useEvalAgentDashboard).toHaveBeenCalledWith("ag1", {});
    expect(hooks.useEvalAgentDashboard).toHaveBeenCalledTimes(1);
  });

  it("drops a selection that the new range may not contain", () => {
    renderView();
    fireEvent.click(rowBoxes()[0]!);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "7d" } });
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });
});

/**
 * A failed load returns EARLY here — the whole page is replaced, not just the
 * chart. That is the point worth pinning: the range select would bound a table
 * that is not there, and Compare would offer to diff two batches out of a list
 * the request never delivered.
 */
describe("EvalAgentView — the request failed", () => {
  it("replaces the history with a retryable error instead of an empty chart", () => {
    const refetch = vi.fn();
    hooks.useEvalAgentDashboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderView();

    // The body only. The ErrorState's `title` here is the BREADCRUMB label
    // («Eval Dashboard»), which is a finding about the copy rather than a
    // behaviour to pin — asserting it would give the wrong headline a green tick.
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load the eval dashboard.",
    );

    expect(screen.queryByRole("button", { name: "Compare" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date range")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run eval" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

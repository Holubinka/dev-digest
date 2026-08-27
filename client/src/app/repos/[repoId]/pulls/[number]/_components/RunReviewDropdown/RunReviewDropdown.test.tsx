import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/prReview.json";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const agents = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => agents,
}));

const create = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useCreateMultiAgentRun: () => create,
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

const SECURITY = {
  id: "a1",
  name: "Security",
  description: "Secrets, injection and auth mistakes.",
  model: "gpt-4.1",
  enabled: true,
};
const PERF = {
  id: "a2",
  name: "Performance",
  description: "N+1 queries and hot-path allocations.",
  model: "gpt-4.1",
  enabled: true,
};
const RETIRED = {
  id: "a3",
  name: "Legacy",
  description: "",
  model: "gpt-4o",
  enabled: false,
};

beforeEach(() => {
  agents.data = [SECURITY, PERF, RETIRED];
  create.mutateAsync.mockReset();
  create.mutateAsync.mockResolvedValue({
    id: "mr-1",
    pr_id: "pr1",
    runs: [
      { run_id: "run-1", agent_id: "a1", agent_name: "Security" },
      { run_id: "run-2", agent_id: "a2", agent_name: "Performance" },
    ],
    skipped: [],
  });
  push.mockReset();
});
afterEach(cleanup);

function renderPicker(props: Partial<React.ComponentProps<typeof RunReviewDropdown>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunReviewDropdown prId="pr1" {...props} />
    </NextIntlClientProvider>,
  );
}

function open() {
  fireEvent.click(screen.getByText("Run Review"));
}

describe("RunReviewDropdown — choosing the set of agents", () => {
  it("renders the trigger label", () => {
    renderPicker();
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  /**
   * The rule the old dropdown body already had and AC-8 keeps: EVERY agent is
   * listed, a disabled one is marked and can still be run — it simply is not
   * pre-ticked.
   */
  it("lists every agent, pre-ticks the enabled ones and marks the disabled one", () => {
    renderPicker();
    open();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  /**
   * AC-7 asks for the agent's description, and the human chose it over the
   * mockup's second line on 2026-08-26 — that line is a past run's summary, and
   * this card is drawn BEFORE anything runs. The model name is not shown at all
   * any more.
   */
  it("describes each agent with its description, not its model", () => {
    renderPicker();
    open();

    expect(screen.getByText("Secrets, injection and auth mistakes.")).toBeInTheDocument();
    expect(screen.getByText("N+1 queries and hot-path allocations.")).toBeInTheDocument();
    expect(screen.queryByText(/gpt-4/)).toBeNull();
  });

  it("gives every agent its own monogram tile, in that agent's colour", () => {
    renderPicker();
    open();

    const tiles = document.querySelectorAll("[data-agent-monogram]");
    expect([...tiles].map((el) => el.textContent)).toEqual(["S", "P", "L"]);
  });

  it("lets the disabled agent be chosen like any other", () => {
    renderPicker();
    open();

    fireEvent.click(screen.getAllByRole("checkbox")[2]!);
    expect(screen.getAllByRole("checkbox")[2]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Run multi-agent review (3)")).toBeInTheDocument();
  });

  it("labels the action by how many agents are chosen", () => {
    renderPicker();
    open();

    // Two enabled agents are pre-ticked.
    expect(screen.getByText("Run multi-agent review (2)")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("Run 1 agent")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    const cta = screen.getByText("Select agents");
    expect(cta).toBeInTheDocument();
    expect(cta.closest("button")).toBeDisabled();
  });

  it("starts ONE run with the chosen set and reports the multi-run up", async () => {
    const onRunStart = vi.fn();
    const onRunsStarted = vi.fn();
    renderPicker({ onRunStart, onRunsStarted });
    open();

    fireEvent.click(screen.getByText("Run multi-agent review (2)"));
    await vi.waitFor(() => expect(onRunsStarted).toHaveBeenCalled());

    expect(create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(create.mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(onRunStart).toHaveBeenCalledTimes(1);
    expect(onRunsStarted).toHaveBeenCalledWith({
      multiRunId: "mr-1",
      runIds: ["run-1", "run-2"],
    });
  });

  /**
   * A REFUSED run is toasted by the `MutationCache` in `lib/providers.tsx`, so
   * this component reports nothing of its own — but it must still hand the
   * rejection somewhere. `onClick` cannot await `kick`, so without the catch the
   * failure leaves the page as an unhandled promise rejection and the parent
   * never learns the request settled: its spinner would run forever.
   */
  it("stands the parent down when the run is refused, and lets nothing go unhandled", async () => {
    const unhandled: unknown[] = [];
    const collect = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", collect);
    create.mutateAsync.mockRejectedValue(new Error("no credit left"));

    const onRunsStarted = vi.fn();
    const onRunSettled = vi.fn();
    renderPicker({ onRunsStarted, onRunSettled });
    open();

    fireEvent.click(screen.getByText("Run multi-agent review (2)"));
    await vi.waitFor(() => expect(onRunSettled).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", collect);

    expect(unhandled).toEqual([]);
    expect(onRunsStarted).not.toHaveBeenCalled();
  });

  /** Kept verbatim from the old body: a merged PR is still reviewable, with a
      non-blocking warning and a dimmed trigger (AC-5). */
  it("keeps the merged warning and the dimmed trigger", () => {
    renderPicker({ warnMerged: true });
    expect(screen.getByTitle(messages.runReview.mergedTooltip)).toHaveStyle({ opacity: "0.6" });

    open();
    expect(screen.getByText("Already merged — review is informational")).toBeInTheDocument();
  });

  it("sends the reader to the agents screen when the workspace has none", () => {
    agents.data = [];
    renderPicker();
    open();

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByText("No agents yet — create one"));
    expect(push).toHaveBeenCalledWith("/agents");
  });
});

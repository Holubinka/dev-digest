import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runs from "@/../messages/en/runs.json";
import prReview from "@/../messages/en/prReview.json";
import type { AgentColumn, Conflict, MultiAgentRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/**
 * Three things are under test here and they are the ones no other file can see.
 *
 * AC-125 — the caption under a take and the header of THAT run's column have to
 * name the state with the same word. It is only observable with both on screen,
 * which is this component and nothing below it.
 *
 * AC-135 — a recompute that fails leaves the comparison and the not-final mark
 * where they were. TanStack keeps the previous `data` on a failed refetch, so
 * this passes by DEFAULT and breaks the moment someone adds `if (isError)` above
 * the render. That is exactly the kind of thing a test has to hold down.
 *
 * The URL — four keys, one `router.replace` per interaction. A per-key write
 * looks right in a snapshot of the final address and races in real use
 * (`client/INSIGHTS.md:585-592`).
 */

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(""),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.params,
}));

const hooks = vi.hoisted(() => ({
  useMultiAgentRun: vi.fn(),
  events: vi.fn(),
  rerun: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentRun: hooks.useMultiAgentRun,
  useMultiRunColumnEvents: (runIds: string[], cb?: (id: string) => void) => {
    hooks.events(runIds, cb);
    return {};
  },
  useRerunMultiAgentRun: () => hooks.rerun,
}));
vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: { status: "open", head_sha: "sha-now" } }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useCreatePrComment: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: null }),
}));
vi.mock("@/lib/repo-context", () => ({
  useRepoNotFound: () => false,
  // A real `owner/repo`, so the file references render as the github.com links
  // the page now builds rather than as the plain text it used to show.
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/payments-api" } }),
}));
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
// The drawer has its own tests; what matters here is that it is mounted for the
// run the URL names, with `running` taken from THAT column (AC-80, AC-82).
vi.mock("@/components/run-trace-drawer", () => ({
  default: ({ runId, running }: { runId: string; running: boolean }) => (
    <div data-testid="trace" data-run={runId} data-running={String(running)} />
  ),
}));

import { MultiRunView } from "./MultiRunView";

const column = (over: Partial<AgentColumn> & { run_id: string }): AgentColumn =>
  ({
    agent_id: over.run_id,
    agent_name: over.run_id,
    agent_deleted: false,
    provider: null,
    model: null,
    status: "done",
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [],
    ...over,
  }) as AgentColumn;

const position: Conflict = {
  file: "src/middleware/ratelimit.ts",
  start_line: 52,
  end_line: 52,
  title: "429 response shape",
  takes: [
    { run_id: "alive", agent_id: "alive", persona: "Alive", verdict: "WARNING", note: "shape" },
    { run_id: "broken", agent_id: "broken", persona: "Broken", verdict: "not_reviewed", note: null },
  ],
};

const multiRun = (over: Partial<MultiAgentRun> = {}): MultiAgentRun =>
  ({
    id: "mr-1",
    pr_id: "pr-1",
    pr_number: 482,
    pr_title: "Add rate limiting to public API endpoints",
    head_sha: "sha-now",
    ran_at: "2026-08-26T10:00:00.000Z",
    agent_count: 2,
    concurrency: 3,
    total_duration_ms: 8200,
    total_duration_kind: "measured",
    total_cost_usd: 0.11,
    total_cost_partial: false,
    columns: [column({ run_id: "alive" }), column({ run_id: "broken", status: "failed" })],
    conflicts: [position],
    ...over,
  }) as MultiAgentRun;

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs, prReview }}>
      <MultiRunView repoId="repo-1" multiRunId="mr-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.replace.mockReset();
  nav.push.mockReset();
  nav.params = new URLSearchParams("");
  hooks.useMultiAgentRun.mockReturnValue({
    data: multiRun(),
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

describe("MultiRunView", () => {
  it("names a failed run with the SAME word in its column header and in its take (AC-125)", () => {
    const { container } = renderView();

    const header = container.querySelector('[data-column-run="broken"]') as HTMLElement;
    const cell = container.querySelector('[data-take-run="broken"]') as HTMLElement;
    expect(header).toBeInstanceOf(HTMLElement);
    expect(cell).toBeInstanceOf(HTMLElement);

    // The header prints it inside a `state · time · cost` line, the take on its
    // own — so the assertion is that the WORD is the same one, from one map.
    expect(header.textContent).toContain("run failed");
    expect(within(cell).getByText("run failed")).toBeInTheDocument();
    expect(within(cell).queryByText("did not flag")).not.toBeInTheDocument();
  });

  it("keeps the comparison on screen when a recompute fails (AC-135)", () => {
    // The shape TanStack leaves behind: the previous data, plus an error.
    hooks.useMultiAgentRun.mockReturnValue({
      data: multiRun({
        columns: [column({ run_id: "alive" }), column({ run_id: "broken", status: "running" })],
      }),
      isError: true,
      error: new Error("network"),
      refetch: vi.fn(),
    });

    renderView();

    expect(screen.getByText("429 response shape")).toBeInTheDocument();
    expect(screen.getByText(runs.conflicts.notFinal)).toBeInTheDocument();
    expect(screen.queryByText(runs.page.loadFailed.title)).not.toBeInTheDocument();
  });

  it("shows a not-found state rather than an empty comparison (AC-95)", () => {
    hooks.useMultiAgentRun.mockReturnValue({
      data: undefined,
      isError: true,
      error: new ApiError("not found", 404, "not_found"),
      refetch: vi.fn(),
    });

    renderView();

    expect(screen.getByText(runs.page.notFound.title)).toBeInTheDocument();
    expect(screen.getByText(runs.page.notFound.body)).toBeInTheDocument();
  });

  it("writes the view mode with ONE router.replace, and drops it again on the default", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "tabs" }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/repos/repo-1/multi-agent/mr-1?view=tabs");

    nav.replace.mockReset();
    nav.params = new URLSearchParams("view=tabs");
    cleanup();
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "columns" }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/repos/repo-1/multi-agent/mr-1");
  });

  it("opens the trace of the run the URL names, live for a run that has not finished", () => {
    nav.params = new URLSearchParams("trace=broken");
    hooks.useMultiAgentRun.mockReturnValue({
      data: multiRun({
        columns: [column({ run_id: "alive" }), column({ run_id: "broken", status: "running" })],
      }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderView();

    const drawer = screen.getByTestId("trace");
    expect(drawer).toHaveAttribute("data-run", "broken");
    expect(drawer).toHaveAttribute("data-running", "true");
  });

  /* AC-145. A browser gives one origin six HTTP/1.1 connections and this page
     sends everything to the API, so a stream per run left columns 7-10 of a
     ten-agent run unconnected — and, never having connected, never closing, so
     the page never refetched after they finished. The hook caps the open ones at
     four; what this asserts is the other half of the rule, that a run which has
     already reached a terminal state is not offered a stream at all. */
  it("subscribes only to the runs that are still going (AC-145)", () => {
    hooks.events.mockClear();
    hooks.useMultiAgentRun.mockReturnValue({
      data: multiRun({
        columns: [
          column({ run_id: "alive", status: "running" }),
          column({ run_id: "waiting", status: "queued" }),
          column({ run_id: "broken", status: "failed" }),
          column({ run_id: "finished", status: "done" }),
        ],
      }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderView();

    expect(hooks.events).toHaveBeenCalled();
    expect(hooks.events.mock.calls[0]![0]).toEqual(["alive", "waiting"]);
  });

  it("prints the fan-out from `concurrency`, and never the mockup's worktrees", () => {
    renderView();

    expect(screen.getByText(/in-process fan-out, up to 3 at a time/)).toBeInTheDocument();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/p-queue/i)).not.toBeInTheDocument();
  });

  it("shows the chosen agent under Tabs and writes the choice to ?agent (AC-54, AC-84)", () => {
    nav.params = new URLSearchParams("view=tabs");
    hooks.useMultiAgentRun.mockReturnValue({
      data: multiRun({
        columns: [
          column({ run_id: "alive", summary: "Two exposures. Block." }),
          column({ run_id: "broken", status: "failed", summary: null }),
        ],
      }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderView();

    // No `?agent` yet: the first column of the multi-run is the one shown.
    expect(screen.getByText("Two exposures. Block.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /broken/ })[0]!);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(
      "/repos/repo-1/multi-agent/mr-1?view=tabs&agent=broken",
    );
  });

  it("renders the header of a run that left no summary without the line (AC-56)", () => {
    nav.params = new URLSearchParams("view=tabs&agent=broken");
    renderView();

    expect(screen.queryByText(runs.tabs.noSummary)).not.toBeInTheDocument();
    expect(screen.getByText(runs.column.noFindings)).toBeInTheDocument();
  });

  it("marks a partial total cost instead of printing it as a total (AC-42)", () => {
    hooks.useMultiAgentRun.mockReturnValue({
      data: multiRun({ total_cost_partial: true }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderView();

    expect(screen.getByText(/≥ \$0\.11/)).toBeInTheDocument();
  });
});

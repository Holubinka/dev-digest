import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: {
    system: "You are a reviewer.",
    pr_description: "Rate-limits the public pricing API.",
    intent: "Intent: rate-limit the public pricing API",
    skills: "### skill",
    memory: null,
    specs: null,
    user: "Review PR #482",
  },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  project_context: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// Hoisted so a test can swap in a live run (streaming SSE, no persisted trace
// yet) instead of the settled default.
const hooks = vi.hoisted(() => ({
  useRunTrace: vi.fn(),
  useRunEvents: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: hooks.useRunTrace,
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: hooks.useRunEvents,
}));

import RunTraceDrawer from "./RunTraceDrawer";

beforeEach(() => {
  hooks.useRunTrace.mockReset();
  hooks.useRunEvents.mockReset();
  // Default: a settled run whose trace has been persisted.
  hooks.useRunTrace.mockReturnValue({ data: TRACE, isLoading: false });
  hooks.useRunEvents.mockReturnValue({ events: [], running: false });
});

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("reports what the run cost alongside duration, tokens and findings", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.060")).toBeInTheDocument();
  });

  /**
   * `PromptAssembly` has nine fields and this section rendered seven: the PR
   * description and the derived intent were both dropped, so the intent that
   * really went into the prompt was invisible in the UI while sitting in
   * `run_traces.trace.prompt_assembly.intent` all along.
   */
  it("shows every prompt leg that the trace carries, in assembly order", () => {
    const { container } = renderWithIntl(
      <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText(messages.trace.promptAssembly));

    expect(screen.getByText(messages.trace.prompt.prDescription)).toBeInTheDocument();
    expect(screen.getByText(messages.trace.prompt.intent)).toBeInTheDocument();

    // Description, then intent, then skills — the order `assemblePrompt` uses.
    const text = container.textContent ?? "";
    expect(text.indexOf(messages.trace.prompt.prDescription)).toBeGreaterThan(
      text.indexOf(messages.trace.prompt.system),
    );
    expect(text.indexOf(messages.trace.prompt.intent)).toBeGreaterThan(
      text.indexOf(messages.trace.prompt.prDescription),
    );
    expect(text.indexOf(messages.trace.prompt.skills)).toBeGreaterThan(
      text.indexOf(messages.trace.prompt.intent),
    );
  });

  /** A run with no derived intent shows no intent block — not an empty one. */
  it("omits both blocks when the trace has neither", () => {
    hooks.useRunTrace.mockReturnValue({
      data: { ...TRACE, prompt_assembly: { ...TRACE.prompt_assembly, pr_description: null, intent: null } },
      isLoading: false,
    });
    renderWithIntl(
      <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText(messages.trace.promptAssembly));

    expect(screen.queryByText(messages.trace.prompt.prDescription)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.trace.prompt.intent)).not.toBeInTheDocument();
    expect(screen.getByText(messages.trace.prompt.system)).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

/**
 * The PR-detail page used to mount this drawer without `running`, so the prop
 * sat at its `false` default: the SSE subscription was never opened, the drawer
 * opened on an empty Trace tab, and "Open run trace" on a live run showed
 * nothing at all. These cases pin the live path.
 */
describe("A5 Run Trace drawer while the run is still going", () => {
  const live = () => {
    hooks.useRunEvents.mockReturnValue({
      events: [{ t: "00.10", kind: "info", msg: "Starting review with agent Security" }],
      running: true,
    });
    // The trace does not exist yet; the hook is disabled, and a disabled
    // TanStack query reports isLoading === false, not true.
    hooks.useRunTrace.mockReturnValue({ data: undefined, isLoading: false });
  };

  it("opens on the live log and streams, without being clicked there", () => {
    live();
    renderWithIntl(
      <RunTraceDrawer runId="r1" running agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
    expect(screen.getByText(/Starting review with agent Security/)).toBeInTheDocument();
  });

  it("subscribes to this run's events and holds off on the trace request", () => {
    live();
    renderWithIntl(
      <RunTraceDrawer runId="r1" running agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    expect(hooks.useRunEvents).toHaveBeenCalledWith(["r1"]);
    // second arg is `enabled` — false while the run is live
    expect(hooks.useRunTrace).toHaveBeenCalledWith("r1", false);
  });

  it("tells the reader on the Trace tab that the trace comes at the end", () => {
    live();
    renderWithIntl(
      <RunTraceDrawer runId="r1" running agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("trace"));
    expect(
      screen.getByText("Trace is written when the run completes — see the Live log tab."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No trace available yet.")).not.toBeInTheDocument();
  });

  it("keeps the streamed lines after the run settles, before the trace lands", () => {
    // The run finished, so the page's next poll tick drops it out of
    // `liveRunIds` and `running` arrives false — but the persisted trace is not
    // written yet. The lines we already streamed are all there is to show, and
    // `useRunEvents` still holds them (it does not clear `events` when handed
    // an empty id list). Keying the pane off `running` blanked it right here.
    hooks.useRunEvents.mockReturnValue({
      events: [{ t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" }],
      running: false,
    });
    hooks.useRunTrace.mockReturnValue({ data: undefined, isLoading: true });
    renderWithIntl(
      <RunTraceDrawer runId="r1" running={false} agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("log"));
    expect(screen.getByText(/Citation grounding: 2\/2 passed/)).toBeInTheDocument();
  });

  it("does not subscribe at all for a historical run", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(hooks.useRunEvents).toHaveBeenCalledWith([]);
    expect(hooks.useRunTrace).toHaveBeenCalledWith("r1", true);
  });
});

/**
 * The drawer accounts for a SENT document twice already — its path under
 * `Specs read`, its text under `Prompt assembly`. Listing it a third time was
 * noise that buried the only rows this section exists for: the documents the run
 * was given and did not send, which neither of the other two can show.
 */
describe("Run Trace drawer — project context documents that did not reach the prompt", () => {
  beforeEach(() => {
    hooks.useRunEvents.mockReturnValue({ events: [], running: false });
  });

  it("shows no such section when every document was sent", () => {
    hooks.useRunTrace.mockReturnValue({
      data: {
        ...TRACE,
        specs_read: ["specs/a.md"],
        project_context: [{ path: "specs/a.md", tokens: 155, status: "included" }],
      },
      isLoading: false,
    });
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.queryByText(/did not reach the prompt/)).toBeNull();
    // It is still accounted for, in the place that says what was sent.
    expect(screen.getByText("specs/a.md")).toBeInTheDocument();
  });

  it("shows only the documents that were not sent, and says why for each", () => {
    hooks.useRunTrace.mockReturnValue({
      data: {
        ...TRACE,
        specs_read: ["specs/sent.md"],
        project_context: [
          { path: "specs/sent.md", tokens: 100, status: "included" },
          { path: "specs/over.md", tokens: 9000, status: "dropped" },
          { path: "specs/gone.md", tokens: 0, status: "missing" },
        ],
      },
      isLoading: false,
    });
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText(/did not reach the prompt/)).toBeInTheDocument();
    expect(screen.getByText("specs/over.md")).toBeInTheDocument();
    expect(screen.getByText("dropped (over budget)")).toBeInTheDocument();
    expect(screen.getByText("specs/gone.md")).toBeInTheDocument();
    expect(screen.getByText("missing from the clone")).toBeInTheDocument();
    // The sent one keeps its single row under Specs read, and gains none here.
    expect(screen.getAllByText("specs/sent.md")).toHaveLength(1);
  });
});

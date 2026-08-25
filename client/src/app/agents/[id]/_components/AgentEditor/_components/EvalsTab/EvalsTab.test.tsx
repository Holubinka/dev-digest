import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalAgentDashboard, EvalCaseRow, EvalCaseSet } from "@/lib/types";
import messages from "../../../../../../../../messages/en/eval.json";

const hooks = vi.hoisted(() => ({
  useEvalCaseSet: vi.fn(),
  useEvalAgentDashboard: vi.fn(),
  useEvalCase: vi.fn(),
  runSet: vi.fn(),
  runCase: vi.fn(),
  del: vi.fn(),
  runSetPending: false,
  push: vi.fn(),
  replace: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseSet: hooks.useEvalCaseSet,
  useEvalAgentDashboard: hooks.useEvalAgentDashboard,
  useEvalCase: hooks.useEvalCase,
  useRunEvalSet: () => ({ mutate: hooks.runSet, isPending: hooks.runSetPending }),
  useRunEvalCase: () => ({ mutate: hooks.runCase, isPending: false, variables: undefined }),
  useDeleteEvalCase: () => ({ mutate: hooks.del, isPending: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hooks.push, replace: hooks.replace }),
  useSearchParams: () => hooks.search,
}));

import { EvalsTab } from "./EvalsTab";

const AGENT = { id: "ag1", name: "Security Reviewer" } as Agent;

const row = (over: Partial<EvalCaseRow>): EvalCaseRow => ({
  id: "c1",
  name: "stripe-key-leak",
  owner_kind: "agent",
  owner_id: "ag1",
  notes: null,
  expected_count: 1,
  last_run: null,
  ...over,
});

const PASSED = row({
  id: "c1",
  name: "stripe-key-leak",
  last_run: {
    ran_at: "2026-05-29T09:14:00.000Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    findings_count: 1,
    skills: [{ id: "s1", name: "Attack surface inventory" }],
  },
});
const FAILED = row({
  id: "c2",
  name: "missing-retry-after",
  last_run: {
    ran_at: "2026-05-29T09:14:00.000Z",
    pass: false,
    recall: 0,
    precision: 1,
    citation_accuracy: 1,
    findings_count: 0,
    skills: [],
  },
});
const NEVER = row({ id: "c3", name: "service-role-in-client", last_run: null });

const SET: EvalCaseSet = { cases: [PASSED, FAILED, NEVER], passing: 3, total: 5 };

const DASH: EvalAgentDashboard = {
  dashboard: {
    owner_kind: "agent",
    owner_id: "ag1",
    cases_total: 5,
    current: {
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.95,
      traces_passed: 17,
      traces_total: 20,
      cost_usd: 0.23,
    },
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    trend: [],
    recent_runs: [],
    alert: null,
  },
  batches: [],
};

function mockAll(over: { set?: Partial<EvalCaseSet> | null; batches?: number } = {}) {
  hooks.useEvalCaseSet.mockReturnValue({
    data: over.set === null ? { cases: [], passing: 0, total: 0 } : { ...SET, ...over.set },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  hooks.useEvalAgentDashboard.mockReturnValue({
    data: {
      ...DASH,
      batches: Array.from({ length: over.batches ?? 0 }, () => ({}) as never),
    },
    isLoading: false,
  });
  hooks.useEvalCase.mockReturnValue({ data: undefined, isLoading: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.runSetPending = false;
  hooks.search = new URLSearchParams();
  mockAll();
});
afterEach(cleanup);

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

/**
 * AC-14: three states, not two. A case nobody has run has said nothing about
 * the agent; rendering it as "failed" would put a red mark next to work that was
 * never done, and rendering it as passing would inflate the badge.
 */
describe("EvalsTab — the three last-run states", () => {
  it("marks a passing case, a failing case and a never-run case differently", () => {
    renderTab();
    expect(screen.getByLabelText("passed")).toBeInTheDocument();
    expect(screen.getByLabelText("failed")).toBeInTheDocument();
    expect(screen.getByLabelText("never run")).toBeInTheDocument();
  });

  it("gives a run case its expected-vs-got counts and a never-run case the words", () => {
    renderTab();
    // AC-15 — the two numbers a reader needs to know what went wrong.
    expect(screen.getByText("expected 1 finding, got 1")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 0")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("names the skills active on a run that had any, and says nothing for a run with none", () => {
    // D4: skill binding does not bump the agent version, so this line is the
    // only record of which skills shaped a given pass/fail — but an empty
    // array must render as silence, not as an empty "skills: " line.
    renderTab();
    expect(screen.getByText("skills: Attack surface inventory")).toBeInTheDocument();
    expect(screen.queryByText(/^skills: $/)).not.toBeInTheDocument();
  });
});

describe("EvalsTab — the set heading", () => {
  it("badges N of M passing, where M is the whole set and not the rows drawn", () => {
    // AC-17. `passing`/`total` are the server's, deliberately not counted from
    // `cases`: a filtered or paged list would silently change the badge.
    renderTab();
    expect(screen.getByText("3 / 5 passing")).toBeInTheDocument();
  });

  it("explains how to make the first case instead of drawing an empty list", () => {
    // AC-16.
    mockAll({ set: null });
    renderTab();
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
    expect(screen.getByText(/Turn into eval case/)).toBeInTheDocument();
  });
});

describe("EvalsTab — running the set", () => {
  it("runs the whole set and says so while it runs, refusing a second start", () => {
    // AC-35: the request is synchronous for the batch's whole duration, so the
    // launching screen must show that and must not offer to start it again.
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(hooks.runSet).toHaveBeenCalledTimes(1);

    cleanup();
    hooks.runSetPending = true;
    renderTab();
    const busy = screen.getByRole("button", { name: "Running the set…" });
    expect(busy).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run all evals" })).not.toBeInTheDocument();
  });

  it("will not start a run for a set with no cases at all", () => {
    mockAll({ set: null });
    renderTab();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });
});

/**
 * AC-56. A delta is the difference between two batches, so one batch has no
 * delta to state — and stating one anyway (against zero, say) invents a
 * regression or an improvement that never happened.
 */
describe("EvalsTab — deltas below two completed batches", () => {
  it("shows the four figures without a delta when only one batch exists", () => {
    mockAll({ batches: 1 });
    const { container } = renderTab();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
    expect(container.textContent).not.toContain("0.04");
  });

  it("shows them once two batches can be subtracted", () => {
    mockAll({ batches: 2 });
    const { container } = renderTab();
    expect(container.textContent).toContain("0.04");
    expect(container.textContent).toContain("0.02");
  });
});

describe("EvalsTab — the case set links out", () => {
  it("offers the full dashboard for this agent, not the all-agents one", () => {
    // AC-66: the tab is a summary, and the link is how the reader reaches the
    // history it summarises.
    renderTab();
    const link = screen.getByRole("link", { name: "View full dashboard →" });
    expect(link).toHaveAttribute("href", "/evals/ag1");
  });

  it("runs one case from its own row", () => {
    // The control is named after the case it acts on, so three identical play
    // icons stay distinguishable to a screen reader — and to this assertion.
    renderTab();
    fireEvent.click(screen.getByLabelText("Run missing-retry-after"));
    expect(hooks.runCase).toHaveBeenCalledWith("c2");
  });
});

/**
 * The «Turn into eval case» button on a PR finding navigates here with
 * `?case=<id>`, and landing ON that case is the second half of AC-10 — the
 * first half (no duplicate row) is the server's.
 */
describe("EvalsTab — arriving with ?case=", () => {
  it("opens the editor on the case the URL names", () => {
    hooks.search = new URLSearchParams("tab=evals&case=c1");
    hooks.useEvalCase.mockReturnValue({
      data: {
        id: "c1",
        owner_kind: "agent",
        owner_id: "ag1",
        name: "stripe-key-leak",
        input_diff: "",
        input_files: [],
        input_meta: null,
        expected_output: [],
        notes: null,
      },
      isLoading: false,
    });
    renderTab();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Eval case · stripe-key-leak")).toBeInTheDocument();
  });
});

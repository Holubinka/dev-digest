import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchSummary, EvalCompare } from "@/lib/types";
import messages from "../../../../../../messages/en/eval.json";

const hooks = vi.hoisted(() => ({
  useEvalCompare: vi.fn(),
  promote: vi.fn(),
  promoteState: { isPending: false, isSuccess: false },
}));

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: hooks.useEvalCompare,
  usePromoteAgentVersion: () => ({
    mutate: hooks.promote,
    isPending: hooks.promoteState.isPending,
    isSuccess: hooks.promoteState.isSuccess,
  }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

const batch = (over: Partial<EvalBatchSummary>): EvalBatchSummary => ({
  batch_id: "b6",
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  agent_version: 6,
  ran_at: "2026-05-27T16:40:00.000Z",
  cases: 20,
  passed: 16,
  errored: 0,
  recall: 0.78,
  precision: 0.93,
  citation_accuracy: 0.94,
  cost_usd: 0.21,
  duration_ms: 40000,
  ...over,
});

const B = batch({
  batch_id: "b7",
  agent_version: 7,
  ran_at: "2026-05-29T09:14:00.000Z",
  passed: 17,
  recall: 0.82,
  precision: 0.91,
  citation_accuracy: 0.95,
  cost_usd: 0.23,
});

const PROMPT_B = [
  "You are a security-focused PR reviewer.",
  "Return at most 5 findings ranked by severity.",
  "Flag unused imports as suggestions.",
  "Every finding MUST cite file and start_line-end_line inside the diff hunks.",
].join("\n");

function compare(over: Partial<EvalCompare> = {}): EvalCompare {
  return {
    a: batch({}),
    b: B,
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01, cost_usd: 0.02 },
    prompt: {
      changed: true,
      a_version: 6,
      b_version: 7,
      a_text: "You are a security-focused PR reviewer.",
      b_text: PROMPT_B,
      changed_lines: [3],
    },
    like_for_like: true,
    case_diff: { only_in_a: [], only_in_b: [] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.promoteState = { isPending: false, isSuccess: false };
  hooks.useEvalCompare.mockReturnValue({ data: compare(), isLoading: false });
});
afterEach(cleanup);

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <CompareRunsModal agentId="ag1" batchA="b6" batchB="b7" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

/** AC-60: four old→new values, each with its delta. */
describe("CompareRunsModal — the four tiles", () => {
  it("shows recall, precision, citation and cost as old → new with a delta", () => {
    const { container } = renderModal();
    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();

    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("93%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("$0.210")).toBeInTheDocument();
    expect(screen.getByText("$0.230")).toBeInTheDocument();

    // Metric deltas read in percentage POINTS, the way both mockups print them.
    expect(container.textContent).toContain("4pt");
    expect(container.textContent).toContain("2pt");
    expect(container.textContent).toContain("1pt");
  });
});

/** AC-61: the full prompt, with ONLY the changed lines highlighted. */
describe("CompareRunsModal — different agent versions", () => {
  it("prints the whole system prompt and highlights only the changed lines", () => {
    const { container } = renderModal();
    expect(screen.getByText("v6 (old)")).toBeInTheDocument();
    expect(screen.getByText("v7 (new)")).toBeInTheDocument();

    // Every line of the new prompt is rendered — AC-61 asks for the FULL text,
    // not just the hunk around the change.
    expect(container.querySelectorAll("[data-prompt-line]")).toHaveLength(4);
    const marked = container.querySelectorAll("[data-changed='true']");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toBe("Flag unused imports as suggestions.");
  });

  it("highlights nothing when the server reported no changed lines", () => {
    hooks.useEvalCompare.mockReturnValue({
      data: compare({
        prompt: { ...compare().prompt, changed_lines: [] },
      }),
      isLoading: false,
    });
    const { container } = renderModal();
    expect(container.querySelectorAll("[data-changed='true']")).toHaveLength(0);
  });
});

/**
 * AC-62. Two batches on one version is the ordinary case where only the linked
 * skills moved (spec D4), so the modal says the prompt is the same AND keeps
 * the deltas — dropping them would leave the reader with no answer at all.
 */
describe("CompareRunsModal — the same agent version", () => {
  it("says the prompt did not change and still shows the metric deltas", () => {
    hooks.useEvalCompare.mockReturnValue({
      data: compare({
        prompt: {
          changed: false,
          a_version: 7,
          b_version: 7,
          a_text: PROMPT_B,
          b_text: PROMPT_B,
          changed_lines: [],
        },
      }),
      isLoading: false,
    });
    const view = renderModal();
    expect(screen.getByText(/the system prompt did not change/)).toBeInTheDocument();
    expect(view.container.querySelectorAll("[data-changed='true']")).toHaveLength(0);
    // The deltas are still the answer to "what did change".
    expect(view.container.textContent).toContain("4pt");
    expect(screen.getByText("82%")).toBeInTheDocument();
  });
});

/** AC-63: different case sets means different denominators. */
describe("CompareRunsModal — different case sets", () => {
  it("warns that the comparison is not like-for-like, with both counts", () => {
    hooks.useEvalCompare.mockReturnValue({
      data: compare({
        like_for_like: false,
        case_diff: { only_in_a: ["c1", "c2"], only_in_b: ["c9"] },
      }),
      isLoading: false,
    });
    renderModal();
    const warn = screen.getByRole("status");
    expect(warn.textContent).toContain("Not like-for-like");
    expect(warn.textContent).toContain("2 only in the older run");
    expect(warn.textContent).toContain("1 only in the newer");
  });

  it("shows no warning when both runs covered the same set", () => {
    renderModal();
    expect(screen.queryByText(/Not like-for-like/)).not.toBeInTheDocument();
  });
});

/**
 * AC-64/AC-65. Promote applies the NEWER version's snapshot through the
 * ordinary agent update, which creates a new version and leaves the promoted
 * version's own history row alone. There is no promote route, and this is why.
 */
describe("CompareRunsModal — Promote", () => {
  it("promotes the newer of the two versions", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Promote v7" }));
    expect(hooks.promote).toHaveBeenCalledWith({ agentId: "ag1", version: 7 });
  });

  it("says what promoting did once it succeeded", () => {
    hooks.promoteState = { isPending: false, isSuccess: true };
    renderModal();
    expect(screen.getByText(/v7 applied/)).toBeInTheDocument();
  });
});

/**
 * FindingsTab — the multi-run keyboard regression.
 *
 * `FindingsPanel` binds j/k/a/d to `window`, and `ReviewRunAccordion` opens
 * itself whenever a severity filter is active. Both behaviours are deliberate;
 * together they meant every open run mounted its own listener, so a single `a`
 * accepted one finding per run — each a *different* finding, since every panel
 * tracks its own focus index. FindingsTab now nominates exactly one active run.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "@/../messages/en/prReview.json";

const mutate = vi.hoisted(() => vi.fn());

// One factory covers the whole subtree: FindingsPanel and ReviewRunAccordion
// both import this module (through different relative depths that resolve to
// the same file).
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useRunEvents: () => ({ events: [], running: false }),
}));
// `FindingsPanel` also owns «Turn into eval case», which lands on the owning
// agent's Evals tab — so it reads the router, and jsdom has no App Router.
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalCaseFromFinding: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { FindingsTab } from "./FindingsTab";

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

/** ReviewRunAccordion ids its root by run_id — the agent name is ambiguous,
 *  because the timeline above renders it too. */
function accordion(reviewId: string): HTMLElement {
  const el = document.getElementById(`review-run-run-${reviewId}`);
  if (!el) throw new Error(`no accordion rendered for ${reviewId}`);
  return el;
}

function finding(id: string, reviewId: string): FindingRecord {
  return {
    id,
    severity: "CRITICAL",
    category: "security",
    title: `Finding ${id}`,
    file: "src/config.ts",
    start_line: 1,
    end_line: 1,
    rationale: "…",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: reviewId,
    accepted_at: null,
    dismissed_at: null,
  };
}

function review(id: string, findingIds: string[]): ReviewRecord {
  return {
    id,
    run_id: `run-${id}`,
    agent_name: `Agent ${id}`,
    verdict: "request_changes",
    summary: "…",
    score: 70,
    created_at: "2026-06-11T18:44:34.000Z",
    findings: findingIds.map((f) => finding(f, id)),
  } as ReviewRecord;
}

const REVIEWS = [review("rev-a", ["a1", "a2"]), review("rev-b", ["b1", "b2"])];

function renderTab(props: Partial<React.ComponentProps<typeof FindingsTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={REVIEWS}
        prRuns={undefined}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false }}
        severity={null}
        onSeverityChange={() => {}}
        onOpenTrace={() => {}}
        onDelete={() => {}}
        onRunDone={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTab keyboard shortcuts across several open runs", () => {
  it("accepts exactly one finding when every accordion is forced open", () => {
    // A severity filter opens all of them — this is the shape of the bug.
    renderTab({ severity: "CRITICAL" });
    expect(document.querySelectorAll("[data-finding-id]").length).toBeGreaterThan(2);

    fireEvent.keyDown(window, { key: "a" });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "a1", action: "accept", prId: "pr1" });
  });

  it("moves focus in one run only, so j then a stay on the same list", () => {
    renderTab({ severity: "CRITICAL" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "a2", action: "accept", prId: "pr1" });
  });

  it("hands the shortcuts to the run the reader interacts with", () => {
    renderTab({ severity: "CRITICAL" });
    // The agent name also appears in the timeline above, so target the
    // accordion itself — ReviewRunAccordion ids its root by run_id.
    fireEvent.pointerDown(accordion("rev-b"));
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "b1", action: "accept", prId: "pr1" });
  });

  it("marks a single run as the one the keys drive", () => {
    renderTab({ severity: "CRITICAL" });
    expect(screen.getAllByText("j/k to move · a accept · d dismiss")).toHaveLength(1);
  });

  it("falls back to the first shown run when the filter drops the active one", () => {
    const { rerender } = renderTab({ severity: null });
    // Make the second run active, then filter it away entirely.
    fireEvent.pointerDown(accordion("rev-b"));
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsTab
          prId="pr1"
          liveRunIds={[]}
          reviewRunning={false}
          lethalTrifecta={[]}
          runs={[REVIEWS[0]!]}
          prRuns={undefined}
          prCommits={[]}
          cancelMutation={{ mutate: vi.fn(), isPending: false }}
          severity="CRITICAL"
          onSeverityChange={() => {}}
          onOpenTrace={() => {}}
          onDelete={() => {}}
          onRunDone={() => {}}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "a1", action: "accept", prId: "pr1" });
  });
});

/**
 * The far end of a Smart Diff severity chip. `client/INSIGHTS.md` names three
 * obligations for that jump; `FindingsPanel.test.tsx` covers two of them (the
 * card expands, hide-low lifts). This is the third: the run holding the target
 * has to open, or the reader lands on a closed accordion with nothing to see.
 */
describe("FindingsTab cross-tab jump to a finding", () => {
  // FindingsPanel scrolls the card it reveals, and jsdom has no scrollIntoView.
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("leaves a second run collapsed when nothing targets it", () => {
    // The baseline the next test moves: only the first run opens by default.
    renderTab();
    expect(document.querySelector('[data-finding-id="b1"]')).toBeNull();
  });

  it("opens the run that holds the targeted finding", () => {
    renderTab({ targetFindingId: "b1" });
    expect(document.querySelector('[data-finding-id="b1"]')).not.toBeNull();
  });

  it("leaves the other runs' default state alone", () => {
    // Targeting the second run must not collapse the first, which is open
    // because it is first — two separate reasons to be open.
    renderTab({ targetFindingId: "b1" });
    expect(document.querySelector('[data-finding-id="a1"]')).not.toBeNull();
  });

  it("opens nothing when the id belongs to no run on this PR", () => {
    renderTab({ targetFindingId: "not-here" });
    expect(document.querySelector('[data-finding-id="b1"]')).toBeNull();
  });
});

/**
 * The non-blocking link to this PR's multi-agent comparison (AC-88/AC-89, R54).
 * It sits ABOVE the live-run section and outside it: the comparison it points at
 * may be from yesterday, when there is no live run for it to sit beside.
 */
describe("FindingsTab — the multi-agent comparison link", () => {
  it("renders the link the page resolved, above the live run", () => {
    renderTab({ multiRunHref: "/repos/repo-1/multi-agent/mr-1", liveRunIds: ["run-x"] });

    const link = screen.getByRole("link", { name: /multi-agent comparison/i });
    expect(link).toHaveAttribute("href", "/repos/repo-1/multi-agent/mr-1");

    const live = screen.getByText("Live review");
    expect(link.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still renders it when nothing is running — that is the reload case", () => {
    renderTab({ multiRunHref: "/repos/repo-1/multi-agent/mr-1", liveRunIds: [] });
    expect(screen.getByRole("link", { name: /multi-agent comparison/i })).toBeInTheDocument();
  });

  it("renders nothing when the PR has no comparison", () => {
    renderTab();
    expect(screen.queryByRole("link", { name: /multi-agent comparison/i })).toBeNull();
  });
});

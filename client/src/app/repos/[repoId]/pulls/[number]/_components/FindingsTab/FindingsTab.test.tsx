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

import { describe, it, expect, afterEach, vi } from "vitest";
import { render as rtlRender, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";
import brief from "../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

const reviews = vi.hoisted(() => ({ data: undefined as ReviewRecord[] | undefined }));
const runs = vi.hoisted(() => ({ data: undefined as RunSummary[] | undefined }));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => reviews,
  usePrRuns: () => runs,
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(cleanup);

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    kind: "review",
    verdict: "request_changes",
    summary: "A Stripe key is committed in plaintext.",
    score: 61,
    model: "gpt",
    agent_name: "Security",
    created_at: "2026-08-07T09:00:00Z",
    findings: [],
    ...over,
  } as ReviewRecord;
}

const FINDINGS = [
  { id: "f1", severity: "CRITICAL", dismissed_at: null },
  { id: "f2", severity: "CRITICAL", dismissed_at: null },
  { id: "f3", severity: "WARNING", dismissed_at: null },
  // Dismissed criticals are not blockers any more.
  { id: "f4", severity: "CRITICAL", dismissed_at: "2026-08-07T00:00:00Z" },
] as ReviewRecord["findings"];

// The two hooks are mocked, so no QueryClient is needed — only the namespaces
// PrBriefCard (`brief`) and VerdictBanner (`prReview`) each read.
function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PrBriefCard", () => {
  it("shows the empty state before any review has run", () => {
    reviews.data = [];
    runs.data = [];
    render(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a review or open the PR to compute it.")).toBeInTheDocument();
  });

  it("renders the latest review's verdict, counts and score", () => {
    reviews.data = [review({ findings: FINDINGS })];
    runs.data = [
      {
        run_id: "run1",
        cost_usd: 0.014,
        tokens_in: 8200,
        tokens_out: 1300,
        blockers: 2,
      } as RunSummary,
    ];
    render(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("A Stripe key is committed in plaintext.")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText(/4 findings/)).toBeInTheDocument();
    // From RunSummary.blockers — the agent's own ciFailOn count. Deliberately
    // NOT the 2 undismissed CRITICALs in FINDINGS: the two numbers agree here by
    // construction, so the fixture sets blockers to 3 in the next test to prove
    // which one is read.
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("reads blockers off the run, never recomputed from findings", () => {
    // 2 undismissed CRITICALs but the run's gate counted 3 — INSIGHTS.md
    // §blockers: it is ciFailOn, not a severity bucket, so it cannot be derived.
    reviews.data = [review({ findings: FINDINGS })];
    runs.data = [{ run_id: "run1", blockers: 3 } as RunSummary];
    render(<PrBriefCard prId="pr1" />);
    expect(screen.getByText(/3 blockers/)).toBeInTheDocument();
  });

  it("takes the newest review, not the first one it finds", () => {
    reviews.data = [
      review({ id: "new", summary: "Newest.", score: 90 }),
      review({ id: "old", summary: "Oldest.", score: 10 }),
    ];
    runs.data = [];
    render(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("Newest.")).toBeInTheDocument();
    expect(screen.queryByText("Oldest.")).not.toBeInTheDocument();
  });

  it("skips a summary row, which carries no verdict", () => {
    reviews.data = [
      review({ id: "s", kind: "summary", verdict: null, summary: "Just a summary." }),
      review({ id: "r", summary: "The real verdict." }),
    ];
    runs.data = [];
    render(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("The real verdict.")).toBeInTheDocument();
  });
});

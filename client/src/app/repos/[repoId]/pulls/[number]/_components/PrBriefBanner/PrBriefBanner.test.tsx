import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefRecord } from "@/lib/types";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import brief from "@/../messages/en/brief.json";
import prReview from "@/../messages/en/prReview.json";
import { PrBriefBanner } from "./PrBriefBanner";
import {
  byNewestThenId,
  hasReviewForOtherState,
  pickReviewForHead,
  reviewHead,
  reviewsForHead,
} from "./helpers";

afterEach(cleanup);

const HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const OLD_HEAD = "0000111122223333444455556666777788889999";
const INDEX = "1122334455667788990011223344556677889900";

const finding = (id: string, severity = "CRITICAL"): FindingRecord =>
  ({ id, severity, dismissed_at: null, review_id: "rev-1" }) as unknown as FindingRecord;

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "Security",
    head_sha: HEAD,
    kind: "review",
    verdict: "request_changes",
    summary:
      "Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.",
    score: 61,
    model: "gpt-4.1",
    grounding: null,
    created_at: "2026-08-16T09:00:00.000Z",
    // Six findings, five of them CRITICAL and undismissed — so a CLIENT recount
    // would say five blockers while the run below stored two.
    findings: [
      finding("f1"),
      finding("f2"),
      finding("f3"),
      finding("f4"),
      finding("f5"),
      finding("f6", "WARNING"),
    ],
    ...over,
  };
}

const RUN: RunSummary = {
  run_id: "run-1",
  agent_id: "agent-1",
  agent_name: "Security",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  duration_ms: 41_000,
  tokens_in: 8200,
  tokens_out: 1300,
  cost_usd: 0.014,
  findings_count: 6,
  grounding: null,
  ran_at: "2026-08-16T09:00:00.000Z",
  score: 61,
  blockers: 2,
};

function record(over: Partial<RiskBriefRecord> = {}): RiskBriefRecord {
  return {
    what: "Adds rate limiting to the public API endpoints.",
    why: "Unauthenticated clients can exhaust the pricing API today.",
    risk_level: "high",
    risks: [],
    review_focus: [],
    head_sha: HEAD,
    intent_computed_at: "2026-08-15T10:00:00.000Z",
    intent_freshness: "fresh",
    blast_status: "full",
    link_sha: INDEX,
    index_matches_head: true,
    inputs: [],
    ref_lines: [],
    dropped_refs: [],
    dropped_risks: 0,
    budget: 8000,
    input_tokens_counted: 2040,
    tokenizer: "cl100k_base",
    attempts: 1,
    tokens_in: 2101,
    provider: "openai",
    model: "gpt-4.1",
    cost_usd: 0.014,
    computed_at: "2026-08-16T09:00:00.000Z",
    ...over,
  };
}

function renderBanner(props: Partial<React.ComponentProps<typeof PrBriefBanner>> = {}) {
  const onCompute = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
      <PrBriefBanner
        brief={record()}
        isLoading={false}
        isError={false}
        error={null}
        computing={false}
        onCompute={onCompute}
        review={null}
        reviewCount={0}
        run={null}
        hasOtherStateReview={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onCompute };
}

/**
 * The banner as `OverviewTab` composes it: the picking is done by the helpers,
 * so this exercises the real path rather than a hand-chosen review.
 */
function renderForReviews(
  reviews: ReviewRecord[],
  headSha: string | null,
  runs: RunSummary[] = [],
  props: Partial<React.ComponentProps<typeof PrBriefBanner>> = {},
) {
  const forHead = reviewsForHead(reviews, headSha);
  const picked = forHead[0] ?? null;
  const runsById = new Map(runs.map((r) => [r.run_id, r]));
  return renderBanner({
    review: picked,
    reviewCount: forHead.length,
    run: picked?.run_id != null ? runsById.get(picked.run_id) ?? null : null,
    hasOtherStateReview: hasReviewForOtherState(reviews, headSha),
    ...props,
  });
}

describe("PrBriefBanner — no completed review for this state", () => {
  it("carries the brief's what and why, an empty PR SCORE and no counters", () => {
    renderForReviews([], HEAD);

    expect(screen.getByText("This state has not been reviewed")).toBeInTheDocument();
    expect(screen.getByText("Adds rate limiting to the public API endpoints.")).toBeInTheDocument();
    expect(
      screen.getByText("Unauthenticated clients can exhaust the pricing API today."),
    ).toBeInTheDocument();

    // The slot is there and it is EMPTY — an em dash, the shape the PR list
    // already gives a never-reviewed row.
    expect(screen.getByText("PR SCORE")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    // Neither a verdict nor a zero counter: "0 blockers" is a claim nobody has.
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText(/findings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("says a review exists for an earlier state when one does", () => {
    renderForReviews([review({ head_sha: OLD_HEAD })], HEAD, [RUN]);

    expect(
      screen.getByText("A review exists for an earlier state of this pull request."),
    ).toBeInTheDocument();
    // And contributes NOTHING of its own to this state's slots (AC-69).
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText("61")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.014")).not.toBeInTheDocument();
  });

  it("treats a review with no recorded head as belonging to some other state", () => {
    // `null` means "written before that column existed", NOT "the current state"
    // — reading it as current would make every historical review a review of
    // whatever is checked out now.
    renderForReviews([review({ head_sha: null })], HEAD, [RUN]);

    expect(screen.getByText("This state has not been reviewed")).toBeInTheDocument();
    expect(
      screen.getByText("A review exists for an earlier state of this pull request."),
    ).toBeInTheDocument();
  });

  it("says nothing about an earlier state when there is no review at all", () => {
    renderForReviews([], HEAD);
    expect(
      screen.queryByText("A review exists for an earlier state of this pull request."),
    ).not.toBeInTheDocument();
  });
});

describe("PrBriefBanner — a completed review for this state", () => {
  it("shows the run's verdict, score, cost and summary", () => {
    renderForReviews([review()], HEAD, [RUN]);

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("PR SCORE")).toBeInTheDocument();
    expect(screen.getByText(/Solid middleware approach/)).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("takes the blocker count from the run, never from a recount of the findings", () => {
    renderForReviews([review()], HEAD, [RUN]);

    // Five findings are CRITICAL and undismissed; the agent's own gate counted
    // two. A client-side recount is exactly what AC-68 rejects
    // (`client/INSIGHTS.md:512-524`) — it hardcodes CRITICAL and so ignores
    // `ciFailOn`, which is the agent's, not this component's.
    expect(screen.getByText("6 findings · 2 blockers")).toBeInTheDocument();
    expect(screen.queryByText(/5 blockers/)).not.toBeInTheDocument();
  });

  it("shows the findings count alone when no run row stands behind the review", () => {
    // The seeded demo review has no `agent_runs` row, and "0 blockers" would be
    // a claim rather than an absence.
    renderForReviews([review()], HEAD, []);

    expect(screen.getByText("6 findings")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
    expect(screen.queryByText("$0.014")).not.toBeInTheDocument();
  });

  it("takes the brief's what and why off the screen", () => {
    renderForReviews([review()], HEAD, [RUN]);

    // They stay in the record and in the route's answer; what changes is which
    // of the two prose slots the reader needs (AC-74).
    expect(
      screen.queryByText("Adds rate limiting to the public API endpoints."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Unauthenticated clients can exhaust the pricing API today."),
    ).not.toBeInTheDocument();
  });
});

const follows = (first: HTMLElement, second: HTMLElement) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("PrBriefBanner — the recompute action", () => {
  it("stands under the PR SCORE slot in both states, so it does not move when a review lands", () => {
    // Never reviewed: the slot holds an em dash, and the control is under it.
    renderForReviews([], HEAD);
    expect(
      follows(screen.getByText("PR SCORE"), screen.getByRole("button", { name: "Regenerate brief" })),
    ).toBe(true);

    cleanup();

    // Reviewed: the slot holds the gauge, and the control is under it — the same
    // corner and the same order, which is what stops it jumping between states.
    renderForReviews([review()], HEAD, [RUN]);
    expect(
      follows(screen.getByText("PR SCORE"), screen.getByRole("button", { name: "Regenerate brief" })),
    ).toBe(true);
  });

  it("names the brief while the review's summary stands in the prose slot", () => {
    const { onCompute } = renderForReviews([review()], HEAD, [RUN]);

    const action = screen.getByRole("button", { name: "Regenerate brief" });
    fireEvent.click(action);
    expect(onCompute).toHaveBeenCalledTimes(1);
    // Not "Run review", not "Recompute intent" — the subject is the brief
    // whatever prose stands beside it (AC-71).
    expect(action).toBeEnabled();
  });

  it("is disabled by its own in-flight mutation and by nothing else", () => {
    renderBanner({ computing: true });
    expect(screen.getByRole("button", { name: "Regenerate brief" })).toBeDisabled();

    cleanup();
    // A failed brief must keep its retry — a retry taken away in the state it
    // recovers from is no retry at all.
    renderBanner({
      brief: null,
      isError: true,
      error: new ApiError("The model provider timed out.", 502, "external_service_error"),
    });
    expect(screen.getByRole("button", { name: /compute brief/i })).toBeEnabled();
  });
});

describe("PrBriefBanner — the brief's own states", () => {
  it("shows the server's reason for a failure", () => {
    renderBanner({
      brief: null,
      isError: true,
      error: new ApiError("The model provider timed out.", 502, "external_service_error"),
    });

    expect(screen.getByText("Couldn't compute the brief.")).toBeInTheDocument();
    expect(screen.getByText("The model provider timed out.")).toBeInTheDocument();
  });

  it("shows the rate-limit sentence for a 429", () => {
    renderBanner({ brief: null, isError: true, error: new ApiError("Rate limit exceeded", 429) });
    expect(screen.getByText(/too many briefs were requested/i)).toBeInTheDocument();
  });

  it("says the model is not configured, and where to choose one", () => {
    renderBanner({
      brief: null,
      isError: true,
      error: new ApiError("no provider key for risk_brief", 500, "config_error"),
    });

    expect(screen.getByText(/no model is configured for the risk brief/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
      "href",
      "/settings/models",
    );
    expect(screen.queryByText("Couldn't compute the brief.")).not.toBeInTheDocument();
  });

  it("shows progress and not the previous brief while a computation is running", () => {
    renderBanner({ brief: record(), computing: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByText("Adds rate limiting to the public API endpoints."),
    ).not.toBeInTheDocument();
  });

  it("surfaces the brief's failure even while a review fills the prose slot", () => {
    // The banner owns the brief's state now, and AC-42's copy has to stay
    // reachable in both of the banner's two states.
    renderForReviews([review()], HEAD, [RUN], {
      brief: null,
      isError: true,
      error: new ApiError("no provider key for risk_brief", 500, "config_error"),
    });

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText(/no model is configured for the risk brief/i)).toBeInTheDocument();
  });
});

/**
 * The comparator, asserted directly. A component test cannot tell a
 * deterministic pick from a lucky one: both candidates render the same shape,
 * and the only visible difference is which agent's name appears.
 */
describe("PrBriefBanner — which review, when several completed at this head", () => {
  const older = review({ id: "rev-a", created_at: "2026-08-16T08:00:00.000Z" });
  const newer = review({ id: "rev-b", created_at: "2026-08-16T09:00:00.000Z" });

  /** Security blocks; a Docs agent approves the same head minutes later. */
  const blocking = review({
    id: "rev-security",
    agent_name: "Security",
    verdict: "request_changes",
    created_at: "2026-08-16T08:00:00.000Z",
  });
  const approving = review({
    id: "rev-docs",
    agent_name: "Docs",
    verdict: "approve",
    summary: "Docs read fine.",
    score: 95,
    created_at: "2026-08-16T09:00:00.000Z",
    findings: [],
  });

  it("takes the newest of two that agree", () => {
    expect(pickReviewForHead([older, newer], HEAD)?.id).toBe("rev-b");
    expect(pickReviewForHead([newer, older], HEAD)?.id).toBe("rev-b");
  });

  /**
   * Both orders, because a test that passes only because the fixture happened to
   * be ordered proves nothing — and the approving review here is the NEWER of the
   * two, so recency alone would pick it either way round.
   */
  it("takes the most blocking verdict, not the newest, whichever order they arrive in", () => {
    expect(pickReviewForHead([blocking, approving], HEAD)?.id).toBe("rev-security");
    expect(pickReviewForHead([approving, blocking], HEAD)?.id).toBe("rev-security");
  });

  it("ranks a comment above an approve", () => {
    const commenting = review({
      id: "rev-comment",
      verdict: "comment",
      created_at: "2026-08-16T07:00:00.000Z",
    });
    expect(pickReviewForHead([commenting, approving], HEAD)?.id).toBe("rev-comment");
    expect(pickReviewForHead([approving, commenting], HEAD)?.id).toBe("rev-comment");
  });

  it("treats a verdict nothing maps as neither blocking nor an approval", () => {
    // `src/lib/api.ts` validates nothing, and `"constructor"` is a key every
    // object literal answers to — an allowlist built with `in` is not one
    // (`client/INSIGHTS.md:594-618`).
    const unknown = review({ id: "rev-x", verdict: "constructor" as ReviewRecord["verdict"] });
    expect(pickReviewForHead([unknown, blocking], HEAD)?.id).toBe("rev-security");
    expect(pickReviewForHead([unknown, approving], HEAD)?.id).toBe("rev-x");
  });

  it("shows the blocking verdict and says how many reviews stand behind it", () => {
    renderForReviews([approving, blocking], HEAD, [RUN]);

    // The page's top-level "should I merge" signal. Approve · 0 blockers here,
    // with the blocking review one tab away, is the defect.
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.getByText(/2 reviews ran on this state/)).toBeInTheDocument();
  });

  it("shows the same thing when the two arrive the other way round", () => {
    renderForReviews([blocking, approving], HEAD, [RUN]);

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText(/2 reviews ran on this state/)).toBeInTheDocument();
  });

  it("says nothing about other reviews when there is only one", () => {
    renderForReviews([review()], HEAD, [RUN]);
    expect(screen.queryByText(/reviews ran on this state/)).not.toBeInTheDocument();
  });

  it("breaks a tie on created_at by id, whichever order the two arrive in", () => {
    // Two agents CAN finish inside the same `now()`. Without the tie-break the
    // banner would show a different one of them between two loads, with no test
    // failing.
    const a = review({ id: "rev-a", created_at: "2026-08-16T09:00:00.000Z" });
    const b = review({ id: "rev-b", created_at: "2026-08-16T09:00:00.000Z" });

    expect(pickReviewForHead([a, b], HEAD)?.id).toBe("rev-a");
    expect(pickReviewForHead([b, a], HEAD)?.id).toBe("rev-a");
    expect(byNewestThenId(a, b)).toBeLessThan(0);
    expect(byNewestThenId(b, a)).toBeGreaterThan(0);
  });

  it("does not mutate the array it was handed", () => {
    // It is TanStack's cached response, and `sort` sorts in place.
    const list = [older, newer];
    pickReviewForHead(list, HEAD);
    expect(list.map((r) => r.id)).toEqual(["rev-a", "rev-b"]);
  });

  it("ignores a review that produced no verdict", () => {
    expect(pickReviewForHead([review({ verdict: null })], HEAD)).toBeNull();
    expect(hasReviewForOtherState([review({ verdict: null, head_sha: OLD_HEAD })], HEAD)).toBe(
      false,
    );
  });

  it("matches nothing when the pull request's own head is unknown", () => {
    expect(pickReviewForHead([review()], null)).toBeNull();
  });

  /**
   * `src/lib/api.ts` validates nothing at runtime, so against an API that does
   * not send `head_sha` yet the field arrives as `undefined` — not as the `null`
   * the contract promises. Normalising it is what keeps a fixture and a browser
   * on the same branch of every comparison.
   */
  it("reads a missing head_sha as null, not as undefined", () => {
    const stale = { ...review(), head_sha: undefined } as unknown as ReviewRecord;
    expect(reviewHead(stale)).toBeNull();
  });

  it("claims no earlier-state review when neither head is known", () => {
    const stale = { ...review(), head_sha: undefined } as unknown as ReviewRecord;
    // Both sides unknown is not evidence of an EARLIER state; it is evidence of
    // nothing, and saying otherwise puts a sentence on screen nobody can check.
    expect(hasReviewForOtherState([stale], null)).toBe(false);
    expect(pickReviewForHead([stale], null)).toBeNull();
  });
});

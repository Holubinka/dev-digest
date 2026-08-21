import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile, RiskBriefRecord } from "@/lib/types";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import brief from "@/../messages/en/brief.json";
import prReview from "@/../messages/en/prReview.json";

const hooks = vi.hoisted(() => ({
  usePrIntent: vi.fn(),
  useRecomputeIntent: vi.fn(),
}));

/**
 * The brief hooks are NOT mocked, and that is the point of this file.
 *
 * They were, until round 5: `usePrBrief` and `useComputeBrief` were both
 * `vi.fn()`, so every fact the tab's automatic computation depends on — the
 * cached `null` for a state, the record of a compute already fired — lived in
 * the test rather than in a cache. A guard that reset on remount was therefore
 * invisible to six cases, and a failed compute shipped paying for itself again
 * on every tab switch. The boundary here is the HTTP client, one layer lower.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api,
}));
// The specifier must be the one the component imports, not the barrel that
// re-exports it: a mock registered under `@/lib/hooks` does not intercept a
// component importing `@/lib/hooks/core` — Vitest keys the registry by
// resolved module, and the two resolve to different files.
//
// Intent stays mocked: it is not what this file is about, and leaving it real
// would put its own reads into `api.get` and make the brief's call counts
// ambiguous.
vi.mock("@/lib/hooks/core", () => ({
  usePrIntent: hooks.usePrIntent,
  useRecomputeIntent: hooks.useRecomputeIntent,
}));
/**
 * INTENT is a stand-in that renders its `riskAreas` SLOT and nothing else — the
 * card has its own test, and what this file is about is the composition. The
 * slot is passed through rather than swallowed because the section inside it is
 * one of the brief's three places, and a slot the tab forgot to fill would
 * otherwise look exactly like a card that renders it.
 */
vi.mock("../IntentCard", () => ({
  IntentCard: ({ riskAreas }: { riskAreas?: React.ReactNode }) => (
    <div data-testid="intent-card">{riskAreas}</div>
  ),
}));
// The stand-in records `prId`: the card is useless without it, and a prop the
// parent never passes is invisible to `tsc` when it has a default
// (`client/INSIGHTS.md:163-249`). It also owns its own query, which this file
// does not want in `api.get`.
vi.mock("../BlastRadiusCard", () => ({
  BlastRadiusCard: ({ prId }: { prId: string | null }) => (
    <div data-testid="blast-radius-card" data-pr-id={String(prId)} />
  ),
}));

import { OverviewTab } from "./OverviewTab";

const FILES: PrFile[] = [
  { path: "server/src/modules/brief/service.ts", additions: 210, deletions: 0, patch: null },
];

const HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";

/** A real record: the banner and both sections render it for real here. */
const BRIEF = {
  what: "Adds a per-head_sha Risk Brief computed from one model call.",
  why: "Reviewers open a 40-file PR with no idea where the danger is.",
  risk_level: "high",
  risks: [],
  review_focus: [],
  head_sha: HEAD,
  intent_computed_at: null,
  intent_freshness: "fresh",
  blast_status: "full",
  link_sha: null,
  index_matches_head: false,
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
} as unknown as RiskBriefRecord;

/**
 * The same record with something in each of the brief's three places, so a
 * regression that empties one of them is visible here rather than only in the
 * three component files.
 */
const FULL_BRIEF = {
  ...BRIEF,
  risks: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "The limiter runs before the session is resolved.",
      severity: "high",
      file_refs: ["src/middleware/ratelimit.ts"],
    },
  ],
  review_focus: [
    {
      ref: "src/config.ts",
      kind: "file",
      reason: "live Stripe key (sk_live_…) committed in plaintext",
    },
  ],
  inputs: [{ id: "diff_stats", status: "included", tokens: 180, detail: "12 files" }],
} as unknown as RiskBriefRecord;

/**
 * ONE client for the whole test, across every mount inside it.
 *
 * That is what a browser has: the provider sits above the router, so unmounting
 * the tab does not take the caches with it. A client rebuilt per render would
 * make the remount case below pass for the wrong reason.
 */
let client: QueryClient;

beforeEach(() => {
  hooks.usePrIntent.mockReturnValue({ data: null, isLoading: false, isError: false });
  hooks.useRecomputeIntent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  api.get.mockReset().mockResolvedValue(null);
  api.post.mockReset().mockResolvedValue(BRIEF);
  client = new QueryClient({
    // No `gcTime` overrides: the automatic computation's guard lives in the
    // mutation cache and its window IS the default five minutes.
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(cleanup);

type TabProps = Partial<React.ComponentProps<typeof OverviewTab>>;

/** The tab as `page.tsx` renders it: same mount, different props. */
function tabWith(props: TabProps) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
        <React.StrictMode>
          <OverviewTab
            prBody={null}
            prId="pr-1"
            headSha={HEAD}
            prFiles={FILES}
            repoFullName="acme/payments-api"
            reviews={[]}
            prRuns={[]}
            onOpenFile={vi.fn()}
            {...props}
          />
        </React.StrictMode>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/**
 * StrictMode is not decoration here. It is the cheapest reproduction of one of
 * the two ways this tab could pay twice: React deliberately runs an effect's
 * setup, cleanup and setup again on mount, so an unguarded "compute when there
 * is none" starts TWO paid model calls for one PR state. The other way is the
 * remount, which needs `unmount()` and has its own case below.
 */
function renderTab(props: TabProps = {}) {
  return render(tabWith(props));
}

// Shaped like a real GitHub PR body: a heading, emphasis, inline code and a GFM
// table. Every one of these renders as its own source when the box carries
// `whiteSpace: pre-wrap` instead of a Markdown renderer.
const BODY = [
  "## What and why",
  "",
  "`getPullRequest` made **one** call and kept whatever came back.",
  "",
  "| Finding | Verdict |",
  "|---|---|",
  "| Truncated import | Real |",
].join("\n");

describe("OverviewTab — description", () => {
  it("renders the PR body as markdown, not as its own source", () => {
    renderTab({ prBody: BODY });

    expect(screen.getByRole("heading", { name: "What and why" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Truncated import" })).toBeInTheDocument();
    expect(screen.getByText("one").tagName).toBe("STRONG");
    expect(screen.getByText("getPullRequest").tagName).toBe("CODE");

    // The negative half is what actually catches a regression: a renderer that
    // silently degrades to plain text still satisfies "the words are on screen".
    const shown = document.body.textContent ?? "";
    expect(shown).not.toContain("## What and why");
    expect(shown).not.toContain("|---|---|");
    expect(shown).not.toContain("**one**");
    expect(shown).not.toContain("`getPullRequest`");
  });

  it("renders no Description section when the PR has no body", () => {
    renderTab();

    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.getByTestId("intent-card")).toBeInTheDocument();
  });
});

describe("OverviewTab — the composition the design asks for", () => {
  it("puts one PR Brief heading over the banner, the cards and the focus section", () => {
    renderTab();

    // ONE heading, and it stands over all three (AC-49).
    expect(screen.getAllByText("PR Brief")).toHaveLength(1);
    const group = screen.getByText("PR Brief").closest("section") as HTMLElement;
    expect(within(group).getByText("This state has not been reviewed")).toBeInTheDocument();
    expect(within(group).getByText("Review focus — read these first")).toBeInTheDocument();
    expect(group.querySelector(".dd-overview-cards")).not.toBeNull();
  });

  it("leaves exactly two cards in the row — INTENT and BLAST RADIUS", () => {
    const { container } = renderTab();
    const row = container.querySelector(".dd-overview-cards")!;

    // AC-46. The brief lost its card; a third child here would be that card back.
    expect(row.children).toHaveLength(2);
    expect(row.firstElementChild).toBe(screen.getByTestId("intent-card"));
    expect(row.lastElementChild).toBe(screen.getByTestId("blast-radius-card"));
    expect(screen.getByTestId("blast-radius-card")).toHaveAttribute("data-pr-id", "pr-1");
  });

  it("fills INTENT's risk-areas slot rather than leaving it empty", () => {
    renderTab();
    expect(within(screen.getByTestId("intent-card")).getByText("Risk areas")).toBeInTheDocument();
  });

  /**
   * The card row stacks below 1024px, and that rule lives in `app/globals.css`
   * against `dd-overview-cards`. jsdom loads no stylesheet, so the media query
   * itself cannot be asserted here — but the way it breaks can be, and it breaks
   * silently: an inline style beats any stylesheet rule, so re-adding
   * `display`/`gridTemplateColumns` to `s.cardRow` would leave the row looking
   * correct at desktop width and quietly stop it responding
   * (`client/AGENTS.md`). That is what this pins.
   *
   * It is also what made the row overflow in the first place: the columns were
   * inline `1fr`, whose implicit `min-width: auto` refuses to shrink below the
   * content — and blast radius is full of unbreakable paths.
   */
  it("leaves the grid to the stylesheet, so the breakpoint is not overridden inline", () => {
    const { container } = renderTab();
    const row = container.querySelector(".dd-overview-cards");

    expect(row).not.toBeNull();
    expect(row!.getAttribute("style") ?? "").not.toMatch(/display|grid-template-columns/);
  });

  it("stacks banner, cards and focus section in the order the design reads", () => {
    // Siblings in document order — which is what gives the one-column layout its
    // order below 1024px with no CSS at all (AC-51).
    const { container } = renderTab();
    const group = screen.getByText("PR Brief").closest("section") as HTMLElement;
    const positions = [
      screen.getByText("This state has not been reviewed"),
      container.querySelector(".dd-overview-cards")!,
      screen.getByText("Review focus — read these first"),
    ].map((el) => [...group.querySelectorAll("*")].indexOf(el as Element));

    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
  });

  it("keeps INTENT, BLAST and the focus section rendered while there is no brief", async () => {
    // AC-50: the brief's absence resizes nothing and removes nothing. The focus
    // section stays put with the count 0 — a `{n && …}` there would print a
    // literal `0` instead of the sentence.
    api.post.mockRejectedValue(new Error("no key configured"));
    renderTab();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.getByTestId("intent-card")).toBeInTheDocument();
    expect(screen.getByTestId("blast-radius-card")).toBeInTheDocument();
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(within(screen.getByTestId("intent-card")).getByText("Risk areas")).toBeInTheDocument();
  });

  /**
   * The regression this pins: `record` used to be
   * `briefFailure != null ? null : briefData`, and the mutation's error is sticky
   * for the life of the mount. One 429 on the regenerate icon therefore emptied
   * RISK AREAS, REVIEW FOCUS, the provenance block and the brief cost for the
   * rest of the visit, and both sections printed "The brief for this state has
   * not been computed." about a brief that is computed and cached.
   */
  it("keeps a cached brief on screen when a regeneration fails", async () => {
    api.get.mockResolvedValue(FULL_BRIEF);
    api.post.mockRejectedValue(new ApiError("Rate limit exceeded", 429));
    renderTab();

    // The stored brief for this head, in all three of its places.
    expect(await screen.findByText("Auth surface touched")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate brief" }));

    // The failure arrives, in the banner, which owns that copy…
    expect(await screen.findByText(/too many briefs were requested/i)).toBeInTheDocument();
    // …and takes nothing with it.
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByText("— live Stripe key (sk_live_…) committed in plaintext")).toBeInTheDocument();
    expect(screen.getByText("Built from")).toBeInTheDocument();
    expect(screen.getByText("diff_stats")).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(
      screen.getByText("Adds a per-head_sha Risk Brief computed from one model call."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("The brief for this state has not been computed."),
    ).not.toBeInTheDocument();

    // And it is not a paid retry loop either: one POST, the one that was clicked.
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("keeps the focus section with the count 0 when the brief singled out nothing", async () => {
    api.get.mockResolvedValue(BRIEF);
    renderTab();

    expect(await screen.findByText("0")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing was singled out for this state of the pull request."),
    ).toBeInTheDocument();
  });
});

describe("OverviewTab — which review the banner speaks for", () => {
  const review = (over: Partial<ReviewRecord>): ReviewRecord =>
    ({
      id: "rev-1",
      pr_id: "pr-1",
      agent_id: "agent-1",
      run_id: "run-1",
      agent_name: "Security",
      head_sha: HEAD,
      kind: "review",
      verdict: "request_changes",
      summary: "A Stripe key is committed in plaintext.",
      score: 61,
      model: "gpt-4.1",
      created_at: "2026-08-16T09:00:00.000Z",
      findings: [],
      ...over,
    }) as unknown as ReviewRecord;

  const run = (over: Partial<RunSummary>): RunSummary =>
    ({ run_id: "run-1", blockers: 2, cost_usd: 0.014, tokens_in: 8200, tokens_out: 1300, ...over }) as unknown as RunSummary;

  it("joins the run to the review by run_id and shows the stored blocker count", async () => {
    api.get.mockResolvedValue(BRIEF);
    renderTab({ reviews: [review({})], prRuns: [run({})] });

    expect(await screen.findByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("0 findings · 2 blockers")).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("ignores a review belonging to another state of the pull request", async () => {
    api.get.mockResolvedValue(BRIEF);
    renderTab({ reviews: [review({ head_sha: "0".repeat(40) })], prRuns: [run({})] });

    expect(await screen.findByText("This state has not been reviewed")).toBeInTheDocument();
    expect(
      screen.getByText("A review exists for an earlier state of this pull request."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
  });
});

describe("OverviewTab — the automatic first computation", () => {
  it("computes a brief for a state the server holds none for, exactly once", async () => {
    renderTab();

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith("/pulls/pr-1/brief");
  });

  it("does not fire again when the tab re-renders for another reason", async () => {
    const { rerender } = renderTab();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    rerender(tabWith({ prBody: BODY }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  /**
   * The case the guard is really for, and the one every other case here missed
   * until 2026-08-16: `page.tsx` renders this tab as
   * `{tab === "overview" && <OverviewTab …/>}`, so a look at Files changed and
   * back UNMOUNTS it. A guard whose lifetime is the mount is reset by that,
   * while the fact it records — "this `(prId, headSha)` has been computed for" —
   * is not; the query cache still holds `null`, and the tab fired a second paid
   * `POST /pulls/:id/brief` nobody asked for.
   *
   * The failure is the expensive one to observe: the second computation replaces
   * the error the reader needed with a fresh spinner, because the remounted
   * mutation starts at `error: null`. `config_error` is the one failure a human
   * can act on (AC-42).
   */
  it("does not compute again when a failed state's tab is left and reopened", async () => {
    api.post.mockRejectedValue(new Error("no key configured for openrouter"));
    const view = renderTab();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    // Leave the tab, come back to it — same client, same PR, same head.
    view.unmount();
    renderTab();

    // The remounted mutation starts at `error: null`, so the banner falls to the
    // empty state rather than the failure — and the call count is the assertion
    // that matters: a second paid `POST` here is the defect.
    // The banner's own empty state, once — the two sections say their own
    // sentence, so the same words do not land on screen three times.
    expect(await screen.findByText("Brief not available yet.")).toBeInTheDocument();
    expect(
      screen.getAllByText("The brief for this state has not been computed."),
    ).toHaveLength(2);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("computes nothing when the server already holds a brief for this head", async () => {
    // AC-28: a stored record is served with zero model calls, however many times
    // it is read.
    api.get.mockResolvedValue(BRIEF);
    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText("Adds a per-head_sha Risk Brief computed from one model call."),
      ).toBeInTheDocument(),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("computes nothing before the query has settled", async () => {
    // `undefined` is "we have not asked yet", and firing on it would spend a
    // model call on every mount, including the ones the cache would have served.
    api.get.mockReturnValue(new Promise(() => {}));
    renderTab();

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(api.post).not.toHaveBeenCalled();
  });

  it("computes again when the pull request moves to a new head", async () => {
    // The guard is keyed by `(prId, headSha)`, not a once-per-PR latch: a new
    // head is a new state, and it has no brief of its own.
    const { rerender } = renderTab();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    rerender(tabWith({ headSha: "0000000000000000000000000000000000000000" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  });

  it("computes nothing while the pull request id is still being resolved", async () => {
    renderTab({ prId: null });

    await waitFor(() => expect(screen.getByTestId("intent-card")).toBeInTheDocument());
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

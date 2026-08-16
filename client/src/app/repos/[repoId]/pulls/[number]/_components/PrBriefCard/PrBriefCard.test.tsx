import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, RiskBriefRecord } from "@/lib/types";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/brief.json";
import { PrBriefCard } from "./PrBriefCard";

/**
 * The Risk Brief card is presentational — `OverviewTab` owns the query and the
 * mutation — so this file needs `NextIntlClientProvider` and nothing else: no
 * query client, no `fetch` mock, no router.
 *
 * Everything the card renders except its own labels is MODEL OUTPUT reaching it
 * through `src/lib/api.ts`, which does not validate at runtime. That is why the
 * hostile cases below are ordinary tests rather than a separate security file.
 */
afterEach(cleanup);

const HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const INDEX = "1122334455667788990011223344556677889900";

const FILES: PrFile[] = [
  { path: "server/src/modules/brief/service.ts", additions: 210, deletions: 0, patch: null },
  { path: "server/src/db/schema/reviews.ts", additions: 12, deletions: 2, patch: null },
];

function record(over: Partial<RiskBriefRecord> = {}): RiskBriefRecord {
  return {
    what: "Adds a per-head_sha Risk Brief computed from one model call.",
    why: "Reviewers open a 40-file PR with no idea where the danger is.",
    risk_level: "high",
    risks: [
      {
        kind: "security",
        title: "The paid route is reachable before tenancy is resolved",
        explanation: "A PR id from another workspace would spend a model call.",
        severity: "high",
        file_refs: ["server/src/modules/brief/service.ts"],
      },
      {
        kind: "correctness",
        title: "The budget walk drops in priority order",
        explanation: "A dropped input is recorded but not re-counted.",
        severity: "medium",
        file_refs: [],
      },
      {
        kind: "style",
        title: "The prompt duplicates the intent wording",
        explanation: "Two prompts restate the same instruction.",
        severity: "low",
        file_refs: [],
      },
    ],
    review_focus: [
      {
        ref: "server/src/modules/brief/service.ts",
        kind: "file",
        reason: "The whole computation lives here.",
      },
      {
        ref: "POST /pulls/:id/brief",
        kind: "endpoint",
        reason: "The route that spends money.",
      },
    ],
    head_sha: HEAD,
    intent_computed_at: "2026-08-15T10:00:00.000Z",
    intent_freshness: "fresh",
    blast_status: "full",
    link_sha: INDEX,
    index_matches_head: true,
    inputs: [
      { id: "diff_stats", status: "included", tokens: 180, detail: "12 files" },
      { id: "intent", status: "included", tokens: 320, detail: "high confidence" },
      { id: "blast", status: "truncated", tokens: 900, detail: "30 symbols, 12 shown" },
      { id: "pr_text", status: "included", tokens: 640, detail: null },
      { id: "linked_issue", status: "missing", tokens: 0, detail: "no linked issue" },
      { id: "specs", status: "dropped", tokens: 0, detail: "did not fit the budget" },
    ],
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

function renderCard(props: Partial<React.ComponentProps<typeof PrBriefCard>> = {}) {
  const onCompute = vi.fn();
  const onOpenFile = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <PrBriefCard
        brief={record()}
        isLoading={false}
        isError={false}
        error={null}
        computing={false}
        onCompute={onCompute}
        prFiles={FILES}
        repoFullName="acme/payments-api"
        onOpenFile={onOpenFile}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onCompute, onOpenFile };
}

/** The row holding the level badge — the scope "beside the level" means. */
const levelRow = () => screen.getByText("Risk level").parentElement!;

/** The block whose label is `heading`, e.g. "Risks" or "Where to look first". */
const block = (heading: string) => screen.getByText(heading).closest("section")!;

describe("PrBriefCard — the loaded brief", () => {
  it("shows what, why, the level as a word, the risks and the review focus", () => {
    renderCard();

    expect(
      screen.getByText("Adds a per-head_sha Risk Brief computed from one model call."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reviewers open a 40-file PR with no idea where the danger is."),
    ).toBeInTheDocument();
    // The WORD, not a colour: a reader who cannot see the badge's fill still
    // learns the level.
    expect(within(levelRow()).getByText("high")).toBeInTheDocument();
    expect(
      screen.getByText("The paid route is reachable before tenancy is resolved"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A PR id from another workspace would spend a model call."),
    ).toBeInTheDocument();
    expect(screen.getByText("The whole computation lives here.")).toBeInTheDocument();
  });

  it("renders the risks in the order the server sent them, worst first", () => {
    renderCard();
    const titles = within(block("Risks"))
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(titles[0]).toContain("The paid route is reachable before tenancy is resolved");
    expect(titles[1]).toContain("The budget walk drops in priority order");
    expect(titles[2]).toContain("The prompt duplicates the intent wording");
  });

  it("lists every input the brief was built from, with its status", () => {
    renderCard();
    const rows = within(block("Built from"))
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain("diff_stats");
    expect(rows[0]).toContain("included");
    expect(rows[2]).toContain("truncated");
    expect(rows[4]).toContain("missing");
    expect(rows[5]).toContain("dropped");
  });

  it("says there are no risks beside the level rather than showing an empty section", () => {
    renderCard({ brief: record({ risks: [], risk_level: "low" }) });

    const none = screen.getByText("No notable risks flagged.");
    // "Beside" is the assertion, not "present": the same row as the level.
    expect(none.parentElement).toBe(levelRow());
    expect(within(levelRow()).getByText("low")).toBeInTheDocument();
    expect(screen.queryByText("Risks")).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — model output is text, never markup", () => {
  it("renders an HTML payload in `what` as characters and mounts no element from it", () => {
    const payload = '<img src=x onerror="alert(1)"> **bold** [link](javascript:alert(2))';
    const { container } = renderCard({ brief: record({ what: payload }) });

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    // The markdown half matters as much: `<Markdown>` sits two elements away in
    // the same tab, and reaching for it here is exactly the mistake.
    expect(container.querySelector("strong")).toBeNull();
  });
});

describe("PrBriefCard — what may become a control", () => {
  it("makes a focus item naming a changed file a button that opens it", () => {
    const { onOpenFile } = renderCard();

    const control = screen.getByRole("button", {
      name: "server/src/modules/brief/service.ts",
    });
    fireEvent.click(control);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("server/src/modules/brief/service.ts");
  });

  it("renders a focus item outside the PR's files as text, never a dead control", () => {
    renderCard();

    // An endpoint label is grounded — the server allows it — and is still not a
    // file this PR changed, so there is nothing for a click to open.
    expect(screen.getByText("POST /pulls/:id/brief")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "POST /pulls/:id/brief" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["a dot segment", "server/src/modules/../../../etc/passwd"],
    ["a control character", `server/src/modules/brief${String.fromCodePoint(9)}/service.ts`],
    ["a scheme", "javascript:alert(1)"],
  ])("refuses to make a ref carrying %s a control, even inside the PR", (_label, ref) => {
    // Membership is granted deliberately: this is the case where grounding says
    // yes and the URL rules must still say no.
    renderCard({
      brief: record({
        review_focus: [{ ref, kind: "file", reason: "hostile" }],
      }),
      prFiles: [...FILES, { path: ref, additions: 1, deletions: 0, patch: null }],
    });

    expect(screen.queryByRole("button", { name: ref })).not.toBeInTheDocument();
    // An identity normalizer, because RTL's default collapses the very TAB one
    // of these cases is about — matching the collapsed form would pass against
    // a card that had silently dropped the character.
    expect(screen.getByText(ref, { normalizer: (value) => value })).toBeInTheDocument();
  });

  it("links a risk reference at the index commit, not at the head", () => {
    renderCard();
    const link = screen.getByRole("link", {
      name: "server/src/modules/brief/service.ts",
    });

    expect(link).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${INDEX}/server/src/modules/brief/service.ts`,
    );
    expect(link.getAttribute("href")).not.toContain(HEAD);
  });

  it("renders every reference as text when there is no commit to link them at", () => {
    renderCard({ brief: record({ link_sha: null, index_matches_head: false }) });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // Both surfaces degrade: the risk's reference AND the focus item, which is
    // still a button — losing the anchor must not lose the path itself.
    expect(screen.getAllByText("server/src/modules/brief/service.ts")).toHaveLength(2);
  });
});

describe("PrBriefCard — what the brief rests on", () => {
  it("marks the intent as derived from an earlier state when it is stale", () => {
    renderCard({ brief: record({ intent_freshness: "stale" }) });
    expect(
      screen.getByText(/derived from an earlier state of the pull request/i),
    ).toBeInTheDocument();
  });

  it("says the intent's age could not be compared rather than implying it is fresh", () => {
    renderCard({ brief: record({ intent_freshness: "unknown" }) });

    const hint = screen.getByText(/age could not be compared with this commit/i);
    expect(hint).toBeInTheDocument();
    // The failure this guards is `unknown` rendering as the `fresh` branch —
    // i.e. silently, which is indistinguishable from a confident answer.
    expect(
      screen.queryByText(/derived from an earlier state of the pull request/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about intent age when it is fresh", () => {
    renderCard({ brief: record({ intent_freshness: "fresh" }) });

    expect(
      screen.queryByText(/derived from an earlier state of the pull request/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/age could not be compared with this commit/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about intent age when `unknown` means there was no intent at all", () => {
    // The inputs block already reports the intent as missing; a second sentence
    // about the age of something that does not exist is noise.
    renderCard({
      brief: record({ intent_freshness: "unknown", intent_computed_at: null }),
    });
    expect(
      screen.queryByText(/age could not be compared with this commit/i),
    ).not.toBeInTheDocument();
  });

  it("names the commit the risks rest on when the index is behind the head", () => {
    renderCard({ brief: record({ index_matches_head: false }) });
    expect(screen.getByText(/code index at commit 1122334/i)).toBeInTheDocument();
  });
});

describe("PrBriefCard — the states that are not a brief", () => {
  it("shows progress and not the previous brief while a computation is running", () => {
    renderCard({ brief: record(), computing: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByText("Adds a per-head_sha Risk Brief computed from one model call."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Risk level")).not.toBeInTheDocument();
  });

  it("shows the server's reason for a failure and leaves the action enabled", () => {
    renderCard({
      brief: null,
      isError: true,
      error: new ApiError("The model provider timed out.", 502, "external_service_error"),
    });

    expect(screen.getByText("Couldn't compute the brief.")).toBeInTheDocument();
    expect(screen.getByText("The model provider timed out.")).toBeInTheDocument();
    // Disabled by its own in-flight mutation and by NOTHING else — the retry
    // has to exist in the state it recovers from.
    expect(screen.getByRole("button", { name: /compute brief/i })).toBeEnabled();
  });

  it("shows the rate-limit sentence for a 429 and still leaves the action enabled", () => {
    renderCard({
      brief: null,
      isError: true,
      error: new ApiError("Rate limit exceeded", 429),
    });

    expect(screen.getByText(/too many briefs were requested/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /compute brief/i })).toBeEnabled();
  });

  it("says the model is not configured, and where to choose one, instead of failing generically", () => {
    renderCard({
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

  it("offers to compute when the server holds no brief for this state", () => {
    const { onCompute } = renderCard({ brief: null });

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /compute brief/i }));
    expect(onCompute).toHaveBeenCalledTimes(1);
  });
});

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package (`client/INSIGHTS.md:435`).
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { githubBlobUrl } from "@/lib/github-urls";
import type { BlastRadiusView, BlastSymbol } from "@/lib/types";
import messages from "@/../messages/en/blast.json";
/* The live answer for PR #12, saved verbatim on 2026-08-09 — see the header of
   `toGraph.test.ts`. The graph is capped and the tree is not, so the sentence
   the modal prints is only worth asserting against a payload big enough to be
   capped: 30 symbols, 20 call sites, 38 endpoints. */
import liveFixture from "./blast-pr12.fixture.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

/* `react-force-graph-2d` paints onto a `<canvas>`, which jsdom does not
   implement — mounting the real one throws before any assertion runs. Only the
   drawing is replaced: what the graph CONTAINS is decided by `toGraph` and
   asserted directly in `toGraph.test.ts`, with no mock in sight. */
vi.mock("react-force-graph-2d", () => ({
  default: ({ graphData }: { graphData: { nodes: unknown[]; links: unknown[] } }) => (
    <div
      data-testid="force-graph"
      data-nodes={graphData.nodes.length}
      data-links={graphData.links.length}
    />
  ),
}));

/* The boundary mocked here is `fetch`, not the hooks: that way one file covers
   both step 11 (the query key, the two URLs, the `setQueryData` write) and step
   12 (what each state renders). The suite needs no running API. */
const fetchMock = vi.fn();

const jsonOk = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const isSummaryCall = (call: unknown[]) => String(call[0]).endsWith("/blast/summary");

/* Named separately from VIEW because `tsconfig` sets `noUncheckedIndexedAccess`:
   spreading `VIEW.symbols[0]` would make every field optional again. */
const SYMBOL: BlastSymbol = {
  name: "ReviewService",
  kind: "class",
  file: "server/src/modules/reviews/service.ts",
  line: 21,
  callers: [
    { file: "server/src/app.ts", symbol: "buildApp", line: 83, rank: 0.92 },
    {
      file: "server/src/modules/reviews/routes.ts",
      symbol: "reviewRoutes",
      line: 22,
      rank: 0.71,
    },
  ],
  caller_count: 2,
  truncated: false,
  endpoints: [
    {
      label: "POST /pulls/:id/review",
      file: "server/src/modules/reviews/routes.ts",
      line: 40,
      depth: 1,
      kind: "http",
    },
  ],
  endpoint_count: 1,
  endpoints_truncated: false,
};

/**
 * The two shas differ on purpose, because in production they usually do: the
 * index is rebuilt on its own schedule while the PR head keeps moving. Every
 * `line` in this fixture belongs to `link_sha`, so a link built from `head_sha`
 * is a link to the wrong line — which is what these tests are here to catch.
 */
const LINK_SHA = "66727c85ce06";
const HEAD_SHA = "9f2c1ab4d5e6";

const LIVE = liveFixture as BlastRadiusView;

const VIEW: BlastRadiusView = {
  status: "full",
  reason: null,
  repo_full_name: "Holubinka/dev-digest",
  head_sha: HEAD_SHA,
  link_sha: LINK_SHA,
  index_matches_head: false,
  changed_files: ["server/src/modules/reviews/service.ts"],
  symbols: [SYMBOL],
  totals: { symbols: 1, callers: 2, endpoints: 1, crons: 0 },
  summary: null,
};

/** Serve `view` on GET /blast and `summary` on POST /blast/summary. */
function serve(view: BlastRadiusView, summary = "One paragraph about ReviewService.") {
  fetchMock.mockImplementation((url: string) =>
    isSummaryCall([url])
      ? Promise.resolve(jsonOk({ summary }))
      : Promise.resolve(jsonOk(view)),
  );
}

function renderCard(prId: string | null = "pr-1") {
  return renderWithProviders(<BlastRadiusCard prId={prId} />, { blast: messages });
}

/** The stat cell wrapping a label, so a value can be asserted against its own label. */
const statCell = (label: string) => screen.getByText(label).closest("div");

beforeEach(() => {
  fetchMock.mockReset();
  serve(VIEW);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BlastRadiusCard — the four states are four different things", () => {
  it("shows a skeleton while the view is in flight, and nothing from the other states", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();

    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText(messages.failed)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.unavailable)).not.toBeInTheDocument();
    // Nothing that could spend money exists while we are still reading.
    expect(screen.queryByRole("button", { name: messages.explain })).not.toBeInTheDocument();
  });

  it("shows the failure note on an API error, and not the empty state", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: "internal", message: "boom" } }),
      text: async () => "",
    });
    renderCard();

    expect(await screen.findByText(messages.failed)).toBeInTheDocument();
    expect(screen.queryByText(messages.unavailable)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.stat.callers)).not.toBeInTheDocument();
  });

  /**
   * The disabled-query fall-through. With no `prId` the query is
   * `enabled: false`, and a disabled TanStack v5 query reports
   * `isLoading === false` with `data === undefined`
   * (`client/INSIGHTS.md:490-517`) — so this must land on the empty state, not
   * on the failure, and it must not have asked the API anything.
   */
  it("shows the empty state, not the error, when there is no PR id", () => {
    renderCard(null);

    expect(screen.getByText(messages.unavailable)).toBeInTheDocument();
    expect(screen.queryByText(messages.failed)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the card AND a banner carrying the reason when the index is not full", async () => {
    const reason = "The repository index is partial: 412 of 1,102 files were indexed.";
    serve({ ...VIEW, status: "partial", reason });
    renderCard();

    expect(await screen.findByText(reason)).toBeInTheDocument();
    // A banner INSTEAD of the card would be the mask this branch order forbids.
    expect(statCell(messages.stat.callers)).toHaveTextContent(/^2\s*callers$/);
    expect(screen.getByText("ReviewService")).toBeInTheDocument();
    expect(screen.queryByText(messages.failed)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.unavailable)).not.toBeInTheDocument();
  });

  it("says so when symbols were found and nothing calls them", async () => {
    serve({
      ...VIEW,
      symbols: [{ ...SYMBOL, callers: [], caller_count: 0, endpoints: [] }],
      totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
    });
    renderCard();

    expect(await screen.findByText("1 changed symbol(s), no downstream callers found."))
      .toBeInTheDocument();
    // Not an error and not "nothing to show" — the index answered.
    expect(screen.queryByText(messages.failed)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.unavailable)).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — the answer itself", () => {
  it("renders the totals, the per-symbol disclosure and the endpoint chip", async () => {
    renderCard();

    expect(await screen.findByText("ReviewService")).toBeInTheDocument();
    expect(statCell(messages.stat.symbols)).toHaveTextContent(/^1\s*symbols$/);
    expect(statCell(messages.stat.callers)).toHaveTextContent(/^2\s*callers$/);
    expect(statCell(messages.stat.endpoints)).toHaveTextContent(/^1\s*endpoints$/);
    expect(statCell(messages.stat.crons)).toHaveTextContent(/^0\s*cron\/jobs$/);

    expect(screen.getByText("2 callers")).toBeInTheDocument();
    expect(screen.getByText("POST /pulls/:id/review")).toBeInTheDocument();
    // `noDownstream` is the zero-caller state and must not appear here.
    expect(screen.queryByText(/no downstream callers/i)).not.toBeInTheDocument();
  });

  /**
   * Acceptance criterion 3: clicking a `file:line` opens that exact line.
   *
   * The line came out of the index, so it is only true at the commit the index
   * was built from — `link_sha`. Both the literal and the head-sha negative are
   * asserted: a builder that quietly stops appending `#L<line>` still agrees with
   * itself, and a card that quietly goes back to `head_sha` still produces a
   * perfectly well-formed URL onto the wrong line.
   */
  it("links a caller row to the exact line on the INDEXED sha, not the PR head", async () => {
    renderCard();

    const link = await screen.findByRole("link", { name: "server/src/app.ts:83" });
    const expected = githubBlobUrl(
      VIEW.repo_full_name,
      LINK_SHA,
      "server/src/app.ts",
      83,
    );

    expect(expected).toBe(
      "https://github.com/Holubinka/dev-digest/blob/66727c85ce06/server/src/app.ts#L83",
    );
    expect(link).toHaveAttribute("href", expected);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).not.toHaveAttribute(
      "href",
      githubBlobUrl(VIEW.repo_full_name, HEAD_SHA, "server/src/app.ts", 83),
    );
  });

  /** The stale-index note, so a link opening an older tree is explained, not a surprise. */
  it("says which commit the links open when the index lags the PR head", async () => {
    renderCard();

    expect(
      await screen.findByText(
        "Line numbers come from indexed commit 66727c8, not the pull request head, so links open that commit.",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing about the commit when the index is at the PR head", async () => {
    serve({ ...VIEW, link_sha: HEAD_SHA, index_matches_head: true });
    renderCard();

    const link = await screen.findByRole("link", { name: "server/src/app.ts:83" });
    expect(link).toHaveAttribute(
      "href",
      githubBlobUrl(VIEW.repo_full_name, HEAD_SHA, "server/src/app.ts", 83),
    );
    expect(screen.queryByText(/indexed commit/i)).not.toBeInTheDocument();
  });

  /**
   * No `link_sha` means no commit at which these lines are true. Plain text is
   * the honest render — a link to `head_sha` would open a real page showing the
   * wrong line, which is worse than no link at all.
   */
  it("degrades every caller to plain text when the index knows no commit", async () => {
    serve({ ...VIEW, link_sha: null, index_matches_head: false });
    renderCard();

    expect(await screen.findByText("server/src/app.ts:83")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "server/src/app.ts:83" })).not.toBeInTheDocument();
    expect(screen.queryByText(/indexed commit/i)).not.toBeInTheDocument();
  });

  /**
   * "1 callers" is the bug class `client/INSIGHTS.md:243-246` already records, so
   * both plural branches are pinned rather than the plural one alone — a
   * hard-coded "callers" passes the two-caller assertion above forever.
   */
  it("says '1 caller' for one and '2 callers' for two", async () => {
    serve({
      ...VIEW,
      symbols: [
        { ...SYMBOL, callers: [SYMBOL.callers[0]!], caller_count: 1 },
        { ...SYMBOL, name: "reapStaleRuns", line: 118 },
      ],
      totals: { ...VIEW.totals, symbols: 2, callers: 3 },
    });
    renderCard();

    expect(await screen.findByText("1 caller")).toBeInTheDocument();
    expect(screen.getByText("2 callers")).toBeInTheDocument();
    expect(screen.queryByText("1 callers")).not.toBeInTheDocument();
  });

  /** A path a link cannot be built for is still shown — as text, not as a dead link. */
  it("degrades a caller whose link cannot be built to plain text", async () => {
    serve({
      ...VIEW,
      symbols: [
        {
          ...SYMBOL,
          callers: [{ file: "../outside/app.ts", symbol: "buildApp", line: 7, rank: 0.5 }],
          caller_count: 1,
        },
      ],
    });
    renderCard();

    expect(await screen.findByText("../outside/app.ts:7")).toBeInTheDocument();
    expect(githubBlobUrl(VIEW.repo_full_name, LINK_SHA, "../outside/app.ts", 7)).toBeUndefined();
    expect(screen.queryByRole("link", { name: "../outside/app.ts:7" })).not.toBeInTheDocument();
    // …and not a <button> with nothing behind it either.
    expect(screen.queryByRole("button", { name: "../outside/app.ts:7" })).not.toBeInTheDocument();
  });

  /** The per-symbol cap is stated, so 20 rows under a "37 callers" label is not a silent lie. */
  it("says how many callers were dropped by the cap", async () => {
    serve({
      ...VIEW,
      symbols: [{ ...SYMBOL, caller_count: 37, truncated: true }],
      totals: { ...VIEW.totals, callers: 37 },
    });
    renderCard();

    expect(await screen.findByText("Showing the top 2 of 37 callers by rank.")).toBeInTheDocument();
    expect(screen.getByText("37 callers")).toBeInTheDocument();
  });

  /**
   * The endpoint list is capped by the server at 20 per symbol, because its
   * length is repository content — one entry per route registration in every
   * caller file. Twenty badges under a symbol that reaches nine hundred routes is
   * the same silent lie the caller cap is guarded against above.
   */
  it("says how many endpoints were dropped by the cap", async () => {
    serve({
      ...VIEW,
      symbols: [{ ...SYMBOL, endpoint_count: 900, endpoints_truncated: true }],
      totals: { ...VIEW.totals, endpoints: 900 },
    });
    renderCard();

    expect(await screen.findByText("Showing 1 of 900 endpoints and crons.")).toBeInTheDocument();
    // The stat row is not capped: it is the count the answer actually knows.
    expect(statCell(messages.stat.endpoints)).toHaveTextContent(/^900\s*endpoints$/);
  });
});

/**
 * The list is the only part of this card that grows with the answer, and on
 * PR #20 it grows to 365 symbols — measured at 22 617px of card beside a
 * 1 719px INTENT before it was capped.
 *
 * jsdom lays nothing out, so a pixel is not assertable here and the number
 * itself is deliberately not asserted. What is asserted is the contract that
 * makes a capped list usable: it holds the whole answer, it is a box that
 * scrolls, a keyboard can reach that box, and the counters that say how much is
 * below the fold sit ABOVE it and outside it.
 */
describe("BlastRadiusCard — a long list scrolls inside the card, not down the page", () => {
  const symbols = (n: number): BlastSymbol[] =>
    Array.from({ length: n }, (_, i) => ({
      ...SYMBOL,
      name: `Symbol${i}`,
      line: i + 1,
      callers: [],
      caller_count: 0,
      endpoints: [],
      endpoint_count: 0,
    }));

  /** `client/INSIGHTS.md:120` — placement asserted as document order. */
  const follows = (first: Element, second: Element) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("keeps 60 symbols in one reachable scroll box, with the totals above it", async () => {
    serve({ ...VIEW, symbols: symbols(60), totals: { ...VIEW.totals, symbols: 60 } });
    renderCard();

    const list = await screen.findByRole("region", { name: messages.symbolList });

    // Capped, not truncated: every symbol is still there to be scrolled to.
    expect(within(list).getAllByText(/^Symbol\d+$/)).toHaveLength(60);
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.maxHeight).toMatch(/^\d+px$/);

    // In jsdom `focus()` moves nothing unless the element really is focusable,
    // so this fails on the bare <div> a scroll box would otherwise be. No
    // browser makes a scroller focusable once it holds focusable children, and
    // this one holds 60 <summary> elements.
    list.focus();
    expect(list).toHaveFocus();

    // The count that explains the scrollbar must not scroll away with it.
    const totals = statCell(messages.stat.symbols);
    expect(totals).toHaveTextContent(/^60\s*symbols$/);
    expect(totals && list.contains(totals)).toBe(false);
    expect(totals && follows(totals, list)).toBe(true);
  });
});

describe("BlastRadiusCard — tree | graph", () => {
  it("starts on tree, with no modal and nothing drawn", async () => {
    renderCard();

    expect(await screen.findByRole("button", { name: messages.view.tree })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: messages.view.graph })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /**
   * The whole reason the graph is a modal and not a swapped card body: this is
   * the real PR #12 answer, and the sentence asserted here is the one that keeps
   * a capped graph from reading as the whole map.
   */
  it("opens the graph over the live answer and states what it left out", async () => {
    serve(LIVE);
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: messages.view.graph }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Showing 6 of 18 changed symbols with callers, 8 of 19 call sites and 10 of 10 endpoints.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: messages.graph.ariaLabel }),
    ).toBeInTheDocument();
    // The tree is not replaced — it is still the card, behind the modal, with
    // every one of the 30 symbols the graph could only draw 6 of.
    expect(statCell(messages.stat.symbols)).toHaveTextContent(/^30\s*symbols$/);
    expect(screen.getAllByText("ReviewService").length).toBeGreaterThan(0);
  });

  it("closes the modal when the tree half is pressed again", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: messages.view.graph }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: messages.view.tree }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.view.tree })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * A force layout given no links draws nothing and says nothing — an empty
   * canvas is indistinguishable from one that failed to start. Symbols with
   * nothing downstream must therefore say so in words rather than be handed to
   * the simulation as a graph with no edges.
   */
  it("says there is nothing to graph instead of opening an empty modal", async () => {
    serve({
      ...VIEW,
      symbols: [{ ...SYMBOL, callers: [], caller_count: 0, endpoints: [] }],
      totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: messages.view.graph }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(messages.graph.empty)).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: messages.graph.ariaLabel }),
    ).not.toBeInTheDocument();
    // Nothing to cap, so nothing claimed about caps either.
    expect(within(dialog).queryByText(/^Showing \d+ of/)).not.toBeInTheDocument();
  });

  it("offers no toggle in a state that has no answer to toggle", () => {
    renderCard(null);

    expect(screen.getByText(messages.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.view.graph })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.view.tree })).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — the explanation costs money and waits to be asked", () => {
  it("calls the summary endpoint only on click, then renders the paragraph", async () => {
    renderCard();

    const button = await screen.findByRole("button", { name: messages.explain });
    // Mounting the card must never spend anything.
    expect(fetchMock.mock.calls.some(isSummaryCall)).toBe(false);

    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(isSummaryCall)).toHaveLength(1);
    });
    const [url, init] = fetchMock.mock.calls.find(isSummaryCall) as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/pulls/pr-1/blast/summary");
    expect(init.method).toBe("POST");

    // The paragraph arrives through the query cache the card is rendering from.
    expect(await screen.findByText("One paragraph about ReviewService.")).toBeInTheDocument();
  });

  it("says the explanation failed rather than staying silent", async () => {
    fetchMock.mockImplementation((url: string) =>
      isSummaryCall([url])
        ? Promise.resolve({
            ok: false,
            status: 502,
            json: async () => ({ error: { code: "upstream", message: "no" } }),
            text: async () => "",
          })
        : Promise.resolve(jsonOk(VIEW)),
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: messages.explain }));

    expect(await screen.findByText(messages.explainFailed)).toBeInTheDocument();
    // The card itself is untouched by a failed explanation.
    expect(screen.getByText("ReviewService")).toBeInTheDocument();
  });
});

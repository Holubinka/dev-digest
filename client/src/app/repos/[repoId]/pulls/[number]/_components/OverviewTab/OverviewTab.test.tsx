import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PrFile, RiskBriefRecord } from "@/lib/types";

const hooks = vi.hoisted(() => ({
  usePrIntent: vi.fn(),
  useRecomputeIntent: vi.fn(),
  usePrBrief: vi.fn(),
  useComputeBrief: vi.fn(),
}));

// The specifier must be the one the component imports, not the barrel that
// re-exports it: a mock registered under `@/lib/hooks` does not intercept a
// component importing `@/lib/hooks/core` — Vitest keys the registry by
// resolved module, and the two resolve to different files.
vi.mock("@/lib/hooks/core", () => ({
  usePrIntent: hooks.usePrIntent,
  useRecomputeIntent: hooks.useRecomputeIntent,
}));
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: hooks.usePrBrief,
  useComputeBrief: hooks.useComputeBrief,
}));
// All three cards in the row have their own tests and want providers this file
// does not supply — next-intl for each, plus a QueryClient for BLAST RADIUS,
// which owns its data. What is under test here is the Description beside them
// and the one automatic computation this tab is responsible for.
vi.mock("../IntentCard", () => ({
  IntentCard: () => <div data-testid="intent-card" />,
}));
// The stand-in records `prId`: the card is useless without it, and a prop the
// parent never passes is invisible to `tsc` when it has a default
// (`client/INSIGHTS.md:163-249`).
vi.mock("../BlastRadiusCard", () => ({
  BlastRadiusCard: ({ prId }: { prId: string | null }) => (
    <div data-testid="blast-radius-card" data-pr-id={String(prId)} />
  ),
}));
vi.mock("../PrBriefCard", () => ({
  PrBriefCard: ({ brief, computing }: { brief: unknown; computing: boolean }) => (
    <div
      data-testid="pr-brief-card"
      data-has-brief={String(brief != null)}
      data-computing={String(computing)}
    />
  ),
}));

import { OverviewTab } from "./OverviewTab";

const FILES: PrFile[] = [
  { path: "server/src/modules/brief/service.ts", additions: 210, deletions: 0, patch: null },
];

const HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";

/** Only the fields this tab reads; the card's own test carries a full record. */
const BRIEF = { head_sha: HEAD, risk_level: "high" } as unknown as RiskBriefRecord;

let computeBrief: ReturnType<typeof vi.fn>;

beforeEach(() => {
  hooks.usePrIntent.mockReturnValue({ data: null, isLoading: false, isError: false });
  hooks.useRecomputeIntent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  computeBrief = vi.fn();
  hooks.usePrBrief.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  });
  hooks.useComputeBrief.mockReturnValue({
    mutate: computeBrief,
    isPending: false,
    error: null,
  });
});
afterEach(cleanup);

/**
 * StrictMode is not decoration here. It is the cheapest reproduction of the
 * failure this tab's `useRef` guard exists for: React deliberately runs an
 * effect's setup, cleanup and setup again on mount, so an unguarded
 * "compute when there is none" starts TWO paid model calls for one PR state.
 */
function renderTab(props: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  return render(
    <React.StrictMode>
      <OverviewTab
        prBody={null}
        prId="pr-1"
        headSha={HEAD}
        prFiles={FILES}
        repoFullName="acme/payments-api"
        onOpenFile={vi.fn()}
        {...props}
      />
    </React.StrictMode>,
  );
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

  it("fills the second card slot with BLAST RADIUS, wired to the PR", () => {
    renderTab();

    expect(screen.getByTestId("blast-radius-card")).toHaveAttribute("data-pr-id", "pr-1");
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

  it("puts the Risk Brief first in the row — it answers where to start", () => {
    const { container } = renderTab();
    const row = container.querySelector(".dd-overview-cards")!;

    expect(row.firstElementChild).toBe(screen.getByTestId("pr-brief-card"));
  });
});

describe("OverviewTab — the automatic first computation", () => {
  it("computes a brief for a state the server holds none for, exactly once", () => {
    renderTab();
    expect(computeBrief).toHaveBeenCalledTimes(1);
  });

  it("does not fire again when the tab re-renders for another reason", () => {
    const { rerender } = renderTab();
    expect(computeBrief).toHaveBeenCalledTimes(1);

    rerender(
      <React.StrictMode>
        <OverviewTab
          prBody={BODY}
          prId="pr-1"
          headSha={HEAD}
          prFiles={FILES}
          repoFullName="acme/payments-api"
          onOpenFile={vi.fn()}
        />
      </React.StrictMode>,
    );
    expect(computeBrief).toHaveBeenCalledTimes(1);
  });

  it("computes nothing when the server already holds a brief for this head", () => {
    // AC-28: a stored record is served with zero model calls, however many times
    // it is read.
    hooks.usePrBrief.mockReturnValue({
      data: BRIEF,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderTab();

    expect(computeBrief).not.toHaveBeenCalled();
    expect(screen.getByTestId("pr-brief-card")).toHaveAttribute("data-has-brief", "true");
  });

  it("computes nothing before the query has settled", () => {
    // `undefined` is "we have not asked yet", and firing on it would spend a
    // model call on every mount, including the ones the cache would have served.
    hooks.usePrBrief.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });
    renderTab();

    expect(computeBrief).not.toHaveBeenCalled();
  });

  it("computes again when the pull request moves to a new head", () => {
    // The guard is keyed by `(prId, headSha)`, not a once-per-mount latch: a new
    // head is a new state, and it has no brief of its own.
    const { rerender } = renderTab();
    expect(computeBrief).toHaveBeenCalledTimes(1);

    rerender(
      <React.StrictMode>
        <OverviewTab
          prBody={null}
          prId="pr-1"
          headSha="0000000000000000000000000000000000000000"
          prFiles={FILES}
          repoFullName="acme/payments-api"
          onOpenFile={vi.fn()}
        />
      </React.StrictMode>,
    );
    expect(computeBrief).toHaveBeenCalledTimes(2);
  });

  it("computes nothing while the pull request id is still being resolved", () => {
    renderTab({ prId: null });
    expect(computeBrief).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const hooks = vi.hoisted(() => ({
  usePrIntent: vi.fn(),
  useRecomputeIntent: vi.fn(),
}));

// The specifier must be the one the component imports, not the barrel that
// re-exports it: a mock registered under `@/lib/hooks` does not intercept a
// component importing `@/lib/hooks/core` — Vitest keys the registry by
// resolved module, and the two resolve to different files.
vi.mock("@/lib/hooks/core", () => ({
  usePrIntent: hooks.usePrIntent,
  useRecomputeIntent: hooks.useRecomputeIntent,
}));
// Both cards in the row have their own tests and want providers this file does
// not supply — next-intl for either, plus a QueryClient for BLAST RADIUS, which
// owns its data. What is under test here is the Description beside them.
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

import { OverviewTab } from "./OverviewTab";

beforeEach(() => {
  hooks.usePrIntent.mockReturnValue({ data: null, isLoading: false, isError: false });
  hooks.useRecomputeIntent.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(cleanup);

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
    render(<OverviewTab prBody={BODY} prId="pr-1" />);

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
    render(<OverviewTab prBody={null} prId="pr-1" />);

    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.getByTestId("intent-card")).toBeInTheDocument();
  });

  it("fills the second card slot with BLAST RADIUS, wired to the PR", () => {
    render(<OverviewTab prBody={null} prId="pr-1" />);

    expect(screen.getByTestId("blast-radius-card")).toHaveAttribute("data-pr-id", "pr-1");
  });
});

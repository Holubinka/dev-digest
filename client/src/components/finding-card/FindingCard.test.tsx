import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "@/../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";
import { s } from "./styles";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  /**
   * The card is shared now: the multi-agent results page passes `extraActions`
   * (Learn, Turn into eval case, Reply to author) and the PR page passes none.
   * This case is the PR page's half of that — a third button appearing here for
   * everybody is exactly what the promotion could have done silently, and no
   * other test in this suite counts them.
   */
  it("renders exactly two actions when no extraActions are passed", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    const row = screen.getByRole("button", { name: "Accept" }).parentElement!;
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Accept",
      "Dismiss",
    ]);
  });

  it("renders an extra action after Dismiss when one is passed", () => {
    renderWithIntl(
      <FindingCard
        f={FINDING}
        defaultExpanded
        onAction={() => {}}
        extraActions={<button>Reply to author</button>}
      />,
    );
    const row = screen.getByRole("button", { name: "Accept" }).parentElement!;
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Accept",
      "Dismiss",
      "Reply to author",
    ]);
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  /**
   * `findings.severity` is a plain `text` column, so a value outside the four
   * `SEV` keys can reach this card — `visibleFindings` sorts unknowns last but
   * does not drop them. `SeverityBadge` used to read `SEV[severity].icon` with
   * no fallback and took the whole route down with
   * "Cannot read properties of undefined (reading 'icon')". See INSIGHTS.md,
   * "An unexpected `severity` value takes down the whole findings page".
   */
  it("survives a severity outside the contract instead of taking the route down", () => {
    const stray = { ...FINDING, severity: "NITPICK" as FindingRecord["severity"] };
    expect(() =>
      renderWithIntl(<FindingCard f={stray} defaultExpanded onAction={() => {}} />),
    ).not.toThrow();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("NITPICK")).toBeInTheDocument();
  });
});

describe("FindingCard card style — no border shorthand", () => {
  /**
   * React warns "Updating a style property during rerender (borderColor) when a
   * conflicting property is set (borderLeftColor)" whenever a shorthand and a
   * per-side longhand for the same property live on one element and the
   * shorthand changes. `focused` flips on every j/k press in FindingsPanel, so
   * the card hit this on every keyboard move. Keep every border property
   * per-side.
   */
  it("sets no border shorthand alongside the per-side longhands", () => {
    const style = s.card(true, "var(--crit)", false);
    expect(style).not.toHaveProperty("border");
    expect(style).not.toHaveProperty("borderColor");
    expect(style).not.toHaveProperty("borderWidth");
  });

  it("keeps the severity accent on the left edge in both focus states", () => {
    expect(s.card(true, "var(--crit)", false).borderLeftColor).toBe("var(--crit)");
    expect(s.card(false, "var(--crit)", false).borderLeftColor).toBe("var(--crit)");
  });

  it("paints the other three sides with the focus colour only when focused", () => {
    const focused = s.card(true, "var(--crit)", false);
    expect([focused.borderTopColor, focused.borderRightColor, focused.borderBottomColor]).toEqual([
      "var(--crit)",
      "var(--crit)",
      "var(--crit)",
    ]);
    const idle = s.card(false, "var(--crit)", false);
    expect([idle.borderTopColor, idle.borderRightColor, idle.borderBottomColor]).toEqual([
      "var(--border)",
      "var(--border)",
      "var(--border)",
    ]);
  });

  it("keeps the left edge thicker than the other three", () => {
    const style = s.card(false, "var(--crit)", false);
    expect(style.borderLeftWidth).toBe(3);
    expect(style.borderTopWidth).toBe(1);
  });
});

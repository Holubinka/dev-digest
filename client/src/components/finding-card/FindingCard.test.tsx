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

/**
 * SPEC-05 AC-1 / AC-2 / AC-3. The decision IS the expectation's polarity, so a
 * finding nobody has judged has nothing to make a case out of — and the button
 * says so instead of disappearing. The reason has to be in the ACCESSIBLE NAME,
 * not only in a tooltip: `title` alone is invisible to a screen reader and to
 * anyone on a touch device, which is most of the people the rule protects.
 */
describe("FindingCard — Turn into eval case", () => {
  const ACCEPTED = { ...FINDING, accepted_at: "2026-05-29T09:14:00.000Z" };
  const DISMISSED = { ...FINDING, dismissed_at: "2026-05-29T09:14:00.000Z" };
  const REASON =
    "Turn into eval case — accept or dismiss this finding first, because the decision is what makes the expectation must-find or must-not-flag";

  it("is enabled on an ACCEPTED finding and reports the click", () => {
    const onTurn = vi.fn();
    renderWithIntl(
      <FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={onTurn} />,
    );
    const btn = screen.getByRole("button", { name: "Turn into eval case" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it("is enabled on a DISMISSED finding — noise is asserted as precisely as usefulness", () => {
    const onTurn = vi.fn();
    renderWithIntl(
      <FindingCard f={DISMISSED} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={onTurn} />,
    );
    const btn = screen.getByRole("button", { name: "Turn into eval case" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it("is disabled with the reason in its accessible name when the finding is undecided", () => {
    const onTurn = vi.fn();
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={onTurn} />,
    );
    // Queried BY the reason: the assertion fails both when the button is
    // hidden and when it is inert without saying why.
    const btn = screen.getByRole("button", { name: REASON });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onTurn, "a disabled control must not create a case").not.toHaveBeenCalled();
  });

  it("shows the busy label and is inert while the case is being created", () => {
    const onTurn = vi.fn();
    renderWithIntl(
      <FindingCard
        f={ACCEPTED}
        defaultExpanded
        onAction={() => {}}
        onTurnIntoEvalCase={onTurn}
        evalCasePending
      />,
    );
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Creating eval case…" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onTurn, "a busy control must not fire a second create").not.toHaveBeenCalled();
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
    const style = s.card(true, "var(--crit)");
    expect(style).not.toHaveProperty("border");
    expect(style).not.toHaveProperty("borderColor");
    expect(style).not.toHaveProperty("borderWidth");
  });

  it("keeps the severity accent on the left edge in both focus states", () => {
    expect(s.card(true, "var(--crit)").borderLeftColor).toBe("var(--crit)");
    expect(s.card(false, "var(--crit)").borderLeftColor).toBe("var(--crit)");
  });

  it("paints the other three sides with the focus colour only when focused", () => {
    const focused = s.card(true, "var(--crit)");
    expect([focused.borderTopColor, focused.borderRightColor, focused.borderBottomColor]).toEqual([
      "var(--crit)",
      "var(--crit)",
      "var(--crit)",
    ]);
    const idle = s.card(false, "var(--crit)");
    expect([idle.borderTopColor, idle.borderRightColor, idle.borderBottomColor]).toEqual([
      "var(--border)",
      "var(--border)",
      "var(--border)",
    ]);
  });

  it("keeps the left edge thicker than the other three", () => {
    const style = s.card(false, "var(--crit)");
    expect(style.borderLeftWidth).toBe(3);
    expect(style.borderTopWidth).toBe(1);
  });
});

/**
 * A decided finding used to dim the WHOLE card via `s.card`'s `opacity`,
 * Accept/Dismiss included — nothing there is actually disabled (a decision
 * can switch accept ↔ dismiss any number of times), but a faded button reads
 * as an inert one. The fade now lives on `header`/`contentFade` only; `card`
 * carries no opacity at all, and `actions` is a plain, unparameterized object
 * that no `muted` value can reach.
 */
describe("FindingCard — a decided finding fades its text, not its buttons", () => {
  it("card carries no opacity — the fade moved off the whole-card wrapper", () => {
    expect(s.card(false, "var(--crit)")).not.toHaveProperty("opacity");
  });

  it("header and contentFade dim only when muted", () => {
    expect(s.header(true).opacity).toBe(0.6);
    expect(s.header(false).opacity).toBe(1);
    expect(s.contentFade(true).opacity).toBe(0.6);
    expect(s.contentFade(false).opacity).toBe(1);
  });

  it("actions carries no opacity at all — no muted parameter can dim it", () => {
    expect(s.actions).not.toHaveProperty("opacity");
  });
});

/**
 * `onTurnIntoEvalCase` is optional, and the control is the ONE part of the card
 * that is conditional on a prop rather than on the finding. Every other mount
 * of FindingCard omits it, so a card that grew the button unconditionally would
 * offer to create an eval case with nothing behind the click.
 */
describe("FindingCard — no eval-case control without the handler", () => {
  const ACCEPTED = { ...FINDING, accepted_at: "2026-05-29T09:14:00.000Z" };

  it("omits the button on a DECIDED finding when no handler is given", () => {
    // Decided on purpose: an undecided finding renders the button disabled, so
    // this would pass for the wrong reason on `FINDING`.
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);

    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /accept or dismiss this finding first/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Turn into eval case/)).not.toBeInTheDocument();

    // The other two actions are unaffected — the card is not simply collapsed.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing client test uses `fireEvent`.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/brief.json";
import type { IntentRecord } from "@/lib/types";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const RECORD: IntentRecord = {
  intent: "Rate-limit the public pricing API",
  in_scope: ["Add a per-token limiter", "Return 429 with Retry-After"],
  out_of_scope: ["Billing changes"],
  risk_areas: ["security", "performance"],
  confidence: "high",
  evidence: ["title", "body", "linked_issue", "plan_spec"],
  plan_refs: ["specs/05-intent-layer.md"],
  provider: "openrouter",
  model: "z-ai/glm-4.7-flash",
  computed_at: "2026-08-05T10:00:00.000Z",
};

function renderCard(props: Partial<React.ComponentProps<typeof IntentCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <IntentCard
        intent={RECORD}
        isLoading={false}
        isError={false}
        onRecompute={() => {}}
        recomputing={false}
        riskAreas={<div data-testid="risk-areas" />}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard — the four states are four different things", () => {
  it("shows a skeleton while loading, and no copy from the other three states", () => {
    const { container } = renderCard({ intent: undefined, isLoading: true });

    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText(messages.intent.unavailable)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.intent.failed)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an inline failure note plus a working button on error", () => {
    const onRecompute = vi.fn();
    renderCard({ intent: undefined, isError: true, onRecompute });

    expect(screen.getByText(messages.intent.failed)).toBeInTheDocument();
    // The failure is NOT the empty state.
    expect(screen.queryByText(messages.intent.unavailable)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: messages.intent.recompute }));
    expect(onRecompute).toHaveBeenCalledTimes(1);
  });

  /** A `null` record is "never computed", not a failure — the distinction the API is explicit about. */
  it("shows the empty state, not the error, when the intent is null", () => {
    renderCard({ intent: null });

    expect(screen.getByText(messages.intent.unavailable)).toBeInTheDocument();
    expect(screen.getByText(messages.intent.unavailableHint)).toBeInTheDocument();
    expect(screen.queryByText(messages.intent.failed)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.intent.recompute })).toBeEnabled();
  });

  /**
   * The card is INTENT, and the only two things that derive one are a review
   * run and the button on this card. The `brief.*` scaffolding it used to
   * borrow says "Brief not available yet" and promises that opening the PR
   * computes it — a name that is not this card's and behaviour that does not
   * exist. Both halves are pinned here.
   */
  it("describes the empty state as an intent, and promises only what really derives one", () => {
    renderCard({ intent: null });

    expect(screen.queryByText(messages.unavailable)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.unavailableHint)).not.toBeInTheDocument();
    expect(screen.getByText(messages.intent.unavailable)).toHaveTextContent(/intent/i);
    expect(screen.getByText(messages.intent.unavailableHint)).toHaveTextContent(
      new RegExp(messages.intent.recompute, "i"),
    );
  });

  it("renders the goal, both scope lists and the model", () => {
    renderCard();

    expect(screen.getByText(`“${RECORD.intent}”`)).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
    expect(screen.getByText(messages.intent.inScope)).toBeInTheDocument();
    expect(screen.getByText(messages.intent.outOfScope)).toBeInTheDocument();
    for (const item of [...RECORD.in_scope, ...RECORD.out_of_scope]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(screen.getByText(`via ${RECORD.model}`)).toBeInTheDocument();
  });

  /**
   * The lists rendered as a wall of text: the global reset takes `ul` down to
   * `list-style: none`, so the 18px indent reserved room for a marker that
   * never appeared, and every `li` sat at `margin-bottom: 0` with the next one
   * flush underneath. Two separate regressions, so two separate assertions.
   */
  it("gives every scope item a marker and space from the item below it", () => {
    renderCard();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(RECORD.in_scope.length + RECORD.out_of_scope.length);

    for (const item of items) {
      expect(item).toHaveStyle({ marginBottom: "6px" });
      const list = item.closest("ul");
      expect(getComputedStyle(list as HTMLElement).listStyleType).toContain("·");
    }
  });

  it("renders one button, Recompute, and no chip row of its own", () => {
    renderCard();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

/**
 * `Intent.risk_areas` is DELIBERATELY not drawn any more (D18): two sections
 * called "risk areas", one grounded against the repository index and one not,
 * is what the amendment removes. The field stays in the contract and in the
 * record — only this card stops rendering it — and the slot below carries the
 * BRIEF's risks instead.
 */
describe("IntentCard — RISK AREAS is a slot, not the intent's own chips", () => {
  it("does not draw the intent's own risk areas", () => {
    renderCard();

    for (const area of RECORD.risk_areas) {
      expect(screen.queryByText(area)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(messages.intent.riskAreas)).not.toBeInTheDocument();
  });

  it.each([
    ["the loaded intent", {}],
    ["a loading intent", { intent: undefined, isLoading: true }],
    ["a failed intent", { intent: undefined, isError: true }],
    ["no intent derived", { intent: null }],
  ])("fills the slot in %s", (_label, props) => {
    // The producer of RISK AREAS is the brief, not the intent, so a section
    // that vanished with the intent would report the wrong thing's absence.
    renderCard(props as Partial<React.ComponentProps<typeof IntentCard>>);
    expect(screen.getByTestId("risk-areas")).toBeInTheDocument();
  });

  it("renders nothing extra when the slot is not filled", () => {
    renderCard({ riskAreas: undefined });
    expect(screen.queryByTestId("risk-areas")).not.toBeInTheDocument();
  });
});

describe("IntentCard — degrading rather than crashing", () => {
  it("renders an empty in_scope as its label and an em dash, with no invented bullet", () => {
    renderCard({ intent: { ...RECORD, in_scope: [], out_of_scope: ["Billing changes"] } });

    expect(screen.getByText(messages.intent.inScope)).toBeInTheDocument();
    expect(screen.getByText(messages.intent.none)).toBeInTheDocument();
    // The one remaining bullet is out_of_scope's; nothing was fabricated for in_scope.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("IntentCard — recompute", () => {
  it("calls onRecompute once per click and disables the button while recomputing", () => {
    const onRecompute = vi.fn();
    const { rerender } = renderCard({ onRecompute });

    fireEvent.click(screen.getByRole("button", { name: messages.intent.recompute }));
    expect(onRecompute).toHaveBeenCalledTimes(1);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <IntentCard
          intent={RECORD}
          isLoading={false}
          isError={false}
          onRecompute={onRecompute}
          recomputing
        />
      </NextIntlClientProvider>,
    );

    const button = screen.getByRole("button", { name: messages.intent.computing });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRecompute).toHaveBeenCalledTimes(1);
  });
});

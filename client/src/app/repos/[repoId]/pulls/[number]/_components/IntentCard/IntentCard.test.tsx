import { describe, it, expect, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing client test uses `fireEvent`.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/brief.json";
import type { IntentRecord } from "@/lib/types";
import { IntentCard } from "./IntentCard";
import { riskIcon, RISK_ICON_FALLBACK } from "./constants";

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

  it("renders the goal, both scope lists, the risk badges and the model", () => {
    renderCard();

    expect(screen.getByText(`“${RECORD.intent}”`)).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
    expect(screen.getByText(messages.intent.inScope)).toBeInTheDocument();
    expect(screen.getByText(messages.intent.outOfScope)).toBeInTheDocument();
    for (const item of [...RECORD.in_scope, ...RECORD.out_of_scope]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    for (const area of RECORD.risk_areas) {
      expect(screen.getByText(area)).toBeInTheDocument();
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

  /**
   * A risk area is a <span> Badge, never a <Chip>: `Chip` renders a <button>
   * (`vendor/ui/primitives/Chip.tsx:22`) and a button with no action is an
   * accessibility defect. The only buttons on the card are Recompute.
   */
  it("renders risk areas as non-interactive elements", () => {
    renderCard();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("security").closest("button")).toBeNull();
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

  it("renders an unrecognised risk area with the fallback icon and does not throw", () => {
    renderCard({ intent: { ...RECORD, risk_areas: ["quantum flux"] } });

    const badge = screen.getByText("quantum flux");
    expect(badge).toBeInTheDocument();
    // An icon was resolved: the fallback, since nothing maps this string.
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(riskIcon("quantum flux")).toBe(RISK_ICON_FALLBACK);
  });

  /**
   * The prototype-chain half of the same defect: `"constructor" in OBJ` is true,
   * so an allowlist built with `in` is not one (`client/INSIGHTS.md:594-618`).
   * Naming the inherited keys is what makes this test fail before the fix.
   */
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "resolves the inherited key %s to the fallback icon",
    (key) => {
      expect(riskIcon(key)).toBe(RISK_ICON_FALLBACK);
    },
  );

  it("still maps a known risk area, case- and space-insensitively", () => {
    expect(riskIcon("  Security ")).toBe("Shield");
    expect(riskIcon("security")).not.toBe(RISK_ICON_FALLBACK);
  });

  /**
   * Every string here is verbatim model output taken from `pr_intent` on this
   * workspace. The exact-match table this replaced resolved only two of them and
   * gave the rest the same triangle — which is the whole defect, so the cases are
   * the real phrases rather than the tidy keywords a table would like to receive.
   */
  it.each([
    ["public API", "Code"],
    ["client-server contract", "Code"],
    ["performance", "Zap"],
    ["tests", "FlaskConical"],
    ["PR list grid layout", "Layers"],
    ["Text overflow in findings cell", "Layers"],
    ["Client-side conventions UI (new page, modals, shell integration)", "Layers"],
    ["Conventions extraction pipeline (model hallucination, quote verification gates)", "Workflow"],
    ["Feature models configuration", "Wrench"],
  ])("maps the real phrase %j to %s", (phrase, icon) => {
    expect(riskIcon(phrase)).toBe(icon);
  });

  it("lets an earlier rule win: a security phrase that also mentions the API", () => {
    expect(riskIcon("auth bypass on the public API")).toBe("Shield");
  });

  it("does not match a keyword buried inside a longer word", () => {
    // \b is what keeps `ui` out of "building" and `job` out of "jobless".
    expect(riskIcon("building the sidebar")).toBe(RISK_ICON_FALLBACK);
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

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { VerdictBanner } from "./VerdictBanner";

afterEach(cleanup);

/** The row holding the verdict label, the counts badge and the ⓘ. */
const titleRow = () => screen.getByText("Request changes").parentElement as HTMLElement;

const follows = (first: HTMLElement, second: HTMLElement) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VerdictBanner (smoke)", () => {
  it("shows verdict label + score + finding/blocker counts", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="Hardcoded secret introduced."
        score={42}
        findingsCount={1}
        blockers={1}
        agentName="Security Reviewer"
      />,
    );
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/1 findings · 1 blockers/)).toBeInTheDocument();
  });

  it("carries the run's cost and token flow when they are known", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="approve"
        summary={null}
        score={90}
        findingsCount={0}
        blockers={0}
        costUsd={0.014}
        tokensIn={8200}
        tokensOut={1300}
      />,
    );
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText("8k→1.3k")).toBeInTheDocument();
  });

  it("omits the cost row entirely when no run cost is known", () => {
    renderWithIntl(
      <VerdictBanner verdict="approve" summary={null} score={90} findingsCount={0} blockers={0} />,
    );
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

/**
 * Where each piece sits, against `specs/assets/SPEC-02-pr-brief-overview.png`.
 * Every one of these passed as a presence assertion before the layout was moved
 * — the design's requirement is the PLACE, so the place is what is asserted.
 */
describe("VerdictBanner — the places the design puts things", () => {
  const banner = (props: Partial<React.ComponentProps<typeof VerdictBanner>> = {}) =>
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="A Stripe key is committed in plaintext."
        score={61}
        findingsCount={6}
        blockers={2}
        costUsd={0.014}
        tokensIn={8200}
        tokensOut={1300}
        {...props}
      />,
    );

  it("explains the two counts beside them, and says something true about both", () => {
    banner();

    const hint = screen.getByLabelText(messages.verdict.countsHint);
    expect(within(titleRow()).getByLabelText(messages.verdict.countsHint)).toBe(hint);
    // Not decoration: it carries the one thing the numbers do not say for
    // themselves — that the second is a subset of the first, and which subset.
    expect(hint).toHaveAttribute("title", messages.verdict.countsHint);
  });

  it("puts the cost under the gauge, not in the title row beside the counts", () => {
    banner();

    const cost = screen.getByText("$0.014");
    expect(within(titleRow()).queryByText("$0.014")).not.toBeInTheDocument();
    expect(follows(screen.getByText("PR SCORE"), cost)).toBe(true);
    expect(follows(screen.getByText("PR SCORE"), screen.getByText("8k→1.3k"))).toBe(true);
  });

  it("puts an action slot inside the card, left of the gauge", () => {
    const { container } = banner({ action: <button type="button">Regenerate brief</button> });

    const card = container.firstElementChild as HTMLElement;
    const action = screen.getByRole("button", { name: "Regenerate brief" });

    // INSIDE the card — the same element the verdict and the gauge are in, not a
    // sibling standing to the right of it, which is where it used to be.
    expect(card).toContainElement(action);
    expect(within(card).getByText("Request changes")).toBeInTheDocument();
    expect(follows(action, screen.getByText("PR SCORE"))).toBe(true);
    // And out of the prose: it is a control on the card, not part of the summary.
    expect(within(titleRow()).queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * `ReviewRunAccordion` renders this banner per run and passes no action. The
   * slot is what keeps that surface unchanged by construction rather than by
   * inspection.
   */
  it("renders no control at all when no action is passed", () => {
    banner();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

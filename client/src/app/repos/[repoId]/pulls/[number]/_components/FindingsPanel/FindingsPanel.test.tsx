import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// Hoisted so a test can assert the shortcut did (or did not) fire an action.
const mutate = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop queries once per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("renders only the selected severity when one is set", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severity="WARNING" />);
    expect(screen.getByText("N+1 query in user list")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("keeps the keyboard focus inside the list when a filter shrinks it", () => {
    // Focus the second card with `j`, then narrow to a single-item list: the
    // focused index must clamp back, or nothing is focused and `k` has to be
    // pressed several times before anything responds.
    const { rerender } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.keyDown(window, { key: "j" });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" severity="CRITICAL" />
      </NextIntlClientProvider>,
    );
    const cards = document.querySelectorAll<HTMLElement>("[data-finding-id]");
    expect(cards).toHaveLength(1);
    // FindingCard marks the focused card with a ring; "none" means nothing is.
    expect(cards[0]!.style.boxShadow).not.toBe("none");
  });

  it("renders every severity when no filter is set", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severity={null} />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query in user list")).toBeInTheDocument();
  });
});

/**
 * Arriving from a Smart Diff severity chip: the diff tab hands a finding id up
 * to the page, which puts it in `?finding=` and switches to Agent runs. This is
 * the far end of that trip.
 */
describe("FindingsPanel jump-to-finding", () => {
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("scrolls to the targeted finding's card, not to the first one", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" />);
    const target = document.querySelector('[data-finding-id="f2"]');
    expect(target).not.toBeNull();
    expect(scrolled).toEqual([target]);
  });

  it("focuses the targeted card so the shortcuts act on it", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" />);
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledWith({ findingId: "f2", action: "accept", prId: "pr1" });
  });

  it("expands the targeted card even when it is not the first", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" />);
    expect(screen.getByText("The loop queries once per user.")).toBeInTheDocument();
  });

  it("lifts hide-low-confidence on arrival rather than scrolling to a hidden card", () => {
    // f3 sits under the 0.5 confidence cut, so "Hide low confidence" would drop
    // it from the list it is being navigated to.
    const low: FindingRecord = { ...FINDINGS[1]!, id: "f3", title: "Flaky guess", confidence: 0.2 };
    renderWithIntl(<FindingsPanel findings={[...FINDINGS, low]} prId="pr1" targetFindingId="f3" />);
    expect(screen.getByText("Flaky guess")).toBeInTheDocument();
  });

  it("leaves the filter usable after the jump — the lift is a one-shot", () => {
    // Keyed on `hideLow` instead of on the arriving id, the effect re-fires the
    // moment the reader turns the filter back on, and the switch is dead for the
    // rest of the visit: `?finding=` is never cleared.
    const low: FindingRecord = { ...FINDINGS[1]!, id: "f3", title: "Flaky guess", confidence: 0.2 };
    renderWithIntl(<FindingsPanel findings={[...FINDINGS, low]} prId="pr1" targetFindingId="f3" />);
    expect(screen.getByText("Flaky guess")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Flaky guess")).not.toBeInTheDocument();
  });

  it("does nothing when the target belongs to another run", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="elsewhere" />);
    expect(scrolled).toEqual([]);
  });
});

/**
 * The shortcut listener is bound to `window`, so every mounted panel used to
 * answer the same keypress. `active` makes exactly one of them respond —
 * FindingsTab picks it. See FindingsTab.test.tsx for the multi-run regression.
 */
describe("FindingsPanel keyboard ownership", () => {
  it("acts on the focused finding when it is the active panel", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
  });

  it("ignores j/k/a/d entirely when it is not the active panel", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" active={false} />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "d" });
    expect(mutate).not.toHaveBeenCalled();
    // …and focus did not move either.
    const cards = document.querySelectorAll<HTMLElement>("[data-finding-id]");
    expect(cards[0]!.style.boxShadow).not.toBe("none");
  });

  it("shows the shortcut hint only on the panel the keys drive", () => {
    const { unmount } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("j/k to move · a accept · d dismiss")).toBeInTheDocument();
    unmount();
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" active={false} />);
    expect(screen.queryByText("j/k to move · a accept · d dismiss")).not.toBeInTheDocument();
  });
});

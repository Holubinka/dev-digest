import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { ListFinding } from "@devdigest/shared";
import { FindingsPreview, type SeverityCount } from "./FindingsPreview";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const COUNTS: SeverityCount[] = [
  { sev: "CRITICAL", n: 1 },
  { sev: "WARNING", n: 2 },
  { sev: "SUGGESTION", n: 0 },
];

const LABEL = "1 critical, 2 warning, 0 suggestion";

const FINDING: ListFinding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  confidence: 0.98,
  rationale: "Line 12 contains a literal sk_live_ Stripe key.",
};

function renderPreview(over: Partial<React.ComponentProps<typeof FindingsPreview>> = {}) {
  return render(
    <FindingsPreview
      counts={COUNTS}
      findings={[FINDING]}
      header="3 finding(s)"
      ariaLabel={LABEL}
      {...over}
    />,
  );
}

/** The card wraps the scrollable list; the list is the only role-bearing part. */
function card() {
  return screen.getByRole("list").parentElement!;
}

/** Past the grace period the card allows for crossing the gap below the chips. */
function settleClose() {
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe("FindingsPreview", () => {
  it("renders one chip per count, under the caller's aria-label", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    expect(group).toBeInTheDocument();
    expect(group.textContent).toBe("120");
  });

  it("lists the findings on hover, under the caller's header", () => {
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("opens the same card on keyboard focus", () => {
    renderPreview();
    fireEvent.focus(screen.getByLabelText(LABEL));
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("hides the card again once the cursor has left for good", () => {
    vi.useFakeTimers();
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.mouseEnter(group);
    fireEvent.mouseLeave(group);
    settleClose();
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  // The card sits an 8px gap below the chips, so leaving them is how you reach
  // it. Closing on that would make the card unscrollable and unclickable.
  it("stays open when the cursor crosses the gap into the card", () => {
    vi.useFakeTimers();
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.mouseEnter(group);
    fireEvent.mouseLeave(group);
    fireEvent.mouseEnter(card());
    settleClose();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  // The pending close is a `setTimeout`, so unmounting mid-grace-period must not
  // leave it armed to fire against a dead instance.
  it("disarms a pending close when it unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.mouseEnter(group);
    fireEvent.mouseLeave(group);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => settleClose()).not.toThrow();
  });

  it("closes once the cursor leaves the card itself", () => {
    vi.useFakeTimers();
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    const el = card();
    fireEvent.mouseEnter(el);
    fireEvent.mouseLeave(el);
    settleClose();
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("hides the card again on blur", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.focus(group);
    fireEvent.blur(group);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  // Tabbing from the chips to a finding's link keeps focus inside the trigger's
  // subtree; closing there would yank the link out from under the Tab.
  it("stays open when focus moves to a link inside it", () => {
    renderPreview({ repoFullName: "acme/dev-digest", headSha: "abc123" });
    const group = screen.getByLabelText(LABEL);
    fireEvent.focus(group);
    fireEvent.blur(group, { relatedTarget: screen.getByTitle("src/config.ts:12") });
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  // The card is position:fixed, so a page scroll would leave it floating beside
  // a row that has moved on.
  it("closes when the page scrolls behind it", () => {
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    fireEvent.scroll(document);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  // `Node.contains` throws on a non-Node, which would abort the handler before
  // it ever closed the card.
  it("closes on a scroll dispatched straight at window", () => {
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("opens no card when there is nothing to list", () => {
    renderPreview({ findings: [], header: "0 finding(s)" });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.queryByText("0 finding(s)")).not.toBeInTheDocument();
  });

  it("renders the extra slot after the chips", () => {
    renderPreview({ extra: <span>blockers-slot</span> });
    expect(screen.getByText("blockers-slot")).toBeInTheDocument();
  });

  it("elides a long path from the left so it stays inside the card", () => {
    const long = "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx";
    renderPreview({
      findings: [{ ...FINDING, file: long, start_line: 30, end_line: 45 }],
    });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    const shown = screen.getByTitle(`${long}:30-45`);
    expect(shown.textContent).toBe("…/_components/FindingsPanel/FindingsPanel.tsx:30-45");
  });

  it("links a finding to its file, pinned to the head sha", () => {
    renderPreview({
      repoFullName: "acme/dev-digest",
      headSha: "abc123",
      findings: [{ ...FINDING, start_line: 30, end_line: 45 }],
    });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.getByTitle("src/config.ts:30-45")).toHaveAttribute(
      "href",
      "https://github.com/acme/dev-digest/blob/abc123/src/config.ts#L30-L45",
    );
  });

  it("leaves the citation inert when the repo or head sha is unknown", () => {
    renderPreview({ repoFullName: "acme/dev-digest" });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.getByTitle("src/config.ts:12").tagName).toBe("SPAN");
  });

  // `findings.file` is agent-written text. A path that would resolve out of the
  // repo gets no link rather than a link the citation does not describe.
  it("shows an unlinkable path as plain text, still citing it in full", () => {
    renderPreview({
      repoFullName: "acme/dev-digest",
      headSha: "abc123",
      findings: [{ ...FINDING, file: "../../../../attacker/repo/blob/main/README.md" }],
    });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    const cited = screen.getByTitle("../../../../attacker/repo/blob/main/README.md:12");
    expect(cited.tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("tells the caller when the card opens, so it can load the rest", () => {
    const onOpenChange = vi.fn();
    renderPreview({ onOpenChange });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  describe("scrolling", () => {
    const many: ListFinding[] = Array.from({ length: 25 }, (_, i) => ({
      ...FINDING,
      id: `f${i}`,
      title: `Finding ${i}`,
    }));

    /** jsdom lays nothing out, so the scroll geometry has to be asserted onto it. */
    function scrollNearEnd(body: HTMLElement) {
      Object.defineProperty(body, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(body, "clientHeight", { value: 300, configurable: true });
      Object.defineProperty(body, "scrollTop", { value: 600, configurable: true });
      fireEvent.scroll(body);
    }

    it("renders one page of findings at a time", () => {
      renderPreview({ findings: many });
      fireEvent.mouseEnter(screen.getByLabelText(LABEL));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
    });

    it("extends the list as it is scrolled, without closing", () => {
      renderPreview({ findings: many });
      fireEvent.mouseEnter(screen.getByLabelText(LABEL));
      scrollNearEnd(screen.getByRole("list"));
      expect(screen.getAllByRole("listitem")).toHaveLength(20);
      scrollNearEnd(screen.getByRole("list"));
      expect(screen.getAllByRole("listitem")).toHaveLength(25);
    });

    it("stops at the end rather than padding the list", () => {
      renderPreview({ findings: many.slice(0, 12) });
      fireEvent.mouseEnter(screen.getByLabelText(LABEL));
      scrollNearEnd(screen.getByRole("list"));
      scrollNearEnd(screen.getByRole("list"));
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
    });

    it("starts over from one page after the card closes", () => {
      renderPreview({ findings: many });
      const group = screen.getByLabelText(LABEL);
      fireEvent.mouseEnter(group);
      scrollNearEnd(screen.getByRole("list"));
      fireEvent.blur(group);
      fireEvent.mouseEnter(group);
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
    });
  });
});

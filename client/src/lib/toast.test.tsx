import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast, notify } from "./toast";

afterEach(cleanup);

function Raiser() {
  const t = useToast();
  return (
    <div>
      <button onClick={() => t.success("Saved")}>raise success</button>
      <button onClick={() => t.error("Boom")}>raise error</button>
      <button onClick={() => t.info("Heads up")}>raise info</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ToastProvider>
      <Raiser />
    </ToastProvider>,
  );
}

/** The chip element carrying the kind's accent colour. */
function toastIcon(): SVGElement {
  const el = document.querySelector('[role="status"] svg');
  if (!el) throw new Error("no toast icon rendered");
  return el as SVGElement;
}

describe("ToastProvider", () => {
  it("announces toasts in a polite live region", () => {
    renderProvider();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("raises a toast through the hook", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise success"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  /**
   * These read `var(--ok-bg)` etc. rather than a literal: the map used to carry
   * hex fallbacks (`var(--ok-bg, #052e1c)`) for tokens that are in fact defined
   * in both themes, so the fallback was unreachable and dark-only.
   */
  it("takes every colour from a token, with no hex fallback", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise success"));
    const card = document.querySelector('[role="status"] > div') as HTMLElement;
    expect(card.style.background).toBe("var(--ok-bg)");
    expect(card.style.border).toBe("1px solid var(--ok)");
    expect(card.style.boxShadow).toBe("var(--shadow-modal)");
  });

  it("uses the design system's icons, not glyph characters", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise error"));
    expect(toastIcon().getAttribute("class")).toContain("lucide-x");
    // the glyphs the map used to hold
    expect(screen.queryByText("✕")).not.toBeInTheDocument();
    expect(screen.queryByText("×")).not.toBeInTheDocument();
  });

  it("distinguishes the three kinds by icon", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise info"));
    expect(toastIcon().getAttribute("class")).toContain("lucide-info");
  });

  it("dismisses on the close button", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise success"));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("throws a useful error when used outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Raiser />)).toThrow(/within <ToastProvider>/);
    quiet.mockRestore();
  });
});

describe("the module-level notify bridge", () => {
  it("reaches the mounted provider from outside React", () => {
    renderProvider();
    act(() => notify.error("Cache said no"));
    expect(screen.getByText("Cache said no")).toBeInTheDocument();
  });

  it("goes quiet once the provider unmounts, instead of throwing", () => {
    const { unmount } = renderProvider();
    unmount();
    expect(() => notify.error("nobody listening")).not.toThrow();
  });
});

describe("auto-dismiss", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("clears a toast on its own after the dismiss delay", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise success"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("keeps a toast up until the delay is actually reached", () => {
    renderProvider();
    fireEvent.click(screen.getByText("raise success"));
    act(() => vi.advanceTimersByTime(3900));
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});

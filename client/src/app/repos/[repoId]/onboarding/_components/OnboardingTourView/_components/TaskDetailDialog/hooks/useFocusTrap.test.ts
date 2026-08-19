/**
 * useFocusTrap — the four promises, each asserted on a real DOM.
 *
 * `React.createElement` rather than JSX because the hook and its test are `.ts`:
 * the harness is three buttons in a box, and giving the file a `.tsx` extension
 * to write them prettier would say the hook renders something, which it does not.
 *
 * `fireEvent`, not `userEvent` — the latter is not a dependency of this project
 * (`client/INSIGHTS.md`), and it is also the wrong tool here: jsdom implements no
 * default Tab behaviour at all, so what a test can assert about a trap is exactly
 * the part the trap itself moves — the two edges of the ring.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

afterEach(cleanup);

/**
 * The scrim is part of the harness because it is part of the trap: the window
 * it wraps is the only thing on screen, so the scrim is the one surface a
 * reader can press that is outside the container and still inside the dialog's
 * own tree.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { onScrimMouseDown } = useFocusTrap(ref, onClose);
  return React.createElement(
    "div",
    { "data-testid": "scrim", onMouseDown: onScrimMouseDown },
    React.createElement(
      "div",
      { ref, role: "dialog", tabIndex: -1, "aria-label": "A task" },
      React.createElement("button", { key: "a" }, "first"),
      React.createElement("button", { key: "b" }, "middle"),
      React.createElement("button", { key: "c" }, "last"),
    ),
  );
}

/**
 * The ring, indexed. `tsconfig` has `noUncheckedIndexedAccess`, so every
 * `stops[0]` is `T | undefined`; throwing here names the missing control instead
 * of asserting `!` and failing later with `Cannot read properties of undefined`.
 */
function stops(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

function at(list: HTMLElement[], index: number): HTMLElement {
  const found = list.at(index);
  if (!found) throw new Error(`the harness has no focusable at ${index}`);
  return found;
}

describe("useFocusTrap", () => {
  it("moves focus onto the container itself, so the dialog's name is announced", () => {
    const { getByRole } = render(React.createElement(Harness, { onClose: () => {} }));

    expect(document.activeElement).toBe(getByRole("dialog"));
  });

  it("sends Tab from the last control back to the first", () => {
    const { getByRole } = render(React.createElement(Harness, { onClose: () => {} }));
    const ring = stops(getByRole("dialog"));
    const [first, last] = [at(ring, 0), at(ring, -1)];

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });

    expect(document.activeElement).toBe(first);
  });

  it("sends Shift+Tab from the first control to the last", () => {
    const { getByRole } = render(React.createElement(Harness, { onClose: () => {} }));
    const ring = stops(getByRole("dialog"));
    const [first, last] = [at(ring, 0), at(ring, -1)];

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it("leaves a Tab in the middle of the ring to the browser", () => {
    const { getByRole } = render(React.createElement(Harness, { onClose: () => {} }));
    const middle = at(stops(getByRole("dialog")), 1);

    middle.focus();
    const handled = fireEvent.keyDown(middle, { key: "Tab" });

    // `fireEvent` returns false when a handler called `preventDefault`.
    expect(handled).toBe(true);
    expect(document.activeElement).toBe(middle);
  });

  it("closes on Esc", () => {
    const onClose = vi.fn();
    const { getByRole } = render(React.createElement(Harness, { onClose }));

    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a key the trap has no business in", () => {
    const onClose = vi.fn();
    const { getByRole } = render(React.createElement(Harness, { onClose }));

    fireEvent.keyDown(getByRole("dialog"), { key: "Enter" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives focus back to whatever had it before the dialog opened", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(React.createElement(Harness, { onClose: () => {} }));
    expect(document.activeElement).not.toBe(opener);

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  /**
   * jsdom runs none of the focusing steps a browser runs for a pointer press,
   * so the loss they cause is staged with `blur()`. What the assertion is about
   * is the recovery, and the case below covers the half that keeps the loss
   * from happening at all.
   */
  it("takes focus back when the reader presses the scrim from outside the window", () => {
    const onClose = vi.fn();
    const { getByRole, getByTestId } = render(React.createElement(Harness, { onClose }));
    const container = getByRole("dialog");

    at(stops(container), -1).focus();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.mouseDown(getByTestId("scrim"));

    expect(container.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses the scrim press its own focusing steps", () => {
    const { getByTestId } = render(React.createElement(Harness, { onClose: () => {} }));

    // `fireEvent` returns false when a handler called `preventDefault`. This is
    // the half a browser needs: measured in Chrome 151 on 2026-08-19, refusing
    // the default leaves focus on the control the reader was on, while a
    // handler that only refocuses is overwritten by the steps it ran before.
    expect(fireEvent.mouseDown(getByTestId("scrim"))).toBe(false);
  });

  it("leaves a press inside the window to the control under it", () => {
    const { getByRole } = render(React.createElement(Harness, { onClose: () => {} }));
    const middle = at(stops(getByRole("dialog")), 1);
    middle.focus();

    // A press that reaches the scrim by bubbling is not a press on the scrim:
    // refusing this one would stop every control in the window taking focus.
    expect(fireEvent.mouseDown(middle)).toBe(true);
    expect(document.activeElement).toBe(middle);
  });

  it("does not re-record the opener when the parent re-renders", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    // A fresh `onClose` identity on every render is what a parent passing an
    // inline arrow does; the trap must not treat it as a new open.
    const { rerender, unmount } = render(React.createElement(Harness, { onClose: () => {} }));
    rerender(React.createElement(Harness, { onClose: () => {} }));
    rerender(React.createElement(Harness, { onClose: () => {} }));

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

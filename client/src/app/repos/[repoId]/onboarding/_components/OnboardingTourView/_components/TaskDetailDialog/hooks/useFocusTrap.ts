/* useFocusTrap — the four keyboard promises a dialog makes: focus goes in, Tab
   cycles inside, Esc closes, and focus comes back to whatever opened it.

   WRITTEN HERE BECAUSE NOTHING IN THIS REPOSITORY DOES IT. `vendor/ui/kit/Modal.tsx`
   sets `role="dialog" aria-modal="true"` and stops — no Esc, no trap, no restore,
   and no way to give the dialog an accessible name — and it is vendored, so it
   cannot be taught any of them here.

   THE LISTENER IS ON THE CONTAINER, NEVER ON `window`. A page-level `keydown`
   would fire for a reader typing anywhere on the tour — in the search box, in the
   command palette — and close a dialog they were not in. Focus is moved into the
   container on mount, so every key the reader presses while the dialog is open
   passes through it.

   WHICH IS ALSO WHY THE SCRIM HANDS FOCUS BACK. A press that lands on the
   scrim would otherwise take focus to `<body>`, and a trap listening on an
   element nothing is dispatched to any more keeps none of its promises: the
   reader tabs into the page behind a live `aria-modal` window and can only
   leave with the mouse. `onScrimMouseDown` is returned rather than bound to
   `container.parentElement`, so the surface that must not steal focus is named
   by whoever renders it instead of assumed from the DOM shape.

   ONLY THE TWO EDGES OF THE TAB RING ARE INTERCEPTED. The browser already moves
   focus correctly between the controls in the middle; taking Tab over entirely
   would mean re-implementing tab order, including the parts this hook cannot see
   (a `contenteditable`, a radio group, a control the browser skips). jsdom
   implements no default Tab behaviour at all, so a test can only ever assert the
   two wraps — which is exactly what this hook owns. */
import React from "react";

/**
 * What the trap treats as a stop on the ring. `[tabindex="-1"]` is excluded on
 * purpose: the dialog container itself carries it so it can receive focus on
 * mount, and it must not then become a station the reader tabs back onto.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onClose: () => void,
): { onScrimMouseDown: React.MouseEventHandler<HTMLElement> } {
  /* `onClose` is read through a ref so the trap's own effect can depend on the
     ref alone and run exactly once per open. Depending on `onClose` instead
     re-runs the effect on every parent render — and each run records
     `document.activeElement` again, which by then is the dialog itself. Focus
     would then be "restored" to an element that is about to be unmounted, and
     the reader would land on `<body>` (AC-14). */
  const close = React.useRef(onClose);
  React.useEffect(() => {
    close.current = onClose;
  });

  React.useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const opener = document.activeElement;
    container.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab") return;

      const stops = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = stops[0];
      const last = stops[stops.length - 1];
      /* A window with nothing to focus keeps the reader where they are: Tab out
         of a trap with no stops would leave an `aria-modal` dialog open behind
         the reader, in the page it claims to have covered. */
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      /* `isConnected`, because the opener is gone in two real cases: the whole
         tour unmounted, and the dialog was opened by a URL rather than by a
         control, where the recorded element is `<body>`. Focusing either is a
         worse answer than leaving focus where the browser put it. */
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [ref]);

  /* PREVENTING THE PRESS'S DEFAULT IS THE FIX; REFOCUSING IS NOT. The focusing
     steps a pointer press runs are its default action, so they happen AFTER
     every listener has been called and overwrite anything a listener focused.
     Measured in Chrome 151 on 2026-08-19 with the last control focused and the
     press landing on the scrim: `preventDefault()` leaves focus exactly where
     the reader left it and the next Tab still wraps, while `container.focus()`
     alone ends on `<body>` with Esc and Tab unreachable — as does giving the
     scrim `tabindex="-1"`, which only moves the loss from `<body>` to an
     ancestor of the listener.

     The refocus below is therefore the second case only: a press made while
     focus is already outside, which is how the window takes it back rather
     than waiting for one. It is conditional so that a misplaced press does not
     cost a reader their place on the ring. */
  const onScrimMouseDown: React.MouseEventHandler<HTMLElement> = (event) => {
    const container = ref.current;
    if (!container) return;
    if (event.target instanceof Node && container.contains(event.target)) return;
    event.preventDefault();
    if (!container.contains(document.activeElement)) container.focus();
  };

  return { onScrimMouseDown };
}

/* useScrollSpy — which section the reader is actually looking at.

   AN OBSERVER, NOT A SCROLL LISTENER. `IntersectionObserver` is told once
   which elements matter and reports only when one crosses the band, off the
   main thread; a `scroll` handler re-measures five elements on every frame to
   answer the same question.

   THE BAND, AND WHY THE LAST ONE IN IT WINS. The root is shrunk to the top
   half of the viewport (`READING_BAND`, which carries the measurement behind
   the half), so "in the band" means "this section reaches the middle of the
   screen or above". Taking the LAST of those makes the rule the plain one: a
   section is current once its heading has crossed the middle, and until the
   next heading does. Taking the FIRST instead would keep a section marked long
   after its heading had scrolled away.

   THE URL IS A PREFERENCE, NOT A LOCK. `preferred` — the anchor the fragment
   names, so the one the reader last clicked — wins over the band's own answer
   while its section is still in the band, and stops winning once it is not.
   Without that rule a click on a section shorter than the band marks the NEXT
   section a moment later, because both are in the band and the later one wins;
   with it, a click stays where it was aimed and the scroll takes over again
   only when the reader has actually left. It needs no timer, so nothing here
   depends on how long a scroll took.

   Nothing writes the URL. The fragment is history — a `replaceState` per
   section passed would make the back button unusable and a `pushState` worse. */
"use client";

import React from "react";
import { READING_BAND } from "../constants";

/** One reference, so "nothing in the band" never re-renders on its own. */
const NONE: readonly string[] = [];

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((anchor, i) => anchor === b[i]);

/**
 * @param anchors element ids, in the order the page draws them
 * @param preferred the anchor the URL names, or `null` when it names none
 * @param enabled false until the elements are on the page to observe
 * @returns the anchor to mark, or `null` when the scroll says nothing yet — in
 *   which case the caller keeps whatever the URL said
 */
export function useScrollSpy(
  anchors: readonly string[],
  preferred: string | null,
  enabled: boolean,
): string | null {
  const [inBand, setInBand] = React.useState<readonly string[]>(NONE);

  React.useEffect(() => {
    /* No observer at all is a real case, not only jsdom's: the page then keeps
       the behaviour it had before this hook — the URL and the click — instead
       of losing its rail. */
    if (!enabled || typeof IntersectionObserver === "undefined") {
      setInBand(NONE);
      return;
    }

    /* The set is the observer's, not React's: a callback carries only the
       targets that CHANGED, so the ones that did not have to be remembered
       between calls. */
    const onScreen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(entry.target.id);
          else onScreen.delete(entry.target.id);
        }
        const next = anchors.filter((anchor) => onScreen.has(anchor));
        setInBand((prev) => (sameOrder(prev, next) ? prev : next));
      },
      { rootMargin: READING_BAND },
    );

    for (const anchor of anchors) {
      const element = document.getElementById(anchor);
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, [anchors, enabled]);

  if (inBand.length === 0) return null;
  if (preferred !== null && inBand.includes(preferred)) return preferred;
  return inBand[inBand.length - 1] ?? null;
}

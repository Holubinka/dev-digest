/** Placeholder cards while the envelope is in flight — the page is one header
 *  and five section cards, so three bars read as "this is that page loading"
 *  rather than as a list of rows. */
export const SKELETON_ROWS = 3;

/* The strip of the viewport the rail's mark follows: the top HALF, as an
   `IntersectionObserver` `rootMargin` that shrinks the bottom half away.
   Combined with "the last section in the band wins" (`hooks/useScrollSpy.ts`)
   the rule this makes is the plain one — a section is current once its heading
   has crossed the middle of the screen, and until the next heading does.

   HALF, MEASURED, AND NOT A SMALLER NUMBER. A narrower band is a more precise
   handover and it costs the LAST section entirely: a page stops scrolling
   while its final heading is still partway down the screen, so a band ending
   above that point can never contain it — the rail then marks the
   second-to-last section at the bottom of the page AND after a click on the
   last rail entry. Measured in Chrome 151 at 1440×1000 against the real tour
   for `Holubinka/dev-digest` (2026-08-18): `main` scrolls 3593px, and at the
   bottom `#first-tasks` sits 374px down the 948px scrollport. A 30% band ends
   at 284px and never reaches it; half ends at 474px and clears it by 100.
   The limit worth knowing, because a future tour could meet it: the last
   section needs about half a screen of content below its heading to be
   reachable at all. Here it has 574px.

   MEASURED FROM THE VIEWPORT, NOT FROM `main`. The observer's root is the
   viewport (`root: null`), and `main` — this app's real scroll container
   (`vendor/ui/shell/AppFrame.tsx:29`) — clips its own descendants, so a
   section scrolled out of `main` is out of the band whatever the percentage
   says. The one consequence is that the band's top edge is the top of the
   window rather than the top of `main`: the first 52px of it sit under the
   topbar and see nothing, which costs nothing at any window height this app
   is used at.

   A band and not a line: a line can fall in the gap between two cards and
   leave the rail unmarked, and `IntersectionObserver` cannot report the gap. */
export const READING_BAND = "0px 0px -50% 0px";

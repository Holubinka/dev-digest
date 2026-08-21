/**
 * Compact relative time — "now", "42m", "3h", "2d".
 *
 * It lived in `app/repos/[repoId]/pulls/helpers.ts` while the PR list was its
 * only reader. The Onboarding Tour header is the second consumer, in a
 * different route, which is the promotion signal
 * (`frontend-architecture` principle 2) — and importing across two routes'
 * `_components` trees is what `/pr-self-review` cited the last time somebody
 * skipped this move (`client/INSIGHTS.md:928-938`).
 *
 * It reads `Date.now()`, so it is not pure for a given input: call it from an
 * event, an effect or a client-only render, never from anything Next
 * server-renders and then hydrates, or the two passes disagree by a minute and
 * React reports a hydration mismatch.
 *
 * It formats a TIMESTAMP the server sent. The server never sends "2h ago" —
 * a relative string formatted there ages inside the cache and reads "2h ago" a
 * day later — and the wording around this number stays in `messages/en`.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

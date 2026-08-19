/**
 * Shared pieces of the untrusted document view.
 *
 * This folder sits in `src/components/` rather than beside the Project Context
 * page because three surfaces in two different route trees render a scanned
 * document: the page's reading pane, its `Preview` mode, and the preview inside
 * both editors' Context tabs. A second copy of the renderer is exactly what
 * `AC-56` forbids — the protocol gate below has to hold on every surface, and it
 * only does so if there is one of it.
 */
import { ApiError } from "@/lib/api";
import type { ContextDocKind } from "@/lib/types";

/** Badge colour per document kind. Four kinds, because `other` is a real one. */
export const KIND_COLOR: Record<ContextDocKind, string> = {
  specs: "var(--accent)",
  docs: "var(--info)",
  insights: "var(--warn)",
  other: "var(--text-muted)",
};

/**
 * Whether a URL is safe to put in an `href` or an `src`.
 *
 * The documents rendered on this page come out of an imported repository, so a
 * link in one is attacker-controlled text.
 *
 * MEASURED, not assumed (2026-08-14): `react-markdown` v9 already refuses this
 * on its own. Its default `urlTransform` rewrites `javascript:alert(1)` to `""`
 * before any component sees it, and React blocks a `javascript:` href at the DOM
 * level as a second layer. The plan expected the primitive to leave links
 * unchecked; it does not.
 *
 * This gate stays anyway, and is a decision rather than an oversight. It makes
 * the refusal EXPLICIT and directly testable, instead of resting on the default
 * of a transitive dependency that a future `urlTransform` prop, a plugin, or a
 * major-version bump could change without any local edit. It is also the one
 * layer that decides what the reader sees in place of the link.
 *
 * Allowlist, not denylist: `javascript:` is only the obvious one, and `data:`
 * and `vbscript:` are the ones a denylist forgets. A relative link is fine —
 * it resolves against the app's own origin and cannot execute.
 *
 * The question is what the BROWSER will resolve, not what the string looks like.
 * A browser removes TAB, LF and CR from a URL wherever they sit, so
 * `java\tscript:alert(1)` is `javascript:` by the time anything runs — while
 * `.trim()` reaches only the ends and the scheme pattern matches no control
 * character, which sent that form down the "relative URL" branch as safe.
 */
export function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  // `\p{Cc}` is the whole C0/C1 range, DEL included: none of them is legal in a
  // URL, and each is a way of spelling a scheme that the eye cannot see. Removed
  // rather than refused, because removing is what the browser does — the string
  // left here is the one that will actually be resolved.
  const cleaned = url.replace(/\p{Cc}/gu, "").trim();
  if (!cleaned) return false;
  // A scheme-relative or path-relative URL has no protocol to check.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned) === false) return true;
  return /^https?:/i.test(cleaned);
}

/** The three states a run uses for a document it could not read. */
export type DocReadFailureReason = "missing" | "refused" | "binary";

/**
 * The reason a document could not be read, or `null` when the error is
 * something else — a network failure, a 500 — which the caller shows as an
 * error rather than as a property of the document.
 *
 * A `switch`, not a lookup in an object literal: `err.code` is a string from the
 * server, and `({} as Record<string, string>)["constructor"]` is truthy.
 */
export function readFailureReason(err: unknown): DocReadFailureReason | null {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case "doc_missing":
      return "missing";
    case "doc_refused":
      return "refused";
    case "doc_binary":
      return "binary";
    default:
      return null;
  }
}

/**
 * The href a link in an untrusted document should actually carry, or
 * `undefined` when it should render as plain text instead.
 *
 * `resolvePath` is the seam the Onboarding Tour needs and the Project Context
 * pages do not: model prose can name a repo-relative path, and only the
 * caller knows which of those the server proved to exist and what URL such a
 * path becomes. Passing `null` is the whole of "I have no such notion", and it
 * keeps the behaviour a document reader has had all along — a relative href is
 * left exactly as written.
 *
 * The parameter is REQUIRED at the call site rather than optional with a
 * `null` default: a prop that selects between two whole behaviours and carries
 * a default is invisible to `tsc`, and this repo has shipped that bug twice
 * (`client/INSIGHTS.md:340-361`, `:400-433`).
 *
 * Order matters. `isSafeUrl` runs FIRST and unconditionally, so no caller can
 * hand a `javascript:` URL back through `resolvePath`; only what has already
 * passed the protocol gate is offered to it, and only when it names no
 * protocol at all.
 */
export function resolveHref(
  href: string | undefined,
  resolvePath: ((path: string) => string | undefined) | null,
): string | undefined {
  if (!isSafeUrl(href) || href === undefined) return undefined;
  if (resolvePath === null) return href;
  // `isSafeUrl` has already reduced this to two cases: an `http(s)` URL, or a
  // string naming no scheme at all. The second is the repo-relative one, and
  // the test runs over the cleaned value for the same reason `isSafeUrl` does
  // — a scheme spelled with a TAB inside is still a scheme to a browser.
  const cleaned = href.replace(/\p{Cc}/gu, "").trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return href;
  return resolvePath(href);
}

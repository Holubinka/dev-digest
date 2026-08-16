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

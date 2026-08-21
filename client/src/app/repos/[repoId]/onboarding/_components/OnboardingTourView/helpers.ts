/* helpers.ts — the decisions this page makes that are pure functions, kept out
   of the components so each can be asserted directly.

   All of them are small, and all of them are places where a "reasonable default"
   would be a lie: an unknown fragment must not silently name a section that is
   not there, and an unknown refusal reason must not silently render the first
   of three texts that lead a reader to three different actions. */
import type {
  OnboardingRefusal,
  OnboardingSection,
  OnboardingSectionKind,
} from "@/lib/types";
import { SECTION_ORDER } from "./sections";

/** What the page treats as active when the URL names no section. */
const FIRST_ANCHOR = SECTION_ORDER[0].anchor;

/**
 * The section a fragment names — `null` when it names none.
 *
 * `null` and not the first section, because the two answers are used for
 * different questions: this one says what the READER ASKED FOR, and a stale or
 * hand-typed fragment asked for nothing. The scrollspy takes it as a
 * preference (`useScrollSpy`), and a preference nobody expressed must not
 * outrank what is on screen.
 */
export function anchorFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const anchor = hash.replace(/^#/, "").replace(/\/+$/, "");
  return SECTION_ORDER.some((d) => d.anchor === anchor) ? anchor : null;
}

/**
 * The section a fragment names, or the first one.
 *
 * What the rail falls back to when the scroll has said nothing yet — the first
 * paint, and any window where no card covers the reading band. A fragment that
 * matches no anchor — a stale link, a hand-typed one — falls back to the first
 * section rather than to nothing, because "no section is active" would leave
 * the rail with no mark at all and `Share link` with nothing to append.
 */
export function activeSectionFrom(hash: string | null | undefined): string {
  return anchorFromHash(hash) ?? FIRST_ANCHOR;
}

/**
 * The URL `Share link` puts on the clipboard: the current one, with the active
 * section's anchor when it carries none.
 *
 * The link therefore always names a section, which is what makes an anchor
 * worth having (§ D17). Nothing else is copied — not markdown, not an export,
 * not a public URL: those are decisions for a human, not side effects of a copy
 * control (§ N11).
 */
export function shareUrl(href: string, anchor: string): string {
  try {
    const url = new URL(href);
    if (url.hash === "" || url.hash === "#") url.hash = anchor;
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * The message key for a refused generation — three reasons, three texts, and
 * `null` for anything else.
 *
 * A `switch` and not a lookup in an object literal: the value is a string off
 * the wire and `src/lib/api.ts` validates nothing, so `({} as Record<string,
 * string>)["constructor"]` is the failure this shape cannot have
 * (`context-doc-view/helpers.ts`, `readFailureReason`).
 *
 * `null` for an unknown value is deliberate: no default branch quietly picks
 * the first text. The three lead a reader to three different actions and the
 * third is final, so guessing between them is worse than saying nothing.
 */
export function refusalCopyKey(reason: string | null | undefined): string | null {
  switch (reason) {
    case "index_missing":
      return "refusal.noIndex";
    case "index_failed":
      return "refusal.indexFailed";
    case "language_unsupported":
      return "refusal.unsupportedLanguage";
    default:
      return null;
  }
}

/**
 * The same three refusals as they arrive on a 409 from the POST, so a press
 * lands on the same text the read would have shown.
 *
 * `onboarding_index_changed` is deliberately NOT one of them, and that is the
 * split the contract draws (`contracts/onboarding-api.ts`:
 * `OnboardingGenerateRefusal` extends `OnboardingRefusal` rather than widening
 * it). These three are the GATE's vocabulary: they are answered on every read
 * as `generate_blocked` and they say a generation would be refused before it
 * starts. `index_changed` can only ever be the answer to a press — the index
 * was rewritten WHILE the tour was being written, so the server saved nothing —
 * and it never appears in `generate_blocked`. It gets its own sentence through
 * `generateFailureKey` below, not a fourth branch of the page's blocked state.
 */
export function refusalFromErrorCode(
  code: string | null | undefined,
): OnboardingRefusal | null {
  switch (code) {
    case "onboarding_index_missing":
      return "index_missing";
    case "onboarding_index_failed":
      return "index_failed";
    case "onboarding_language_unsupported":
      return "language_unsupported";
    default:
      return null;
  }
}

/**
 * A sha as it is shown beside another sha. The `BlastRadiusCard.tsx:102` form,
 * for the same reason: the staleness note names two index states, and two
 * forty-character strings in one sentence are not comparable by eye.
 */
export const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * The section of a given kind, or an empty one of that kind.
 *
 * The contract says all five are always present, in enum order — and
 * `src/lib/api.ts` does not validate, so "always" is a promise the page cannot
 * check. A missing section renders its card with its own empty sentence, which
 * is what R26 asks for anyway; it does not invent a body, a diagram or a link,
 * and it does not take the page down.
 */
export function sectionFor(
  sections: readonly OnboardingSection[],
  kind: OnboardingSectionKind,
): OnboardingSection {
  const found = sections.find((section) => section.kind === kind);
  if (found) return found;
  return {
    kind,
    title: "",
    body: "",
    links: [],
    verified_paths: [],
    state: "empty",
    empty_reason: null,
  };
}

/**
 * Which sentence a FAILED generation gets. Two, and the second is the one the
 * three refusals above are not.
 *
 * `onboarding_index_changed` (409) means the repository was indexed again
 * between the gate and the model's answer, so the server refused to save: the
 * previous tour is untouched, nothing was written, and pressing again works
 * immediately. It promises no waiting, because there is nothing to wait for —
 * which is the same rule `refusal.noIndex` is held to (AC-84).
 *
 * Everything else keeps the generic sentence beside the server's own message.
 */
export function generateFailureKey(
  code: string | null | undefined,
): "generateIndexChanged" | "generateFailed" {
  return code === "onboarding_index_changed" ? "generateIndexChanged" : "generateFailed";
}

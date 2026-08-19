/**
 * The page's pure decisions. These are the whole of R6 (which section a
 * URL names), R28 (what `Share link` copies) and R18 (which of three refusals a
 * reader is shown) — each of them a place where a plausible default would be a
 * lie rather than a fallback.
 */
import { describe, it, expect } from "vitest";
import { SECTION_ORDER } from "./_components/sections";
import {
  activeSectionFrom,
  anchorFromHash,
  generateFailureKey,
  refusalCopyKey,
  refusalFromErrorCode,
  sectionFor,
  shareUrl,
  shortSha,
} from "./helpers";

const FIRST = SECTION_ORDER[0].anchor;
const LAST = SECTION_ORDER[SECTION_ORDER.length - 1]!.anchor;

describe("anchorFromHash", () => {
  /* The half `activeSectionFrom` cannot express: NOTHING was asked for. The
     scrollspy takes this as the reader's preference and lets it outrank what
     is on screen, so a fragment nobody typed must come back as `null` rather
     than as the first section — otherwise the rail would pin itself to
     "Architecture overview" on a page that was merely opened. */
  it("takes the section a known fragment names, with or without its hash and slash", () => {
    expect(anchorFromHash(`#${LAST}`)).toBe(LAST);
    expect(anchorFromHash(LAST)).toBe(LAST);
    expect(anchorFromHash(`#${LAST}/`)).toBe(LAST);
  });

  it("answers null when the URL names no section of this page", () => {
    expect(anchorFromHash("")).toBeNull();
    expect(anchorFromHash(null)).toBeNull();
    expect(anchorFromHash(undefined)).toBeNull();
    expect(anchorFromHash("#")).toBeNull();
    expect(anchorFromHash("#conventions")).toBeNull();
  });
});

describe("activeSectionFrom", () => {
  it("takes the section a known fragment names", () => {
    expect(activeSectionFrom(`#${LAST}`)).toBe(LAST);
    expect(activeSectionFrom(LAST)).toBe(LAST);
  });

  it("falls back to the first section for an empty, absent or unknown fragment", () => {
    expect(activeSectionFrom("")).toBe(FIRST);
    expect(activeSectionFrom(null)).toBe(FIRST);
    expect(activeSectionFrom(undefined)).toBe(FIRST);
    expect(activeSectionFrom("#conventions")).toBe(FIRST);
    expect(activeSectionFrom("#")).toBe(FIRST);
  });

  it("tolerates a trailing slash on the fragment", () => {
    expect(activeSectionFrom(`#${LAST}/`)).toBe(LAST);
  });

  it("names a real section for every anchor the rail links to", () => {
    for (const section of SECTION_ORDER) {
      expect(activeSectionFrom(`#${section.anchor}`)).toBe(section.anchor);
    }
  });
});

describe("shareUrl", () => {
  it("appends the active section when the URL names none", () => {
    expect(shareUrl("http://localhost:3000/repos/r1/onboarding", "first-tasks")).toBe(
      "http://localhost:3000/repos/r1/onboarding#first-tasks",
    );
  });

  it("keeps the fragment the URL already carries", () => {
    expect(
      shareUrl("http://localhost:3000/repos/r1/onboarding#how-to-run", "architecture"),
    ).toBe("http://localhost:3000/repos/r1/onboarding#how-to-run");
  });

  it("keeps the query string, and copies nothing that is not the URL", () => {
    const copied = shareUrl("http://localhost:3000/repos/r1/onboarding?x=1", "reading-path");
    expect(copied).toBe("http://localhost:3000/repos/r1/onboarding?x=1#reading-path");
    expect(copied).not.toContain("```");
  });
});

describe("refusalCopyKey", () => {
  it("gives each of the three reasons its own text", () => {
    const keys = [
      refusalCopyKey("index_missing"),
      refusalCopyKey("index_failed"),
      refusalCopyKey("language_unsupported"),
    ];
    expect(keys).toEqual(["refusal.noIndex", "refusal.indexFailed", "refusal.unsupportedLanguage"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("returns nothing at all for null or an unknown reason — never the first of three", () => {
    expect(refusalCopyKey(null)).toBeNull();
    expect(refusalCopyKey(undefined)).toBeNull();
    expect(refusalCopyKey("index_building")).toBeNull();
    // A string that is truthy on `Object.prototype`, which a lookup in an
    // object literal would answer for (`context-doc-view/helpers.ts`).
    expect(refusalCopyKey("constructor")).toBeNull();
  });
});

describe("refusalFromErrorCode", () => {
  it("maps the three 409 codes back onto the three reasons", () => {
    expect(refusalFromErrorCode("onboarding_index_missing")).toBe("index_missing");
    expect(refusalFromErrorCode("onboarding_index_failed")).toBe("index_failed");
    expect(refusalFromErrorCode("onboarding_language_unsupported")).toBe("language_unsupported");
  });

  it("does not treat a changed index as a gate refusal", () => {
    // The gate's vocabulary is three. `index_changed` can only be the answer to
    // a press, never `generate_blocked`, so it must not reach the page's
    // blocked state — it is a failed generation with its own sentence.
    expect(refusalFromErrorCode("onboarding_index_changed")).toBeNull();
    expect(refusalFromErrorCode("config_error")).toBeNull();
    expect(refusalFromErrorCode(undefined)).toBeNull();
  });
});

describe("generateFailureKey", () => {
  it("gives a changed index its own sentence and everything else the generic one", () => {
    expect(generateFailureKey("onboarding_index_changed")).toBe("generateIndexChanged");
    expect(generateFailureKey("external_service_error")).toBe("generateFailed");
    expect(generateFailureKey(undefined)).toBe("generateFailed");
  });
});

describe("shortSha", () => {
  it("shortens a sha so two of them are comparable by eye", () => {
    expect(shortSha("2f8b7e19c6f559e335efb170098af90d8a688a25")).toBe("2f8b7e1");
  });
});

describe("sectionFor", () => {
  const architecture = {
    kind: "architecture" as const,
    title: "The model's own heading",
    body: "Some prose.",
    links: [],
    verified_paths: [],
    state: "ready" as const,
    empty_reason: null,
  };

  it("finds the section of that kind", () => {
    expect(sectionFor([architecture], "architecture")).toBe(architecture);
  });

  it("answers an EMPTY section of that kind when the payload has none", () => {
    const missing = sectionFor([architecture], "first_tasks");
    expect(missing.kind).toBe("first_tasks");
    expect(missing.state).toBe("empty");
    expect(missing.body).toBe("");
    expect(missing.verified_paths).toEqual([]);
    expect(missing.diagram).toBeUndefined();
  });
});

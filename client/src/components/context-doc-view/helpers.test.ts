/**
 * `isSafeUrl` — the explicit protocol gate on a link or an image inside an
 * untrusted document.
 *
 * Tested directly, and not only through the rendered page, because two layers
 * below it already refuse a `javascript:` URL: `react-markdown` v9's default
 * `urlTransform` rewrites it to `""`, and React blocks such an href at the DOM.
 * A rendering-only assertion therefore passes whether this function works or
 * not — measured, by breaking it and watching the page test stay green. These
 * are the assertions that actually hold it up.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { isSafeUrl, readFailureReason } from "./helpers";

/** `U+0009`. A control character written literally is invisible in every diff. */
const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

describe("isSafeUrl", () => {
  it("accepts http and https, whatever the case", () => {
    expect(isSafeUrl("https://example.com/a")).toBe(true);
    expect(isSafeUrl("http://example.com/a")).toBe(true);
    expect(isSafeUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("accepts a relative link — it resolves to this origin and cannot execute", () => {
    expect(isSafeUrl("./other.md")).toBe(true);
    expect(isSafeUrl("/repos/1/context")).toBe(true);
    expect(isSafeUrl("#section")).toBe(true);
  });

  it("refuses every other protocol — an allowlist, so a new one is refused by default", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("mailto:someone@example.com")).toBe(false);
  });

  it("refuses a scheme spelled with a control character inside it", () => {
    // A browser strips TAB, LF and CR from a URL wherever they sit, so every one
    // of these IS `javascript:` by the time it is resolved. `.trim()` only
    // reaches the ends, and the scheme pattern matches no control character, so
    // these used to fall through the "relative URL, nothing to check" branch and
    // be called safe. `react-markdown`'s default transform blanks them today —
    // which is precisely the layer this function exists not to depend on.
    const spelled = (code: number) => `java${String.fromCodePoint(code)}script:alert(1)`;
    const codes = [0x00, 0x01, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1f, 0x7f];
    expect(codes.filter((code) => isSafeUrl(spelled(code))).map(hex)).toEqual([]);
    expect(isSafeUrl(`data${String.fromCodePoint(0x09)}:text/html,x`)).toBe(false);
  });

  it("still accepts a URL whose non-ASCII characters are ordinary text", () => {
    expect(isSafeUrl("https://example.com/a—b")).toBe(true);
    expect(isSafeUrl("./notes–draft.md")).toBe(true);
  });

  it("refuses an absent or empty URL, and one that is nothing but control characters", () => {
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl([0x09, 0x0d, 0x0a, 0x20].map((c) => String.fromCodePoint(c)).join(""))).toBe(
      false,
    );
  });
});

describe("readFailureReason", () => {
  it("maps each read-failure code to the state the run uses for it", () => {
    expect(readFailureReason(new ApiError("gone", 404, "doc_missing"))).toBe("missing");
    expect(readFailureReason(new ApiError("no", 403, "doc_refused"))).toBe("refused");
    expect(readFailureReason(new ApiError("not text", 415, "doc_binary"))).toBe("binary");
  });

  it("returns null for any other API error — that is a failure of the request, not of the document", () => {
    expect(readFailureReason(new ApiError("boom", 500, "internal_error"))).toBeNull();
    expect(readFailureReason(new ApiError("offline", 0, "network_error"))).toBeNull();
    expect(readFailureReason(new ApiError("no code", 500))).toBeNull();
  });

  it("returns null for something that is not an ApiError at all", () => {
    expect(readFailureReason(new Error("doc_missing"))).toBeNull();
    expect(readFailureReason({ code: "doc_missing" })).toBeNull();
    expect(readFailureReason(null)).toBeNull();
    expect(readFailureReason(undefined)).toBeNull();
  });

  it("does not answer for a code that only inherits from Object", () => {
    expect(readFailureReason(new ApiError("weird", 400, "constructor"))).toBeNull();
    expect(readFailureReason(new ApiError("weird", 400, "__proto__"))).toBeNull();
  });
});

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CategoryTag, type Category } from "@devdigest/ui";
import { FindingCategoryTag } from "./FindingCategoryTag";
import { isKnownCategory } from "./helpers";

afterEach(cleanup);

/** Every key `CAT` actually defines. */
const KNOWN = ["bug", "security", "perf", "style", "test"] as const;

/**
 * Names that resolve on `Object.prototype`, so `key in CAT` is true and
 * `CAT[key]` is truthy — which is what defeats a truthiness guard.
 */
const INHERITED = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
  "isPrototypeOf",
  "toLocaleString",
  "propertyIsEnumerable",
];

describe("isKnownCategory", () => {
  it.each(KNOWN)("accepts the real category %s", (c) => {
    expect(isKnownCategory(c)).toBe(true);
  });

  it("rejects an unknown string and a non-string", () => {
    expect(isKnownCategory("nonsense")).toBe(false);
    expect(isKnownCategory("")).toBe(false);
    expect(isKnownCategory(undefined)).toBe(false);
    expect(isKnownCategory(null)).toBe(false);
    expect(isKnownCategory(7)).toBe(false);
  });

  /**
   * The case the "nonsense" assertion above cannot reach. A guard written as
   * `value in CAT`, or as `CAT[value]` truthiness, answers true for every name
   * here. Asserted by name rather than derived from
   * `Object.getOwnPropertyNames(Object.prototype)` so a failure says which key
   * leaked.
   */
  it.each(INHERITED)("rejects the inherited key %s", (key) => {
    expect(isKnownCategory(key)).toBe(false);
  });
});

/**
 * Why this wrapper exists at all, pinned rather than asserted in a comment.
 * `CategoryTag` guards with `const c = CAT[category]; if (!c) return null`, and
 * that guard is keyed on truthiness — so it handles a merely unknown category
 * correctly and does NOT handle an inherited one, where `CAT[key]` is a method
 * on `Object.prototype`. `c.icon` is then `undefined` and `Icon[undefined]`
 * throws `Element type is invalid`: the whole PR-detail route, not one tag.
 *
 * If `vendor/ui` ever gains its own own-property guard this test flips, and the
 * right response is to delete the wrapper — not to loosen the assertion.
 */
describe("the vendored CategoryTag this wraps", () => {
  it.each(INHERITED.filter((k) => k !== "__proto__"))(
    "throws on the inherited key %s, which is why the wrapper is needed",
    (key) => {
      expect(() => render(<CategoryTag category={key as Category} />)).toThrow();
    },
  );

  it("already handles a merely unknown category, so that path needs no help", () => {
    expect(() => render(<CategoryTag category={"nonsense" as Category} />)).not.toThrow();
  });
});

describe("FindingCategoryTag", () => {
  it.each(KNOWN)("renders the label for the real category %s", (c) => {
    render(<FindingCategoryTag category={c} />);
    expect(screen.getByText(c)).toBeInTheDocument();
  });

  it("renders nothing for an unknown category", () => {
    const { container } = render(<FindingCategoryTag category="nonsense" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty category", () => {
    const { container } = render(<FindingCategoryTag category="" />);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The assertion the wrapper exists for: the same input that throws out of the
   * vendored tag above must render nothing here.
   */
  it.each(INHERITED)("skips the inherited key %s instead of taking the route down", (key) => {
    const { container } = render(<FindingCategoryTag category={key} />);
    expect(container).toBeEmptyDOMElement();
  });
});

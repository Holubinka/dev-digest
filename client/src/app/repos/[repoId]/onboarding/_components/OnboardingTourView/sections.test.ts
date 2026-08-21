import { describe, it, expect } from "vitest";
import messages from "@/../messages/en/onboarding.json";
import { SECTION_ORDER, SECTION_BY_KIND } from "./sections";

/** `t("section.architecture")` resolves a dotted key; so does this. */
function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      messages,
    );
}

describe("SECTION_ORDER", () => {
  it("is the mockup's five, in the mockup's order", () => {
    // An ORDER assertion, not five presence assertions: three of those passed
    // for a whole round while a section sat in the wrong place
    // (`client/INSIGHTS.md:110-132`). P3's rail maps this array, so this is
    // also the rail's order.
    expect(SECTION_ORDER.map((d) => d.kind)).toEqual([
      "architecture",
      "critical_paths",
      "how_to_run",
      "reading_path",
      "first_tasks",
    ]);
  });

  it("gives every section a distinct anchor and one descriptor per kind", () => {
    expect(SECTION_ORDER.map((d) => d.anchor)).toEqual([
      "architecture",
      "critical-paths",
      "how-to-run",
      "reading-path",
      "first-tasks",
    ]);
    expect(new Set(SECTION_ORDER.map((d) => d.anchor)).size).toBe(5);
    expect(Object.keys(SECTION_BY_KIND).sort()).toEqual(
      SECTION_ORDER.map((d) => d.kind)
        .slice()
        .sort(),
    );
  });

  it("names a message key that exists, for the heading and for the empty text", () => {
    // A key that does not resolve renders a blank heading with nothing failing.
    // The `empty.*` family is checked in `i18n/onboarding-messages.test.ts`
    // instead: the five cards write those keys as literals, so a table here
    // would only prove the table right.
    for (const d of SECTION_ORDER) {
      expect(typeof lookup(d.titleKey), d.titleKey).toBe("string");
    }
  });
});

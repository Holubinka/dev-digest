import { describe, it, expect } from "vitest";
import { MAX_LINE, lineLabel } from "./line-numbers";

describe("lineLabel", () => {
  /**
   * SPEC-05 AC-59 in one assertion: a finding that starts and ends on the same
   * line reads `file:12`, never `file:12-12`. Both the PR page's finding list and
   * the multi-agent results page print it, which is why the function is here and
   * no longer beside the card.
   */
  it("prints a single line without a range", () => {
    expect(lineLabel({ start_line: 12, end_line: 12 })).toBe("12");
  });

  it("prints a real range with both ends", () => {
    expect(lineLabel({ start_line: 11, end_line: 15 })).toBe("11-15");
  });

  it("does not reorder an inverted range — it prints what the finding says", () => {
    expect(lineLabel({ start_line: 15, end_line: 11 })).toBe("15-11");
  });

  it("bounds nothing: MAX_LINE is the other half of this file's job", () => {
    expect(lineLabel({ start_line: MAX_LINE + 1, end_line: MAX_LINE + 1 })).toBe(
      String(MAX_LINE + 1),
    );
  });
});

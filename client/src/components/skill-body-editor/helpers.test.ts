import { describe, it, expect } from "vitest";
import { bodyFilename } from "./helpers";

describe("bodyFilename", () => {
  it("slugifies the skill name", () => {
    expect(bodyFilename("Uncovered branch rubric")).toBe("uncovered-branch-rubric.md");
    expect(bodyFilename("already-a-slug")).toBe("already-a-slug.md");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(bodyFilename("  Rule #1: don't!  ")).toBe("rule-1-don-t.md");
  });

  it("falls back rather than producing a bare extension", () => {
    expect(bodyFilename("")).toBe("skill.md");
    expect(bodyFilename("!!!")).toBe("skill.md");
  });
});

import { describe, it, expect } from "vitest";
import { bodyFilename, promptBlock } from "./helpers";

/**
 * `promptBlock` mirrors `skillBlock` in server/src/modules/reviews/helpers.ts.
 * These are the same cases the server test pins — if the two ever disagree, the
 * Preview tab is lying about what the agent receives.
 */
describe("promptBlock", () => {
  it.each(["# H1", "## H2", "###### H6", "  # indented", "#\ttab"])(
    "leaves %j alone — it already announces itself",
    (body) => {
      expect(promptBlock("Name", body)).toBe(body);
    },
  );

  it.each(["plain text", "#nospace", "- a list", "**bold**", "####### seven hashes"])(
    "prefixes the skill name onto %j",
    (body) => {
      expect(promptBlock("Name", body)).toBe(`### Name\n${body}`);
    },
  );
});

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

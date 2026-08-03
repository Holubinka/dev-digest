import { describe, it, expect } from "vitest";
import { promptBlock } from "./helpers";

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

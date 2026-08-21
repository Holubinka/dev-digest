/**
 * `activeKeyFor` decides which sidebar row is highlighted, and it is a chain of
 * `includes()` where ORDER IS SIGNIFICANT and nothing in the type system says
 * so. The Onboarding Tour row is what makes that testable rather than academic:
 * the line used to read `pathname.includes("/onboarding")`, which was harmless
 * only while no NAV row claimed the key. The moment one did, the plain
 * `/onboarding` add-repository screen would have lit the tour's row — a
 * behaviour change on a route SPEC-03 § AC-8 requires to stay exactly as it is.
 */
import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("highlights the tour only on the repo-scoped route", () => {
    expect(activeKeyFor("/repos/r1/onboarding")).toBe("onboarding-tour");
  });

  it("leaves the add-repository screen with no row highlighted, as it renders today", () => {
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("still answers for the routes whose lines sit below it", () => {
    // The tour's test runs before `/context` in the chain, so a regex that was
    // too greedy would steal these two rather than fail on its own.
    expect(activeKeyFor("/repos/r1/context")).toBe("context");
    expect(activeKeyFor("/settings/models")).toBe("settings");
  });
});

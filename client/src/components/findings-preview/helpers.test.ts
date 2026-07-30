import { describe, it, expect } from "vitest";
import { shortPath } from "./helpers";

describe("shortPath", () => {
  it("leaves a path that already fits", () => {
    expect(shortPath("src/config.ts", 46)).toBe("src/config.ts");
  });

  it("keeps the filename and as many trailing folders as fit in the budget", () => {
    const out = shortPath("client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx", 46);
    expect(out).toBe("…/_components/FindingsCell/FindingsCell.tsx");
    expect(out.length).toBeLessThanOrEqual(46);
  });

  it("drops a folder that would blow the budget", () => {
    expect(shortPath("client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx", 34)).toBe(
      "…/FindingsCell/FindingsCell.tsx",
    );
  });

  it("keeps the filename even when the filename alone is too long", () => {
    expect(shortPath("a/b/an-extremely-long-file-name-that-alone-exceeds-the-budget.ts", 20)).toBe(
      "…/an-extremely-long-file-name-that-alone-exceeds-the-budget.ts",
    );
  });
});

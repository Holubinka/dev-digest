import { describe, it, expect } from "vitest";
import type { ListFinding } from "@devdigest/shared";
import { rankFindings, shortPath } from "./helpers";

function finding(over: Partial<ListFinding> = {}): ListFinding {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    confidence: 0.9,
    rationale: "Line 12 contains a literal sk_live_ Stripe key.",
    ...over,
  };
}

describe("rankFindings", () => {
  it("ranks worst severity first, then most confident", () => {
    const out = rankFindings([
      finding({ id: "sugg", severity: "SUGGESTION", confidence: 0.99 }),
      finding({ id: "warn-low", severity: "WARNING", confidence: 0.2 }),
      finding({ id: "warn-high", severity: "WARNING", confidence: 0.8 }),
      finding({ id: "crit", severity: "CRITICAL", confidence: 0.1 }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["crit", "warn-high", "warn-low", "sugg"]);
  });

  // The list card re-ranks when the full set replaces the payload's worst three,
  // so an equal-confidence pair must not swap places on screen.
  it("breaks a severity+confidence tie by id, whichever order it arrives in", () => {
    const a = finding({ id: "aaa", confidence: 0.9 });
    const b = finding({ id: "bbb", confidence: 0.9 });
    expect(rankFindings([b, a]).map((f) => f.id)).toEqual(["aaa", "bbb"]);
    expect(rankFindings([a, b]).map((f) => f.id)).toEqual(["aaa", "bbb"]);
  });

  it("drops a severity outside the contract rather than ranking it last", () => {
    expect(rankFindings([finding({ id: "bad", severity: "BOGUS" })])).toEqual([]);
  });

  /**
   * The case the "BOGUS" test above cannot reach, and the reason it pins
   * nothing on its own. The filter read `f.severity in RANK`, and `in` walks the
   * prototype chain — `RANK` comes from `Object.fromEntries`, so it carries
   * `Object.prototype` too, and every name below answered true. The row
   * survived, `RANK[severity]` resolved to a method on `Object.prototype`, the
   * comparator's first term was `NaN`, and the sort fell through to confidence,
   * so a bogus row at 0.9 sorted ahead of a real CRITICAL.
   *
   * The mirror of the same case in `server/src/modules/pulls/status.ts` —
   * `findings.severity` is plain `text` on both sides of the wire, and if only
   * one is guarded the two disagree about which rows exist.
   */
  it.each([
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "isPrototypeOf",
    "toLocaleString",
    "propertyIsEnumerable",
  ])("drops the inherited key %s, which the prototype chain answers for", (key) => {
    const out = rankFindings([
      finding({ id: "bogus", severity: key, confidence: 0.9 }),
      finding({ id: "real", severity: "CRITICAL", confidence: 0.1 }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["real"]);
  });
});

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

import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { MAX_FINDING_LINE_SPAN } from "./constants";
import {
  defaultOpenFor,
  fileFindingSummary,
  findingsByFileLine,
  gutterColours,
} from "./helpers";

/**
 * The pure half of Smart Diff's client side. Every input here is model-written
 * and stored in plain columns — `start_line`, `end_line` and `severity` are
 * clamped by `db/text.ts`, never validated — so the guards are the contract.
 */

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "…",
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: "…",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

describe("defaultOpenFor", () => {
  it("collapses boilerplate whatever its size", () => {
    expect(defaultOpenFor("boilerplate")).toBe(false);
  });

  it("leaves core and wiring to the card's own size rule", () => {
    expect(defaultOpenFor("core")).toBeUndefined();
    expect(defaultOpenFor("wiring")).toBeUndefined();
  });
});

describe("findingsByFileLine", () => {
  it("claims every line in a finding's range", () => {
    const byFile = findingsByFileLine([finding({ id: "f1", start_line: 4, end_line: 7 })]);
    expect([...byFile.get("src/a.ts")!.keys()]).toEqual([4, 5, 6, 7]);
  });

  it("drops a range whose end precedes its start instead of looping forever", () => {
    // `toInt4` clamps rather than rejects, so an inverted range really can
    // arrive. Without the guard the for-loop body never runs, but the file gets
    // an empty entry and reads as "has findings".
    const byFile = findingsByFileLine([finding({ id: "f1", start_line: 8, end_line: 2 })]);
    expect(byFile.has("src/a.ts")).toBe(false);
  });

  it("caps a runaway range at MAX_FINDING_LINE_SPAN", () => {
    const byFile = findingsByFileLine([
      finding({ id: "f1", start_line: 1, end_line: 2_000_000_000 }),
    ]);
    expect(byFile.get("src/a.ts")!.size).toBe(MAX_FINDING_LINE_SPAN);
  });

  it("ignores a dismissed finding entirely", () => {
    const byFile = findingsByFileLine([
      finding({ id: "f1", dismissed_at: "2026-08-07T00:00:00Z" }),
    ]);
    expect(byFile.size).toBe(0);
  });

  it("keeps files apart", () => {
    const byFile = findingsByFileLine([
      finding({ id: "f1", file: "src/a.ts" }),
      finding({ id: "f2", file: "src/b.ts" }),
    ]);
    expect([...byFile.keys()].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("orders a shared line worst-first", () => {
    const byFile = findingsByFileLine([
      finding({ id: "low", severity: "SUGGESTION" }),
      finding({ id: "high", severity: "CRITICAL" }),
      finding({ id: "mid", severity: "WARNING" }),
    ]);
    expect(byFile.get("src/a.ts")!.get(10)!.map((f) => f.id)).toEqual(["high", "mid", "low"]);
  });

  it("does not let a prototype-key severity outrank a real one", () => {
    // `SEVERITY_RANK[severity]` on a plain object literal resolves prototype
    // members, and a NaN comparator result is treated as 0 — which would leave
    // the bogus finding first and hand the gutter its colour.
    const byFile = findingsByFileLine([
      finding({ id: "rogue", severity: "constructor" as never }),
      finding({ id: "real", severity: "CRITICAL" }),
    ]);
    expect(byFile.get("src/a.ts")!.get(10)![0]!.id).toBe("real");
  });
});

describe("fileFindingSummary", () => {
  it("counts DISTINCT findings, not the lines they span", () => {
    // One finding over three lines is one finding. Counting lines is what the
    // contract's `finding_lines.length` does, and it badged "3".
    const lines = findingsByFileLine([
      finding({ id: "f1", start_line: 5, end_line: 7 }),
    ]).get("src/a.ts")!;
    expect(fileFindingSummary(lines)).toEqual({ count: 1, firstLine: 5 });
  });

  it("reports the lowest cited line as the scroll target", () => {
    const lines = findingsByFileLine([
      finding({ id: "f1", start_line: 40, end_line: 40 }),
      finding({ id: "f2", start_line: 12, end_line: 12 }),
    ]).get("src/a.ts")!;
    expect(fileFindingSummary(lines)).toEqual({ count: 2, firstLine: 12 });
  });

  it("returns null for a file with nothing on it", () => {
    expect(fileFindingSummary(new Map())).toBeNull();
  });
});

describe("gutterColours", () => {
  it("colours a line from the worst finding on it", () => {
    const lines = findingsByFileLine([
      finding({ id: "low", severity: "SUGGESTION" }),
      finding({ id: "high", severity: "CRITICAL" }),
    ]).get("src/a.ts")!;
    const critical = gutterColours(
      findingsByFileLine([finding({ id: "x", severity: "CRITICAL" })]).get("src/a.ts")!,
    ).get(10);
    expect(gutterColours(lines).get(10)).toBe(critical);
  });

  it("gives an unknown severity a colour rather than undefined", () => {
    const lines = findingsByFileLine([
      finding({ id: "rogue", severity: "nonsense" as never }),
    ]).get("src/a.ts")!;
    expect(typeof gutterColours(lines).get(10)).toBe("string");
  });
});

import { describe, it, expect } from "vitest";
import { diffLines, diffStat } from "./diff";

const ops = (before: string, after: string) =>
  diffLines(before, after).map((r) => `${r.op[0]}:${r.text}`);

describe("diffLines", () => {
  it("marks an unchanged body as entirely the same", () => {
    expect(ops("a\nb\nc", "a\nb\nc")).toEqual(["s:a", "s:b", "s:c"]);
    expect(diffStat(diffLines("a\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });

  it("finds a changed line in the middle, keeping its neighbours", () => {
    expect(ops("a\nb\nc", "a\nB\nc")).toEqual(["s:a", "r:b", "a:B", "s:c"]);
  });

  it("reports a pure insertion and a pure deletion", () => {
    expect(ops("a\nc", "a\nb\nc")).toEqual(["s:a", "a:b", "s:c"]);
    expect(ops("a\nb\nc", "a\nc")).toEqual(["s:a", "r:b", "s:c"]);
  });

  it("handles an empty side", () => {
    expect(diffStat(diffLines("", "a\nb"))).toEqual({ added: 2, removed: 0 });
    expect(diffStat(diffLines("a\nb", ""))).toEqual({ added: 0, removed: 2 });
  });

  it("keeps a moved block readable rather than pairing every line", () => {
    const rows = diffLines("x\na\nb", "a\nb\nx");
    expect(diffStat(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("does not lose content: every original line is same-or-removed, every new one same-or-added", () => {
    const before = "one\ntwo\nthree\nfour";
    const after = "one\ntwo point five\nthree\nfour\nfive";
    const rows = diffLines(before, after);
    expect(rows.filter((r) => r.op !== "add").map((r) => r.text)).toEqual(before.split("\n"));
    expect(rows.filter((r) => r.op !== "remove").map((r) => r.text)).toEqual(after.split("\n"));
  });

  it("falls back to block replacement instead of stalling on a huge middle", () => {
    const before = Array.from({ length: 900 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 900 }, (_, i) => `b${i}`).join("\n");
    const started = diffLines(before, after);
    expect(diffStat(started)).toEqual({ added: 900, removed: 900 });
  });
});

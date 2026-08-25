import { describe, it, expect } from "vitest";
import {
  expectationCount,
  filesInDiff,
  FINDING_SKELETON,
  lastRunState,
  parseExpectations,
} from "./helpers";
import type { EvalCaseRow } from "@/lib/types";

const row = (over: Partial<EvalCaseRow>): EvalCaseRow => ({
  id: "c1",
  name: "case",
  owner_kind: "agent",
  owner_id: "ag1",
  notes: null,
  expected_count: 1,
  last_run: null,
  ...over,
});

const runOf = (pass: boolean | null) => ({
  ran_at: "2026-05-29T09:14:00.000Z",
  pass,
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  findings_count: 1,
  skills: [],
});

describe("lastRunState — three states, not two", () => {
  it("separates never-run from failed", () => {
    // A case nobody ran has made no claim about the agent. Collapsing it into
    // "failed" puts a red mark on work that was never done (AC-14).
    expect(lastRunState(row({ last_run: null }))).toBe("never");
    expect(lastRunState(row({ last_run: runOf(false) }))).toBe("failed");
    expect(lastRunState(row({ last_run: runOf(true) }))).toBe("passed");
  });

  it("treats an errored run — `pass: null` — as failed, not as never run", () => {
    // AC-32 writes an errored case with `pass = false`, but the column is
    // nullable; a null must not read as "we never tried".
    expect(lastRunState(row({ last_run: runOf(null) }))).toBe("failed");
  });
});

describe("parseExpectations — the same contract the route parses with", () => {
  it("accepts an empty textarea as an empty expectation list", () => {
    // The mockup's `empty []` case: "nothing should be flagged here" is a real
    // assertion, not a missing value (spec D6).
    expect(parseExpectations("")).toEqual({ ok: true, value: [] });
    expect(parseExpectations("[]")).toEqual({ ok: true, value: [] });
  });

  it("accepts an expectation without an explicit polarity", () => {
    const out = parseExpectations('[{"file":"a.ts","start_line":1,"end_line":2}]');
    expect(out.ok).toBe(true);
  });

  it("names the syntax error on text that is not JSON", () => {
    const out = parseExpectations("{not json");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).not.toBe("");
  });

  it("REFUSES an expectation carrying an unknown field, rather than trimming it", () => {
    // The whole reason `EvalExpectation` is `.strict()`: Zod's default would
    // strip `bogus` and save a copy the author never wrote (C11, AC-19).
    const out = parseExpectations('[{"file":"a.ts","start_line":1,"end_line":1,"bogus":1}]');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("bogus");
  });

  it("refuses an object where the contract wants an array", () => {
    const out = parseExpectations('{"file":"a.ts","start_line":1,"end_line":1}');
    expect(out.ok).toBe(false);
  });

  it("refuses more than the 50-record ceiling", () => {
    const many = JSON.stringify(
      Array.from({ length: 51 }, () => ({ file: "a.ts", start_line: 1, end_line: 1 })),
    );
    expect(parseExpectations(many).ok).toBe(false);
  });
});

describe("expectationCount", () => {
  it("counts a valid list and refuses to guess at an invalid one", () => {
    expect(expectationCount('[{"file":"a.ts","start_line":1,"end_line":1}]')).toBe(1);
    expect(expectationCount("{not json")).toBe(0);
  });
});

describe("filesInDiff — the read-only Files tab", () => {
  it("lists the new-side path of every file the diff touches", () => {
    const diff = [
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -10,6 +10,7 @@",
      "+  stripeKey: 'sk_live_x'",
      "--- a/src/api/users.ts",
      "+++ b/src/api/users.ts",
      "@@ -1,3 +1,4 @@",
      "+import x from 'y'",
    ].join("\n");
    expect(filesInDiff(diff)).toEqual(["src/config.ts", "src/api/users.ts"]);
  });

  it("skips a deletion's /dev/null, which has no new-side path to show", () => {
    expect(filesInDiff("--- a/gone.ts\n+++ /dev/null\n")).toEqual([]);
  });

  it("lists a path once however many hunks it carries", () => {
    const diff = "+++ b/a.ts\n@@ -1 +1 @@\n+x\n+++ b/a.ts\n@@ -9 +9 @@\n+y";
    expect(filesInDiff(diff)).toEqual(["a.ts"]);
  });

  it("finds nothing in a --stat summary, which carries no hunks", () => {
    expect(filesInDiff(" src/config.ts | 2 +-\n 1 file changed")).toEqual([]);
  });
});

describe("FINDING_SKELETON — a template, not a real assertion", () => {
  it("has an empty file, so an unedited skeleton fails EvalExpectation's min(1) instead of saving as a phantom expectation", () => {
    // A hardcoded real path here (`src/config.ts`, copied once from the
    // mockup's own worked example) let a skeleton added on an unrelated case
    // save as a real, unsatisfiable `must_find` — caught 2026-08-23 from
    // three live eval cases carrying exactly that phantom entry.
    expect(FINDING_SKELETON.file).toBe("");
  });
});

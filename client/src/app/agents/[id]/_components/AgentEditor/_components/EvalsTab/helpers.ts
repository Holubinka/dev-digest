/** Pure helpers for the Evals tab and its case editor. No hooks, no JSX. */

import { EvalExpectations } from "@devdigest/shared";
import type { EvalCaseRow, EvalExpectationsInput } from "@/lib/types";

/**
 * The three states AC-14 requires, and they are three because "no run yet" is
 * not "failed": a case nobody has run says nothing about the agent, while a
 * failed one says something specific. `last_run: null` is the server's way of
 * spelling the third.
 */
export type LastRunState = "passed" | "failed" | "never";

export function lastRunState(row: EvalCaseRow): LastRunState {
  if (!row.last_run) return "never";
  return row.last_run.pass ? "passed" : "failed";
}

/**
 * Parse the case editor's `expected_output` textarea against the SAME contract
 * the route parses it with (AC-19). Two failures are possible and they need
 * different sentences: text that is not JSON at all, and JSON that is not an
 * expectation list — an object with an unknown field lands in the second,
 * because `EvalExpectation` is `.strict()` rather than Zod's default strip.
 */
export type ParsedExpectations =
  | { ok: true; value: EvalExpectationsInput }
  | { ok: false; reason: string };

export function parseExpectations(text: string): ParsedExpectations {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: [] };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "not JSON" };
  }

  const parsed = EvalExpectations.safeParse(json);
  if (parsed.success) return { ok: true, value: json as EvalExpectationsInput };

  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, reason: `${where}${issue?.message ?? "does not match the contract"}` };
}

/** How many expectations a textarea currently holds — 0 for empty or invalid. */
export function expectationCount(text: string): number {
  const parsed = parseExpectations(text);
  return parsed.ok ? parsed.value.length : 0;
}

/**
 * The file paths a unified diff touches, for the editor's read-only Files tab
 * (D13: `input_files` is derived, never edited). Reads the NEW side (`+++ b/x`)
 * because that is the side a finding cites; `/dev/null` is a deletion and has
 * no new-side path to show.
 */
export function filesInDiff(diff: string): string[] {
  const out: string[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+++ ")) continue;
    const raw = line.slice(4).trim().split("\t")[0] ?? "";
    if (raw === "" || raw === "/dev/null") continue;
    const path = raw.startsWith("b/") ? raw.slice(2) : raw;
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/**
 * A blank expectation the editor can append — the mockup's «Finding skeleton».
 *
 * `file: ""` is deliberate, not an oversight: `EvalExpectation.file` is
 * `z.string().min(1)` server-side, so an unedited skeleton fails to save
 * instead of silently persisting as a real (and wrong) assertion. An earlier
 * version hardcoded `src/config.ts` — copied from the mockup's own worked
 * example — and a skeleton added to an unrelated case saved a phantom
 * `must_find src/config.ts:1` that could never be satisfied, quietly
 * dragging recall and precision down on cases that had nothing to do with
 * that file (caught 2026-08-23 from real eval-run data).
 */
export const FINDING_SKELETON: EvalExpectationsInput[number] = {
  file: "",
  start_line: 1,
  end_line: 1,
  polarity: "must_find",
  severity: "CRITICAL",
  category: "security",
  title: "",
};

/** 0…1 → the whole-percent the mockups show. */
export function pct(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

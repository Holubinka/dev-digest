/**
 * Persist one eval run. Every case — passing OR failing — leaves a durable record: the verdict
 * with its per-practice evidence, the grounding result, resource metrics, the trace, git
 * provenance, and the configuration it ran under. The full model output is written alongside so
 * it can be re-read (or re-judged) later instead of being thrown away.
 *
 * `results/` is gitignored and append-only — deleting it is always safe.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { EVAL_CONFIG } from "../config.js";
import { RESULTS_DIR } from "../artifacts/paths.js";
import { gitInfo } from "../git.js";
import type { Result } from "../runtime/run-claude.js";
import type { Verdict } from "../scoring/llm-judge.js";

const RECORDS = join(RESULTS_DIR, "records.jsonl");
const OUTPUTS = join(RESULTS_DIR, "outputs");

// One id per process (per vitest run), same format as the trend reporter.
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const { sha: GIT_SHA, dirty: DIRTY } = gitInfo();

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "case";

export interface RecordData {
  result: Result;
  verdict?: Verdict;
  grounded?: number;
  threshold?: number;
  /**
   * Explicit pass/fail for workflow-tier cases (dispatch/activation/trace/contrast), which have
   * no grounding gate or judge verdict for the fallback below to lean on. The caller derives this
   * straight from the same boolean(s) its `expect()` checks, so it's the ONE place that has to
   * stay in sync with the assertion — no reliance on `!result.isError`, which only tells you the
   * SDK session ended cleanly, not that the thing under test was true. A session that finishes in
   * one empty turn (e.g. the model asks a clarifying question instead of acting) is "clean" by
   * that measure yet fails the real check; a session that overruns maxTurns AFTER the check
   * already passed is "unclean" yet the real check held. Omit for quality-tier cases, where the
   * grounding/verdict fallback below already matches their `expect()` exactly.
   */
  outcome?: boolean;
  extra?: Record<string, unknown>;
}

/**
 * Append a record for the currently-running test. Call from a `finally` so it fires even when
 * the assertions that follow it throw — that is what keeps a failing configuration's series
 * from being silently empty.
 */
export function record(label: string, data: RecordData): void {
  const { result, verdict, grounded, threshold, extra } = data;
  const state = expect.getState();
  const nodeid = `${state.testPath ?? "?"} > ${state.currentTestName ?? label}`;

  // outcome: an explicit caller-supplied verdict wins; else grounding gate failure short-circuits
  // to false; else the judge threshold; else "did the run itself succeed" (last resort — only
  // correct when there is truly nothing else to check the real result against).
  const outcome =
    data.outcome !== undefined
      ? data.outcome
      : grounded !== undefined && grounded < 1
        ? false
        : verdict && threshold !== undefined
          ? verdict.score >= threshold
          : !result.isError;

  const outDir = join(OUTPUTS, RUN_ID);
  mkdirSync(outDir, { recursive: true });
  const outputFile = join("outputs", RUN_ID, `${slugify(label)}.md`);
  writeFileSync(join(RESULTS_DIR, outputFile), result.text);

  const row = {
    schema: 1,
    run_id: RUN_ID,
    git_sha: GIT_SHA,
    dirty: DIRTY,
    config: EVAL_CONFIG,
    nodeid,
    label,
    outcome,
    score: verdict?.score,
    threshold,
    practices: verdict?.results ?? [],
    grounded,
    num_turns: result.numTurns,
    metrics: result.metrics,
    trace: {
      tools: result.toolsUsed,
      subagents: result.subagents,
      skills: result.skillsInvoked,
      reads: result.filesRead,
    },
    output_file: outputFile,
    ...extra,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  appendFileSync(RECORDS, JSON.stringify(row) + "\n");
}

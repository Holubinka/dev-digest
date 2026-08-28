/**
 * `runsPollInterval` — the timer behind `GET /pulls/:id/runs`.
 *
 * It is a request budget, not a preference: the route reads the PR's whole run
 * history, filtered on a `pr_id` that has no index, so every tick is a scan of a
 * table that only grows. The two speeds are what the test pins, because the
 * difference between them is ~9 requests per multi-run and nothing on screen
 * would show that either was wrong.
 */
import { describe, it, expect } from "vitest";
import type { RunSummary } from "@devdigest/shared";
import { RUNS_POLL_QUEUED_MS, RUNS_POLL_RUNNING_MS, runsPollInterval } from "./reviews";

const run = (status: string) => ({ status }) as RunSummary;

describe("runsPollInterval", () => {
  it("stops entirely once nothing is in flight", () => {
    expect(runsPollInterval([run("done"), run("failed"), run("cancelled")])).toBe(false);
    expect(runsPollInterval([])).toBe(false);
    expect(runsPollInterval(undefined)).toBe(false);
  });

  it("polls fast while a run is actually running", () => {
    expect(runsPollInterval([run("done"), run("running")])).toBe(RUNS_POLL_RUNNING_MS);
  });

  /**
   * The case that pays for this function. A multi-run at a ceiling of three
   * leaves seven agents `queued` through two waves, and the old predicate gave
   * that whole window the 4-second interval a `running` run gets — ~13 scans to
   * learn about one promotion.
   */
  it("backs off while everything in flight is only waiting for a slot", () => {
    expect(runsPollInterval([run("done"), run("queued"), run("queued")])).toBe(
      RUNS_POLL_QUEUED_MS,
    );
    expect(RUNS_POLL_QUEUED_MS).toBeGreaterThan(RUNS_POLL_RUNNING_MS);
  });

  /** A wave in progress: the running run sets the pace for the queued ones too,
   *  because its own row is changing. */
  it("keeps the fast pace when a run is running beside the waiting ones", () => {
    expect(runsPollInterval([run("running"), run("queued")])).toBe(RUNS_POLL_RUNNING_MS);
  });

  /** `RunSummary.status` is a nullable string on the wire, not an enum. */
  it("treats an unknown or missing status as nothing in flight", () => {
    expect(runsPollInterval([{ status: null } as RunSummary, run("weird")])).toBe(false);
  });
});

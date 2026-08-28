import { describe, it, expect } from "vitest";
import type { AgentColumn, ConflictTake, MultiAgentRun } from "@devdigest/shared";
import type { ColumnStreamState } from "@/lib/hooks/multi-agent";
import {
  emptyReason,
  fileRefHref,
  isConflict,
  liveColumns,
  parallelSpeedup,
  runCounts,
  runStateKey,
  visiblePositions,
} from "./helpers";

const take = (verdict: ConflictTake["verdict"], runId: string = verdict): ConflictTake => ({
  run_id: runId,
  agent_id: runId,
  persona: runId,
  verdict,
  note: verdict === "ignored" || verdict === "not_reviewed" ? null : "because",
});

const column = (status: AgentColumn["status"], runId: string = status): AgentColumn =>
  ({
    run_id: runId,
    agent_id: runId,
    agent_name: runId,
    agent_deleted: false,
    provider: null,
    model: null,
    status,
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
  }) as AgentColumn;

describe("isConflict", () => {
  /* The rule the mockup's prototype does NOT implement. `flagged = verdict !==
     "ignored"` (`screen.jsx:35`) counts a crashed run as a flag, which turns
     every one of these answers upside down. */
  it("drops `not_reviewed` takes before asking anything about agreement (AC-126)", () => {
    // One agent flagged, the other two never ran: nobody disagreed with anybody.
    expect(
      isConflict([take("CRITICAL", "r1"), take("not_reviewed", "r2"), take("not_reviewed", "r3")]),
    ).toBe(false);
  });

  it("is not a conflict when fewer than two takes survive the filter (AC-127)", () => {
    expect(isConflict([take("CRITICAL", "r1"), take("not_reviewed", "r2")])).toBe(false);
    expect(isConflict([take("not_reviewed", "r1"), take("not_reviewed", "r2")])).toBe(false);
    expect(isConflict([take("WARNING", "r1")])).toBe(false);
  });

  /* The human's call on 2026-08-27: one agent flags, the finished rest stay
     silent, and that is AGREEMENT. Counting it as a conflict is what left the
     toggle hiding nothing at all. */
  it("is not a conflict when one flagged and another looked and passed", () => {
    expect(isConflict([take("WARNING", "r1"), take("ignored", "r2")])).toBe(false);
  });

  it("is a conflict when two flagged at different severities", () => {
    expect(isConflict([take("CRITICAL", "r1"), take("SUGGESTION", "r2")])).toBe(true);
  });

  it("is not a conflict when the finished agents agree, whatever the others did", () => {
    expect(isConflict([take("WARNING", "r1"), take("WARNING", "r2")])).toBe(false);
    expect(
      isConflict([take("WARNING", "r1"), take("WARNING", "r2"), take("not_reviewed", "r3")]),
    ).toBe(false);
    expect(isConflict([take("ignored", "r1"), take("ignored", "r2")])).toBe(false);
  });

  /* Edge case named in the spec: two finished agents disagree while a third is
     still running. The live run neither makes nor unmakes the disagreement. */
  it("is a conflict decided by the two that finished, even while a third runs", () => {
    expect(
      isConflict([take("CRITICAL", "r1"), take("SUGGESTION", "r2"), take("not_reviewed", "r3")]),
    ).toBe(true);
  });
});

describe("visiblePositions", () => {
  const conflicting = {
    file: "a.ts",
    start_line: 1,
    end_line: 1,
    title: "one",
    takes: [take("WARNING", "r1"), take("CRITICAL", "r2")],
  };
  const lonely = {
    file: "b.ts",
    start_line: 2,
    end_line: 2,
    title: "two",
    takes: [take("WARNING", "r1"), take("not_reviewed", "r2")],
  };

  it("shows every position with the toggle off, `not_reviewed` takes included (AC-75, AC-128)", () => {
    expect(visiblePositions([conflicting, lonely], false)).toHaveLength(2);
  });

  it("keeps only the conflicts with the toggle on (AC-76, AC-127)", () => {
    expect(visiblePositions([conflicting, lonely], true)).toEqual([conflicting]);
  });
});

describe("liveColumns", () => {
  const stream = (started: boolean): ColumnStreamState => ({
    lastMsg: null,
    started,
    closed: false,
  });

  it("promotes a queued column whose stream announced it took a slot (AC-78)", () => {
    const columns = [column("queued", "r1")];

    const next = liveColumns(columns, { r1: stream(true) });

    expect(next[0]?.status).toBe("running");
  });

  it("leaves a queued column alone when its stream has not announced a start", () => {
    const columns = [column("queued", "r1")];

    const next = liveColumns(columns, { r1: stream(false) });

    expect(next[0]?.status).toBe("queued");
  });

  it("leaves a queued column alone when it has no stream at all (AC-148)", () => {
    const columns = [column("queued", "r1")];

    const next = liveColumns(columns, {});

    expect(next[0]?.status).toBe("queued");
  });

  it("never touches a running, done, failed or cancelled column, even with a started stream", () => {
    for (const status of ["running", "done", "failed", "cancelled"] as const) {
      const columns = [column(status, "r1")];
      const next = liveColumns(columns, { r1: stream(true) });
      expect(next[0]?.status).toBe(status);
    }
  });

  it("returns the SAME array reference when nothing is promoted", () => {
    const columns = [column("done", "r1"), column("queued", "r2")];

    const next = liveColumns(columns, { r2: stream(false) });

    expect(next).toBe(columns);
  });

  it("returns a new array when something is promoted, reusing the untouched sibling column", () => {
    const columns = [column("queued", "r1"), column("done", "r2")];

    const next = liveColumns(columns, { r1: stream(true) });

    expect(next).not.toBe(columns);
    expect(next[0]?.status).toBe("running");
    expect(next[1]).toBe(columns[1]);
  });
});

describe("runCounts", () => {
  it("counts queued with running, and failed with cancelled", () => {
    const counts = runCounts([
      column("done", "r1"),
      column("running", "r2"),
      column("queued", "r3"),
      column("failed", "r4"),
      column("cancelled", "r5"),
    ]);

    expect(counts).toEqual({ agents: 5, done: 1, running: 2, never: 2, anyLive: true });
  });
});

describe("emptyReason", () => {
  const counts = (over: Partial<ReturnType<typeof runCounts>>) => ({
    agents: 4,
    done: 4,
    running: 0,
    never: 0,
    anyLive: false,
    ...over,
  });

  /* AC-132 fixes the order, and the order is the whole answer: two of these
     conditions hold at once more often than not. */
  it("says 'nobody to compare with' first, even when that one agent also failed", () => {
    expect(emptyReason(counts({ agents: 1, done: 0, never: 1 }), 0)).toBe("one-agent");
  });

  it("says 'nothing to compare yet' when fewer than two runs reached done", () => {
    expect(emptyReason(counts({ agents: 4, done: 1, never: 3 }), 0)).toBe("unfinished");
    expect(emptyReason(counts({ agents: 4, done: 0, running: 4, anyLive: true }), 0)).toBe(
      "unfinished",
    );
    // Positions may already exist from the one agent that finished — the reason
    // is still that there is nothing to compare them WITH.
    expect(emptyReason(counts({ agents: 4, done: 1, never: 3 }), 3)).toBe("unfinished");
  });

  it("claims 'they found nothing' only once two runs actually finished (AC-111)", () => {
    expect(emptyReason(counts({ done: 2 }), 0)).toBe("nothing-found");
  });

  it("reads 'they agreed' as a RESULT when positions exist but none is a conflict (AC-112)", () => {
    expect(emptyReason(counts({ done: 4 }), 5)).toBe("agreed");
  });
});

describe("runStateKey", () => {
  it("gives one key per run state, and `running` reads as reviewing (AC-123)", () => {
    expect(runStateKey("queued")).toBe("runState.queued");
    expect(runStateKey("running")).toBe("runState.running");
    expect(runStateKey("done")).toBe("runState.done");
    expect(runStateKey("failed")).toBe("runState.failed");
    expect(runStateKey("cancelled")).toBe("runState.cancelled");
  });
});

describe("fileRefHref", () => {
  const ref = { file: "src/index.ts", start_line: 10, end_line: 12 };

  /* "NO SHA, NO LINK": an old multi-run predating the `head_sha` column has a
     known repo but no sha of its own — the quiet trap the docstring names, and
     exactly the shape the finding calls out. */
  it("builds no link when the multi-run has no head sha of its own, even with a known repo", () => {
    expect(fileRefHref("acme/repo", null, ref)).toBeUndefined();
  });

  it("builds no link when neither the repo nor the sha is known", () => {
    expect(fileRefHref(null, null, ref)).toBeUndefined();
  });

  /* The docstring's security claim: "The path itself stays hostile input and is
     treated as such by `githubBlobUrl`: it refuses any `..` segment". A model
     could write a `file` containing one; `fileRefHref` must not build a link
     around `githubBlobUrl`'s own refusal. */
  it("builds no link when the model-written file path carries a `..` segment", () => {
    expect(
      fileRefHref("acme/repo", "abc123", { file: "../../evil", start_line: 1, end_line: 1 }),
    ).toBeUndefined();
  });

  /* THE SHA IS THE MULTI-RUN'S, NEVER THE PR'S — the positive case, pinned in
     `githubBlobUrl`'s own documented shape:
     `https://github.com/{owner}/{repo}/blob/{sha}/{file}#L{start}[-L{end}]`. */
  it("builds the github.com blob link once both the repo and the multi-run's sha are known", () => {
    expect(fileRefHref("acme/repo", "abc123", ref)).toBe(
      "https://github.com/acme/repo/blob/abc123/src/index.ts#L10-L12",
    );
  });
});

/* The fan-out measurement. Each guard below is a case where the ratio would be
   on screen and wrong, not a hypothetical — `docs/multi-agent-review.md`
   § "What the fan-out bought, measured" states all three. */
describe("parallelSpeedup", () => {
  const timed = (durationMs: number | null, runId: string): AgentColumn => ({
    ...column("done", runId),
    duration_ms: durationMs,
  });

  const multiRun = (over: Partial<MultiAgentRun>): MultiAgentRun =>
    ({
      total_duration_ms: 10_000,
      total_duration_kind: "measured",
      columns: [timed(12_000, "a"), timed(12_000, "b")],
      ...over,
    }) as MultiAgentRun;

  it("divides the summed agent durations by the observed wall clock", () => {
    expect(parallelSpeedup(multiRun({}))).toBe(2.4);
  });

  /* The one-agent row of the doc's table reads 0.85×, because wall clock counts
     the shared pre-work no agent's own duration does. Nothing overlapped, so
     there is no comparison to draw. */
  it("says nothing when there was only one agent to overlap", () => {
    expect(parallelSpeedup(multiRun({ columns: [timed(8_000, "a")] }))).toBeNull();
  });

  it("says nothing while the run is still going", () => {
    expect(parallelSpeedup(multiRun({ total_duration_kind: "elapsed" }))).toBeNull();
  });

  it("says nothing when the multi-run's own span was never recorded", () => {
    expect(
      parallelSpeedup(multiRun({ total_duration_kind: "interrupted", total_duration_ms: null })),
    ).toBeNull();
  });

  /* 4 of 93 dev run rows carry a null. Summing round it makes the numerator a
     floor, and a floor here can fall BELOW 1.0 — which inverts the claim rather
     than loosening it, so `≥` would not rescue it the way it rescues cost. */
  it("says nothing when any agent's own duration is missing", () => {
    expect(parallelSpeedup(multiRun({ columns: [timed(12_000, "a"), timed(null, "b")] }))).toBeNull();
  });
});

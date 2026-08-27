import { describe, it, expect } from "vitest";
import type { AgentColumn, ConflictTake } from "@devdigest/shared";
import type { ColumnStreamState } from "@/lib/hooks/multi-agent";
import { emptyReason, isConflict, liveColumns, runCounts, runStateKey, visiblePositions } from "./helpers";

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

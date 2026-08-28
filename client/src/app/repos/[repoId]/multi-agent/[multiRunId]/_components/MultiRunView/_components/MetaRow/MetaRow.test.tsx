/**
 * The fan-out measurement on the meta row (owner request, 2026-08-28 — absent
 * from the mockup, recorded in `multi-agent/DESIGN-WALK.md`).
 *
 * What this holds down that `helpers.test.ts` cannot: the qualification travels
 * with the number. "Sequential" was computed from the agents' own durations, not
 * observed — no `concurrency = 1` run was ever timed — so a bare "2.4× faster"
 * claims a measurement nobody took. The `title` is the requirement here, in the
 * shape `costPartialHint` already set for a number that needs a caveat.
 *
 * `fireEvent`, not `userEvent`: the latter is not a dependency of this project.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runs from "@/../messages/en/runs.json";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import { MetaRow } from "./MetaRow";

afterEach(cleanup);

const column = (durationMs: number | null, runId: string): AgentColumn =>
  ({
    run_id: runId,
    agent_id: runId,
    agent_name: runId,
    agent_deleted: false,
    provider: null,
    model: null,
    status: "done",
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: durationMs,
    cost_usd: 0.1,
    findings: [],
  }) as AgentColumn;

const multiRun = (over: Partial<MultiAgentRun> = {}): MultiAgentRun =>
  ({
    id: "mr-1",
    pr_id: "pr-1",
    pr_number: 482,
    pr_title: "Add rate limiting",
    head_sha: "abc123",
    ran_at: "2026-08-28T10:00:00Z",
    agent_count: 2,
    concurrency: 3,
    total_duration_ms: 10_000,
    total_duration_kind: "measured",
    total_cost_usd: 0.2,
    total_cost_partial: false,
    columns: [column(12_000, "a"), column(12_000, "b")],
    conflicts: [],
    ...over,
  }) as MultiAgentRun;

function renderRow(over: Partial<MultiAgentRun> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs }}>
      <MetaRow multiRun={multiRun(over)} />
    </NextIntlClientProvider>,
  );
}

describe("MetaRow — what the fan-out bought", () => {
  it("prints the ratio beside the duration, and says on hover that it was computed", () => {
    renderRow();
    const clause = screen.getByText(/faster than one at a time/);
    expect(clause.textContent).toBe("≈ 2.4× faster than one at a time");
    expect(clause.getAttribute("title")).toBe(runs.page.speedupHint);
  });

  it("leaves the ratio off entirely when it would be drawn from a partial sum", () => {
    renderRow({ columns: [column(12_000, "a"), column(null, "b")] });
    expect(screen.queryByText(/faster than one at a time/)).toBeNull();
  });
});

import type { AgentListItem, LastSuccessfulRun } from "@devdigest/shared";
import { DEFAULT_MULTI_RUN_CONCURRENCY } from "@devdigest/shared";
import { defaultSelection } from "@/lib/agent-selection";

/**
 * The pre-run estimate, over the CHOSEN agents only (AC-17…AC-23).
 *
 * TIME IS A SUM OF WAVE MAXIMA, cost is a plain sum. Only `concurrency` agents
 * run at once, so choosing more than that many buys another wave, not another
 * parallel slot: ten agents at a ceiling of three take four waves, and the old
 * "max over the chosen" under-reported that by about four times. One wave — the
 * only case where the old formula was true — still gives exactly the maximum
 * (AC-153).
 *
 * The waves are formed by DESCENDING duration (AC-152). That is not tidiness: a
 * wave model holds a slot idle until its slowest member finishes, which a real
 * worker pool does not, so this estimate runs HIGH. For a number somebody reads
 * before agreeing to pay, high is the right side to be wrong on.
 *
 * The two sums count different sets, which is why the misses are counted
 * separately: an agent whose last successful run reported no `cost_usd` still
 * contributes its `duration_ms` to its wave's maximum (AC-21), so it is missing
 * from one sum and present in the other.
 *
 * An agent with NO successful run breaks the model twice over — its own duration
 * is unknown, and so is what the wave it occupies will cost. Nothing is invented
 * for it: it takes a slot (AC-151) and contributes nothing, which makes the whole
 * number a LOWER BOUND rather than an estimate, and the caller must say so
 * (AC-154, `missingTime > 0`).
 *
 * `null` is "no contributor", never zero. AC-23 exists because `0.0s` and
 * `$0.00` are real, sayable numbers that mean something else entirely — a free
 * model, an instant run — and printing them for "we have no data" is the one
 * thing this estimate must not do.
 */
export interface RunEstimate {
  /** Sum of the per-wave maxima; null when no chosen agent has a duration. */
  durationMs: number | null;
  /** Sum of `cost_usd` over the chosen agents; null when none contributed. */
  costUsd: number | null;
  /** How many chosen agents gave nothing to the time sum — and made it a floor (AC-22, AC-154). */
  missingTime: number;
  /** How many chosen agents gave nothing to the cost sum (AC-22). */
  missingCost: number;
}

export function estimateRun(
  agentIds: string[],
  rows: LastSuccessfulRun[] | undefined,
  concurrency: number = DEFAULT_MULTI_RUN_CONCURRENCY,
): RunEstimate {
  const byAgent = new Map((rows ?? []).map((r) => [r.agent_id, r]));
  const chosen = [...new Set(agentIds)];

  let costUsd: number | null = null;
  let missingTime = 0;
  let missingCost = 0;
  for (const id of chosen) {
    const row = byAgent.get(id);
    if (row?.duration_ms == null) missingTime += 1;
    if (row?.cost_usd != null) costUsd = (costUsd ?? 0) + row.cost_usd;
    else missingCost += 1;
  }

  /* Longest first, agents with no history last. `sort` is stable, so within
     either group the caller's order survives — and the caller hands them over in
     the agents list's own order, which is the stable order AC-46 fixes for every
     other surface of this feature. */
  const ordered = [...chosen].sort(
    (a, b) => (byAgent.get(b)?.duration_ms ?? -1) - (byAgent.get(a)?.duration_ms ?? -1),
  );

  let durationMs: number | null = null;
  for (let i = 0; i < ordered.length; i += Math.max(1, concurrency)) {
    // Descending order means the wave's first member IS its maximum, but the
    // scan is written out anyway: it survives someone changing the sort.
    let waveMax: number | null = null;
    for (const id of ordered.slice(i, i + Math.max(1, concurrency))) {
      const ms = byAgent.get(id)?.duration_ms;
      if (ms != null && (waveMax == null || ms > waveMax)) waveMax = ms;
    }
    if (waveMax != null) durationMs = (durationMs ?? 0) + waveMax;
  }

  return { durationMs, costUsd, missingTime, missingCost };
}

/**
 * Whether "Select all" has nothing left to add — the same set `defaultSelection`
 * describes is already ticked.
 *
 * The action's label is DERIVED from this rather than stored: it reads
 * "Clear all" exactly when this is true, which is what makes AC-10 and AC-11 two
 * readings of one state instead of a flag that can fall out of step with the
 * ticks.
 */
export function isAllSelected(agents: AgentListItem[], selected: string[]): boolean {
  const all = defaultSelection(agents);
  return all.length > 0 && all.every((id) => selected.includes(id));
}

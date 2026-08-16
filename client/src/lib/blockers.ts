/* blockers.ts — how many findings of one review stand in the way of a merge.
   ONE definition, because two surfaces on the same page report it: the Overview
   banner (`PrBriefBanner`) and every run's own banner on Agent runs
   (`ReviewRunAccordion`). Two counts for one review is what this replaces. */

import type { RunSummary } from "@devdigest/shared";

/**
 * The blocker count the SERVER stored for this run, or 0 when no run row stands
 * behind the review.
 *
 * It is not a recount and it deliberately does not look at the findings. The
 * server computes `countBlockers(kept, agent.ciFailOn)`
 * (`server/src/modules/reviews/run-executor.ts:240`) — the agent's OWN CI gate
 * threshold, configured per agent. `findings.filter(f => f.severity ===
 * "CRITICAL")` hardcodes one threshold, so for any agent whose `ciFailOn` is not
 * `critical` it does not disagree with the stored number, it is simply wrong:
 * two runs over the same PR with identical severity counts can legitimately
 * report different `blockers` (`client/INSIGHTS.md` § "`blockers` on a run is not
 * a severity bucket").
 *
 * `?? 0` is not a claim of "we looked and found none": `VerdictBanner` renders
 * the findings count ALONE at zero rather than printing "0 blockers" (AC-66).
 *
 * KNOWN AND NOT FIXED HERE: the stored count is frozen when the run finishes, so
 * dismissing a critical on Agent runs does not move it. That is a server
 * question — the column is the server's to recompute — and it is recorded under
 * Open Questions in `client/INSIGHTS.md`. Recounting on the client to paper over
 * it reintroduces the hardcoded threshold above.
 */
export function blockersForRun(run: RunSummary | null | undefined): number {
  return run?.blockers ?? 0;
}

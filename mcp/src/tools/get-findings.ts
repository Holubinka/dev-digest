/**
 * `get_findings` (spec 06 step 7).
 *
 * Reads a review that has already run. Two decisions shape this file:
 *
 *   - **A run that has not finished is not an error.** It returns `isError:
 *     false` and `status: "running"` with a `next_step` that explicitly warns
 *     off `run_agent_on_pr`. `run_agent_on_pr` is the only writing tool and a
 *     second call is a second billed provider call, so a model reading "no
 *     findings" without that sentence is one step from starting one.
 *   - **`run_id` is optional.** The tool surface is human — repo slug and PR
 *     number — and the UUID is only ever the one `run_agent_on_pr` handed back
 *     on the ceiling path, which makes the follow-up exact instead of a guess.
 *
 * `buildFindingsResult` is also step 8's landing point: `run_agent_on_pr` hands
 * its finished run id here so both tools return byte-identical shapes.
 */

import { z } from 'zod';
import type { ApiClient } from '../api/client.js';
import { assertPrNumber, assertRepoSlug, type Resolver } from '../api/resolve.js';
import { ReviewSummary, RunSummary } from '../api/schemas.js';
import {
  invalidArgument,
  okResult,
  runFailed,
  type ToolTextResult,
} from '../errors.js';
import { FINDINGS_DEFAULT_LIMIT, SUMMARY_CHARS, projectFindings, truncate } from '../project.js';
import { isTerminal } from '../wait.js';

/** Exported so step 8's poll loop parses the same shape this tool selects from. */
export const RunList = z.array(RunSummary);
const ReviewList = z.array(ReviewSummary);

export const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface GetFindingsArgs {
  repo: string;
  pr: number;
  agent?: string;
  run_id?: string;
  severity?: Severity;
  limit?: number;
}

export interface FindingsDeps {
  client: ApiClient;
  resolver: Resolver;
  /** Injected so `elapsed_s` is testable without a real clock. */
  now?: () => number;
}

/** How many run ids an error lists before it gives up on being helpful. */
const MAX_LISTED_RUNS = 20;

export function runsPath(pullId: string): string {
  return `/pulls/${encodeURIComponent(pullId)}/runs`;
}

export function reviewsPath(pullId: string): string {
  return `/pulls/${encodeURIComponent(pullId)}/reviews`;
}

/** Newest first. `ran_at` is an ISO string, so lexicographic order is chronological. */
function byRanAtDesc(a: RunSummary, b: RunSummary): number {
  const at = a.ran_at ?? '';
  const bt = b.ran_at ?? '';
  if (at === bt) return 0;
  return at < bt ? 1 : -1;
}

function elapsedSeconds(run: RunSummary, now: () => number): number | undefined {
  if (!run.ran_at) return undefined;
  const startedAt = Date.parse(run.ran_at);
  if (Number.isNaN(startedAt)) return undefined;
  return Math.max(0, Math.round((now() - startedAt) / 1000));
}

/**
 * The in-progress result. `queued` and `running` both report `"running"` — the
 * distinction is the server's business and there is nothing different for the
 * model to do about it.
 */
export function inProgressResult(
  repo: string,
  pr: number,
  run: RunSummary,
  now: () => number,
): ToolTextResult {
  const elapsed = elapsedSeconds(run, now);
  return okResult({
    status: 'running',
    run_id: run.run_id,
    repo,
    pr,
    agent: run.agent_name,
    ...(elapsed !== undefined ? { elapsed_s: elapsed } : {}),
    next_step:
      'Still running. Call get_findings with the same run_id in about a minute. Do not call ' +
      'run_agent_on_pr again — that would start a second run and bill a second time.',
  });
}

interface Counts {
  critical: number;
  warning: number;
  suggestion: number;
}

function countBySeverity(findings: readonly { severity: Severity }[]): Counts {
  const counts: Counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical += 1;
    else if (f.severity === 'WARNING') counts.warning += 1;
    else counts.suggestion += 1;
  }
  return counts;
}

export interface FindingsResultInput {
  repo: string;
  pr: number;
  pullId: string;
  run: RunSummary;
  severity?: Severity;
  limit?: number;
}

/**
 * Fetch the review the finished run produced and project it (spec 06 step 7's
 * shape, reached by both step 7 and step 8).
 *
 * `counts` is over ALL of the review's findings, while `findings` is what
 * survived the severity filter and the limit — so a trimmed answer still says
 * how big the untrimmed one was.
 */
export async function buildFindingsResult(
  client: ApiClient,
  input: FindingsResultInput,
): Promise<ToolTextResult> {
  const reviews = await client.get(reviewsPath(input.pullId), ReviewList);
  const review = reviews.find((r) => r.run_id === input.run.run_id);

  if (!review) {
    throw invalidArgument(
      `Run ${input.run.run_id} on ${input.repo}#${input.pr} finished but its review is no ` +
        `longer in the API response — it was probably deleted in the DevDigest UI. Call ` +
        `get_findings without run_id for the latest surviving review.`,
    );
  }

  const all = review.findings;
  const selected = input.severity ? all.filter((f) => f.severity === input.severity) : all;
  const projected = projectFindings(selected, {
    limit: input.limit ?? FINDINGS_DEFAULT_LIMIT,
  });

  return okResult({
    repo: input.repo,
    pr: input.pr,
    agent: input.run.agent_name ?? review.agent_name ?? null,
    run_id: input.run.run_id,
    status: 'done',
    verdict: review.verdict,
    score: review.score,
    summary: review.summary ? truncate(review.summary, SUMMARY_CHARS) : null,
    counts: countBySeverity(all),
    findings: projected.findings,
    ...(projected.note !== undefined ? { note: projected.note } : {}),
  });
}

/** Runs whose agent matches `agent`, or every run when no agent was named. */
function narrowByAgent(runs: readonly RunSummary[], agent: string | undefined): RunSummary[] {
  if (agent === undefined) return [...runs];
  const wanted = agent.trim().toLowerCase();
  return runs.filter((r) => (r.agent_name ?? '').trim().toLowerCase() === wanted);
}

function agentDidNotRun(repo: string, pr: number, agent: string, runs: readonly RunSummary[]) {
  const names = [...new Set(runs.map((r) => r.agent_name).filter((n): n is string => !!n))];
  return invalidArgument(
    `No run by agent "${agent}" on ${repo}#${pr}. Agents that have run on this PR: ` +
      `${names.length ? names.join(', ') : 'none'}. Call get_findings without the agent ` +
      `argument, or run_agent_on_pr to start a review with "${agent}".`,
  );
}

function runIdNotFound(repo: string, pr: number, runId: string, runs: readonly RunSummary[]) {
  const ids = runs.slice(0, MAX_LISTED_RUNS).map((r) => r.run_id);
  return invalidArgument(
    `No run with id "${runId}" on ${repo}#${pr}. Known run ids: ` +
      `${ids.length ? ids.join(', ') : 'none'}. Call get_findings without run_id for the ` +
      `latest run.`,
  );
}

export async function getFindings(
  deps: FindingsDeps,
  args: GetFindingsArgs,
): Promise<ToolTextResult> {
  const now = deps.now ?? Date.now;
  const repo = assertRepoSlug(args.repo);
  const pr = assertPrNumber(args.pr);

  const pullId = await deps.resolver.pullId(repo, pr);
  const runs = await deps.client.get(runsPath(pullId), RunList);

  if (args.run_id !== undefined) {
    const run = runs.find((r) => r.run_id === args.run_id);
    if (!run) throw runIdNotFound(repo, pr, args.run_id, runs);
    if (!isTerminal(run.status)) return inProgressResult(repo, pr, run, now);
    if (run.status !== 'done') throw runFailed(run.status ?? 'failed', run.error);
    return buildFindingsResult(deps.client, {
      repo,
      pr,
      pullId,
      run,
      ...(args.severity !== undefined ? { severity: args.severity } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  }

  const candidates = narrowByAgent(runs, args.agent).sort(byRanAtDesc);
  if (candidates.length === 0) {
    if (args.agent !== undefined && runs.length > 0) {
      throw agentDidNotRun(repo, pr, args.agent, runs);
    }
    // No review has ever run here. Deliberately not `isError` and deliberately
    // carrying no `findings` key: an empty findings array would read as "this
    // pull request is clean", which is the one wrong answer this tool must never
    // give.
    return okResult({
      status: 'no_runs',
      repo,
      pr,
      next_step:
        'No review has run on this pull request yet. Call run_agent_on_pr with an agent name ' +
        'from list_agents to start one.',
    });
  }

  const done = candidates.find((r) => r.status === 'done');
  if (done) {
    return buildFindingsResult(deps.client, {
      repo,
      pr,
      pullId,
      run: done,
      ...(args.severity !== undefined ? { severity: args.severity } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  }

  const inFlight = candidates.find((r) => !isTerminal(r.status));
  if (inFlight) return inProgressResult(repo, pr, inFlight, now);

  // Everything that ran, failed or was cancelled. The newest one's own error
  // text is the most useful thing this tool can say.
  const newest = candidates[0]!;
  throw runFailed(newest.status ?? 'failed', newest.error);
}

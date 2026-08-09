/**
 * `run_agent_on_pr` (spec 06 step 8). The only tool here that writes, and the
 * only one that costs money.
 *
 * It does the whole job in one call — start, wait, return findings — because the
 * alternative (hand back a run id) makes the model sequence create → wait →
 * collect itself: three round trips and three chances to stall.
 *
 * Two rules are load-bearing and both are about the bill:
 *   - the body is always `{agentId}`, NEVER `{all: true}`: fanning out to every
 *     enabled agent multiplies the provider spend without being asked;
 *   - the ceiling never cancels the run and never returns `isError`. It returns
 *     the run id so the follow-up is `get_findings`, not a second review.
 */

import type { ApiClient } from '../api/client.js';
import { assertPrNumber, assertRepoSlug, type Resolver } from '../api/resolve.js';
import { ReviewStartResponse } from '../api/schemas.js';
import { ToolError, okResult, runFailed, type ToolTextResult } from '../errors.js';
import { RunList, buildFindingsResult, runsPath } from './get-findings.js';
import { waitForRun, type ProgressUpdate, type WaitResult } from '../wait.js';

export interface RunAgentArgs {
  repo: string;
  pr: number;
  agent: string;
}

export type RunProgressReporter = (
  update: ProgressUpdate & { ceilingMs: number },
) => void | Promise<void>;

export interface RunAgentDeps {
  client: ApiClient;
  resolver: Resolver;
  runTimeoutMs: number;
  /** Present only when the client sent a `progressToken` — see `makeProgressReporter`. */
  onProgress?: RunProgressReporter;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The `notifications/progress` params, named without importing the SDK. */
export interface ProgressFrame {
  progressToken: string | number;
  progress: number;
  total: number;
  message: string;
}

export type ProgressSender = (frame: ProgressFrame) => void | Promise<void>;

/**
 * A progress reporter, or `undefined` when the client sent no `progressToken`.
 *
 * The spec is explicit that progress notifications are sent ONLY for a request
 * that asked for them; an unsolicited one names a token the client never issued.
 * The decision lives here rather than inline in `index.ts` so it is a pure
 * function with a test, instead of a condition inside a process entrypoint.
 *
 * `progress` and `total` are seconds: the ceiling is the natural total, and it
 * makes a client's percentage mean "how close to giving up on waiting".
 */
export function makeProgressReporter(
  progressToken: string | number | undefined,
  send: ProgressSender,
): RunProgressReporter | undefined {
  if (progressToken === undefined) return undefined;
  return async (update) => {
    const elapsedS = Math.round(update.elapsedMs / 1000);
    await send({
      progressToken,
      progress: elapsedS,
      total: Math.round(update.ceilingMs / 1000),
      message: `${update.status ?? 'starting'} — ${elapsedS}s elapsed`,
    });
  };
}

function stillRunningResult(
  repo: string,
  pr: number,
  agent: string,
  runId: string,
  elapsedMs: number,
): ToolTextResult {
  return okResult({
    status: 'still_running',
    run_id: runId,
    repo,
    pr,
    agent,
    elapsed_s: Math.round(elapsedMs / 1000),
    next_step:
      `The review is still running. Call get_findings with run_id="${runId}" in a minute.`,
  });
}

export async function runAgentOnPr(
  deps: RunAgentDeps,
  args: RunAgentArgs,
): Promise<ToolTextResult> {
  const repo = assertRepoSlug(args.repo);
  const pr = assertPrNumber(args.pr);

  const pullId = await deps.resolver.pullId(repo, pr);
  const agent = await deps.resolver.agentId(args.agent);

  const started = await deps.client.post(
    `/pulls/${encodeURIComponent(pullId)}/review`,
    { agentId: agent.id },
    ReviewStartResponse,
  );
  const run = started.runs.find((r) => r.agent_id === agent.id) ?? started.runs[0];
  if (!run) {
    throw new ToolError(
      'run_failed',
      `DevDigest accepted the review request for agent "${agent.name}" on ${repo}#${pr} but ` +
        `started no run. The agent is probably disabled — call list_agents to check, and ask ` +
        `the user to enable it in the DevDigest UI.`,
    );
  }
  const runId = run.run_id;

  // From here on a run is live and billing. A failure while WAITING must still
  // name the run id, or the model's only way forward is to start a second one.
  // The try covers the poll loop and nothing else, so its message stays true.
  let result: WaitResult;
  try {
    result = await waitForRun({
      runId,
      ceilingMs: deps.runTimeoutMs,
      poll: async () => {
        const runs = await deps.client.get(runsPath(pullId), RunList);
        return runs.find((r) => r.run_id === runId);
      },
      ...(deps.onProgress
        ? {
            onProgress: (update: ProgressUpdate) =>
              deps.onProgress?.({ ...update, ceilingMs: deps.runTimeoutMs }),
          }
        : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ToolError(
      'api_error',
      `The review started (run_id="${runId}") but waiting for it failed: ${detail} ` +
        `The run is still going — call get_findings with that run_id rather than ` +
        `run_agent_on_pr, which would start a second billed run.`,
      { cause: err },
    );
  }

  if (result.outcome === 'ceiling') {
    return stillRunningResult(repo, pr, agent.name, runId, result.elapsedMs);
  }
  if (result.run.status !== 'done') {
    throw runFailed(result.run.status ?? 'failed', result.run.error);
  }
  return buildFindingsResult(deps.client, { repo, pr, pullId, run: result.run });
}

import {
  CiResultArtifact,
  type GitHubClient,
  type RepoRef,
  type WorkflowRunRef,
} from '@devdigest/shared';
import type { PinoLike } from '../../platform/run-logger.js';
import { ValidationError } from '../../platform/errors.js';
import {
  ARTIFACT_NAME,
  MAX_ARCHIVE_BYTES,
  POLL_WINDOW_MS,
  RUNS_PER_POLL,
  workflowFileFor,
} from './constants.js';
import { agentSlug as agentSlugFor } from './generate/slug.js';
import { parseRepoRef, readArtifactJson, runStatusFromArtifact } from './helpers.js';
import type { CiRepository } from './repository.js';
import type { CiContainer, IngestOutcome, InstallationTarget, PollError } from './types.js';

/**
 * Pull-based ingest: poll Actions, read `devdigest-result`, write `ci_runs`.
 *
 * TWO KINDS OF FAILURE, and keeping them apart is most of this file.
 *
 * A REJECTED ARTIFACT (`ValidationError`) is a decision about one run: the
 * archive was too big, held other than one file, was not JSON, failed
 * `CiResultArtifact`, or claimed a PR, a repository or an AGENT the workflow run
 * does not belong to. It is logged, no row is written, and the poll carries on —
 * the repository was reachable and the answer was read (AC-71, AC-72, AC-74,
 * AC-143).
 *
 * A FAILED POLL is anything else thrown while talking to Actions: the API
 * refusing, a timeout, a token without permission. It becomes one entry in
 * `errors[]` for that repository (AC-83) and, decisively, does NOT stamp
 * `last_polled_at` (AC-129). Per installation, so one repository's failure
 * neither aborts the others nor stamps them.
 *
 * The token is `container.github()`'s, which resolves through `SecretsProvider`.
 * Nothing here reads `process.env` or `AppConfig` (AC-69).
 */

export interface IngestInput {
  workspaceId: string;
  /** The Refresh button (AC-68). `false` honours the 5-minute window (AC-121). */
  force: boolean;
}

/**
 * A rejection that also says WHO is running in this installation's file.
 *
 * Still a `ValidationError`, so the per-run catch that keeps one bad artifact
 * from ending a poll needs no change (AC-143). The extra field is what the CI
 * tab needs afterwards: "not confirmed" is not actionable, "this file runs
 * general-reviewer" is (AC-149).
 */
class ForeignAgentError extends ValidationError {
  constructor(
    readonly agent: string,
    message: string,
  ) {
    super(message);
  }
}

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class CiIngestExecutor {
  constructor(
    private container: CiContainer,
    private repo: CiRepository,
    private log: PinoLike,
  ) {}

  async run(input: IngestInput): Promise<IngestOutcome> {
    const targets = await this.repo.listTargets(input.workspaceId);
    const errors: PollError[] = [];
    let polled = 0;
    let accepted = 0;
    let rejected = 0;

    // Resolved once and shared, so a workspace with six installations reads the
    // token once — and, when there is no token, reports the same named cause
    // per repository instead of failing the whole refresh.
    let client: Promise<GitHubClient> | undefined;
    const github = (): Promise<GitHubClient> => (client ??= this.container.github());

    for (const target of targets) {
      if (!input.force && this.withinWindow(target.lastPolledAt)) continue;
      try {
        const gh = await github();
        const ref = parseRepoRef(target.repo);
        // THIS installation's file, derived from its own agent (AC-68, AC-135).
        // While it was one constant per repository, a workspace with two agents
        // in one repository polled the same file twice and attributed both
        // installations to whatever ran there.
        const agentSlug = agentSlugFor({ id: target.agentId, name: target.agentName });
        const runs = await gh.listWorkflowRuns(ref, workflowFileFor(agentSlug), {
          perPage: RUNS_PER_POLL,
        });

        // `null` is an ANSWER (AC-147): Actions has no such workflow, so this
        // installation cannot be confirmed. It counts as a poll and stamps the
        // time — the repository replied — while a thrown error does neither.
        if (runs === null) {
          polled += 1;
          await this.repo.recordPoll(target.id, new Date(), {
            workflowPresent: false,
            observedAgent: null,
          });
          continue;
        }

        let observedAgent: string | null = null;
        for (const run of runs) {
          try {
            if (await this.ingestRun(gh, target, ref, agentSlug, run)) accepted += 1;
          } catch (err) {
            if (!(err instanceof ValidationError)) throw err;
            rejected += 1;
            if (err instanceof ForeignAgentError) observedAgent ??= err.agent;
            this.log.warn(
              { repo: target.repo, runId: run.id, reason: err.message },
              'ci ingest: artifact rejected',
            );
          }
        }
        polled += 1;
        // The LAST statement of the success branch, and not a `finally`: the
        // stamp means "this repository's Actions answered", and a failed
        // attempt must leave the previous value exactly where it was.
        await this.repo.recordPoll(target.id, new Date(), {
          workflowPresent: true,
          observedAgent,
        });
      } catch (err) {
        const reason = (err as Error).message;
        errors.push({ repo: target.repo, reason });
        this.log.warn({ repo: target.repo, reason }, 'ci ingest: poll failed');
      }
    }
    return { errors, polled, accepted, rejected };
  }

  /** A repository polled successfully less than 5 minutes ago is not polled again. */
  private withinWindow(lastPolledAt: Date | null): boolean {
    if (lastPolledAt === null) return false;
    return Date.now() - lastPolledAt.getTime() < POLL_WINDOW_MS;
  }

  /** One workflow run. `true` when it produced a row. */
  private async ingestRun(
    gh: GitHubClient,
    target: InstallationTarget,
    ref: RepoRef,
    agentSlug: string,
    run: WorkflowRunRef,
  ): Promise<boolean> {
    const artifacts = await gh.listRunArtifacts(ref, run.id);
    // ONLY the artifact this feature writes, and only from runs of this
    // workflow — `listWorkflowRuns` is already scoped to the file (AC-70).
    const artifact = artifacts.find((a) => a.name === ARTIFACT_NAME);
    if (!artifact) return false;
    if (artifact.expired) {
      this.log.info({ repo: target.repo, runId: run.id }, 'ci ingest: artifact expired');
      return false;
    }

    const bytes = await gh.downloadArtifact(ref, artifact.id, MAX_ARCHIVE_BYTES);
    const parsed = CiResultArtifact.safeParse(readArtifactJson(bytes));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || '(root)';
      throw new ValidationError(`artifact failed CiResultArtifact at "${field}": ${issue?.message}`);
    }
    const result = parsed.data;

    // Attribution comes from the workflow-run metadata, never from the body
    // (AC-73). These two checks are what stops a file written inside someone
    // else's repository from claiming a run that is not its own (AC-74).
    if (run.repository !== target.repo) {
      throw new ValidationError(
        `run belongs to "${run.repository}" but the installation is for "${target.repo}"`,
      );
    }
    if (result.pr_number != null && result.pr_number !== run.pr_number) {
      throw new ValidationError(
        `artifact claims PR #${result.pr_number}, the run is for ` +
          (run.pr_number === null ? 'no PR' : `PR #${run.pr_number}`),
      );
    }
    // AC-143. The run came out of THIS installation's workflow file, so an
    // artifact naming another agent means the file no longer runs the agent
    // this installation is for — a hand edit, or a bundle from before workflows
    // were per-agent. Refusing is the same shape as the two checks above: no
    // row is written, and the poll goes on to the next run.
    if (result.agent !== agentSlug) {
      throw new ForeignAgentError(
        result.agent,
        `artifact names agent "${result.agent}", the installation is for "${agentSlug}"`,
      );
    }

    const state = runStatusFromArtifact(result.status);
    if (state.unrecognised !== null) {
      // Named, dropped, and the row is still written (AC-132): the bundle in a
      // target repository is whatever version was committed there, and refusing
      // an unknown state would stop ingest for every repo still on an older
      // runner, silently and repo by repo.
      this.log.warn(
        { repo: target.repo, runId: run.id, status: state.unrecognised },
        'ci ingest: unrecognised run state — stored empty',
      );
    }

    const ranAt = toDate(run.run_started_at) ?? toDate(run.updated_at);
    const { inserted } = await this.repo.upsertRun({
      ciInstallationId: target.id,
      repo: run.repository,
      workflowRunId: run.id,
      prNumber: run.pr_number,
      ranAt,
      status: state.status,
      findingsCount: result.findings_count,
      costUsd: money(result.cost_usd),
      githubUrl: run.html_url,
      agent: result.agent,
      durationMs: result.duration_ms ?? null,
      headSha: run.head_sha,
      bundleVersion: result.version ?? null,
      verdict: result.verdict ?? null,
    });

    // Only when the statement INSERTED. A second poll over the same run updates
    // the `ci_runs` row (AC-75) and must not add a second entry to the run
    // history, which would double the workspace's recorded CI cost.
    if (inserted) {
      await this.repo.insertAgentRun({
        workspaceId: target.workspaceId,
        agentId: target.agentId,
        repo: target.repo,
        prNumber: run.pr_number,
        ranAt,
        status: state.status,
        findingsCount: result.findings_count,
        costUsd: money(result.cost_usd),
        durationMs: result.duration_ms ?? null,
      });
    }
    return true;
  }
}

/**
 * A cost from the artifact, or null.
 *
 * `CiResultArtifact.cost_usd` is `z.number().nullable()`, and Zod's `number`
 * rejects only `NaN` — `1e999` parses to `Infinity` and Postgres
 * `double precision` accepts it. `pulls/routes.ts` sums this column for the PR
 * list's total, so one artifact from a repository DevDigest does not control
 * would poison a workspace's recorded spend permanently, and the sum would then
 * serialise as `null` through `JSON.stringify`. The sibling integer fields were
 * bounded for exactly this reason; this one was left out.
 */
function money(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

import type { Container } from '../../platform/container.js';
import type {
  AgentColumn,
  AgentColumnStatus,
  LastSuccessfulRun,
  MultiAgentRun,
  MultiAgentRunCreated,
  MultiAgentRunRef,
} from '@devdigest/shared';
import { DEFAULT_MULTI_RUN_CONCURRENCY } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { MultiRunRepository, ReviewRepository } from './repository.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { buildConflicts } from './conflicts.js';
import {
  summaryDuration,
  toAgentColumn,
  toMultiAgentRunRef,
  toReviewAgent,
  toReviewPull,
  toReviewRepo,
} from './helpers.js';
import type { ReviewAgent } from './types.js';

/*
 * HOW MANY AGENTS OF ONE MULTI-RUN EXECUTE AT ONCE is
 * `DEFAULT_MULTI_RUN_CONCURRENCY`, imported above from the shared contract
 * (SPEC-05 § AC-32/AC-33, AC-140, D26). There is no constant of that meaning in
 * this module any more: a second literal is exactly the drift D26 removed —
 * Configure run said "in-process fan-out" while the results page said "up to 3 at
 * a time", because only the server's copy of the number existed and the client
 * could not reach it.
 *
 * The number is still STORED on the multi-run row (AC-142), and the results page
 * prints THAT (AC-143), so a comparison run under an older ceiling is not
 * redescribed by today's default (AC-144).
 */

/** Runs whose state can still change — the rest of the multi-run is waiting. */
const TERMINAL: ReadonlySet<AgentColumnStatus> = new Set<AgentColumnStatus>([
  'done',
  'failed',
  'cancelled',
]);

/**
 * Multi-runs THIS process is still executing — the difference between "not
 * finished yet" and "nobody will ever finish it" (AC-158).
 *
 * Without it there is a real window, and it is the exact moment the page reads:
 * the last run publishes its terminal state on the bus, the client's stream
 * closes and it refetches (AC-134), while the `finished_at` write is still in
 * flight. Every column would be terminal with no completion recorded — the
 * signature of a multi-run the reaper closed after a restart — and a perfectly
 * ordinary run would flash "interrupted".
 *
 * Process-local on purpose: after a restart the set is empty, which is precisely
 * the condition AC-158 names. Module scope rather than a field so it survives the
 * per-request `MultiRunService` instances, the same way `runBus` does.
 */
const EXECUTING_HERE = new Set<string>();

/**
 * SPEC-05 — one fan-out of a chosen SET of agents over one pull request, and
 * everything read back off it.
 *
 * Inside `modules/reviews/` rather than a slice of its own, and that is a
 * constraint rather than a preference: it needs `ReviewRunExecutor` and
 * `ReviewRepository`, and `no-cross-module` forbids an edge between two
 * `modules/<slice>/` folders — an `import type` included, since
 * dependency-cruiser runs with `tsPreCompilationDeps`.
 *
 * Both repositories — and the executor — arrive as constructor PARAMETERS with
 * defaults (`onion-architecture` §3.3): call sites stay unchanged and a unit
 * test can hand this class a fake without monkey-patching a private field.
 */
export class MultiRunService {
  constructor(
    private container: Container,
    private repo = new MultiRunRepository(container.db),
    private reviews = new ReviewRepository(container.db),
    private executor = new ReviewRunExecutor(container, reviews, container.agentsRepo),
  ) {}

  /**
   * Start a multi-run over a client-named set of agents.
   *
   * The order of the three failures below is the criteria's order and not an
   * accident: every unknown agent id refuses the WHOLE request (AC-28) and it
   * does so BEFORE any row is written, because AC-27, AC-28 and AC-30 all end in
   * the same words — nothing created.
   */
  async create(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRunCreated> {
    // AC-29: the same id twice counts once, first-seen order preserved. After
    // the route's `.max(10)`, which caps the array AS NAMED — eleven ids of
    // which nine are unique is refused before this line runs (AC-30).
    const unique = [...new Set(agentIds)];

    const agents: AgentRow[] = [];
    for (const id of unique) {
      const agent = await this.container.agentsRepo.getById(workspaceId, id);
      // "Not found", never "forbidden": an agent of another workspace has to be
      // indistinguishable from one that does not exist (§ Untrusted inputs).
      if (!agent) throw new NotFoundError('Agent not found');
      agents.push(agent);
    }

    return this.launch(workspaceId, prId, agents, [], logger);
  }

  /**
   * Re-run the stored set on the same PR, skipping agents that no longer exist.
   *
   * THIS IS WHY RE-RUN HAS ITS OWN ROUTE. AC-28 refuses a request naming an
   * unknown agent and AC-117 requires the rest to run anyway; the two are only
   * compatible when the set comes from storage rather than from the client, so
   * "the client named a stale id" and "the stored set went stale" stay two
   * different questions with two different answers.
   */
  async rerun(
    workspaceId: string,
    multiRunId: string,
    logger?: Logger,
  ): Promise<MultiAgentRunCreated> {
    const stored = await this.repo.agentIdsOfMultiRun(workspaceId, multiRunId);
    if (!stored) throw new NotFoundError('Multi-agent run not found');

    const agents: AgentRow[] = [];
    const skipped: { agent_id: string; agent_name: string }[] = [];
    for (const { agentId, agentName } of stored.agents) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      // The snapshotted name, not a placeholder: the agent row is gone, and this
      // is the only place its name still exists (AC-117).
      if (agent) agents.push(agent);
      else skipped.push({ agent_id: agentId, agent_name: agentName });
    }

    if (agents.length === 0) {
      throw new AppError(
        'multi_run_no_agents',
        'None of this run\'s agents still exists in the workspace',
        400,
      );
    }

    return this.launch(workspaceId, stored.prId, agents, skipped, logger);
  }

  /**
   * Write the multi-run and hand its runs to the executor.
   *
   * Shared by `create` and `rerun` so a re-run is a NEW multi-run by
   * construction, leaving the previous one reachable at its own link
   * (AC-115) rather than mutating it in place.
   */
  private async launch(
    workspaceId: string,
    prId: string,
    agents: AgentRow[],
    skipped: { agent_id: string; agent_name: string }[],
    logger?: Logger,
  ): Promise<MultiAgentRunCreated> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // AC-46: one order on all four surfaces, and it is the order the existing
    // agents list already returns (`AgentsRepository.list`: createdAt asc, then
    // name asc). Applied HERE, before the items get their `position`, so the
    // stored order survives an agent being deleted from the workspace later.
    const ordered = [...agents].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

    const { multiRunId, runIds } = await this.repo.createMultiRun({
      workspaceId,
      prId,
      // The head every run of this multi-run saw. Snapshotted, because it is
      // what lets a moved line be warned about later (AC-109) — reading the PR's
      // CURRENT head at that point would make the warning silent exactly when it
      // is needed.
      headSha: pull.headSha,
      concurrency: DEFAULT_MULTI_RUN_CONCURRENCY,
      items: ordered.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        provider: agent.provider,
        model: agent.model,
      })),
    });

    const jobs: { agent: ReviewAgent; runId: string }[] = ordered.map((agent, i) => ({
      agent: toReviewAgent(agent),
      runId: runIds[i]!,
    }));

    EXECUTING_HERE.add(multiRunId);

    // Fire-and-forget, the shape `ReviewService.runReview` uses at
    // `service.ts:155`: the POST answers now with the ids the client subscribes
    // to, and each run persists as it finishes.
    void this.executor
      .executeRuns(
        workspaceId,
        toReviewPull(pull),
        toReviewRepo(repo),
        jobs,
        logger,
        { concurrency: DEFAULT_MULTI_RUN_CONCURRENCY },
      )
      // `executeRuns` resolves once EVERY job has settled — a per-agent failure
      // is caught inside its own job, and a pre-work failure goes through
      // `failAll` and returns — so this is the moment AC-155 names: the last run
      // of the multi-run reached a terminal state. Stamping it here rather than
      // deriving it later is what makes the summary a measurement (AC-41) and
      // what keeps it still when a run is deleted (AC-159).
      .then(() => this.repo.markMultiRunFinished(multiRunId))
      .finally(() => EXECUTING_HERE.delete(multiRunId))
      .catch((err) => {
        // Deliberately no stamp on this path. The runs left behind are still
        // `queued`/`running` and only the reaper will close them, hours later;
        // `finished_at` would then measure the downtime. A multi-run with no
        // completion is a state the page renders — "interrupted" (AC-158).
        logger?.error(
          { prId, multiRunId, err: (err as Error).message },
          'multi-agent: background execution crashed',
        );
      });

    return {
      id: multiRunId,
      pr_id: prId,
      runs: jobs.map((job) => ({
        run_id: job.runId,
        agent_id: job.agent.id,
        agent_name: job.agent.name,
      })),
      skipped,
    };
  }

  /** Everything both view modes and the finding detail draw, in one read (AC-98). */
  async get(workspaceId: string, multiRunId: string): Promise<MultiAgentRun> {
    const detail = await this.repo.getMultiRun(workspaceId, multiRunId);
    // A multi-run of another workspace is indistinguishable from one that never
    // existed (AC-95) — same 404, same body.
    if (!detail) throw new NotFoundError('Multi-agent run not found');

    const columns: AgentColumn[] = detail.items.map(toAgentColumn);

    const costs = columns.map((c) => c.cost_usd).filter((c): c is number => c != null);
    const duration = summaryDuration(
      detail.multiRun.ranAt,
      detail.multiRun.finishedAt,
      columns.some((c) => !TERMINAL.has(c.status)) || EXECUTING_HERE.has(multiRunId),
    );

    return {
      id: detail.multiRun.id,
      pr_id: detail.multiRun.prId,
      pr_number: detail.pull.number,
      pr_title: detail.pull.title,
      head_sha: detail.multiRun.headSha,
      ran_at: detail.multiRun.ranAt.toISOString(),
      agent_count: columns.length,
      concurrency: detail.multiRun.concurrency,
      total_duration_ms: duration.ms,
      total_duration_kind: duration.kind,
      // A SUM, unlike the duration: every run is paid for separately (AC-160).
      total_cost_usd: costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null,
      // A floor rather than a total, for either of two reasons: a run priced at
      // `null` (AC-42), or a run that has not finished spending yet.
      total_cost_partial:
        columns.some((c) => c.cost_usd == null) || columns.some((c) => !TERMINAL.has(c.status)),
      columns,
      // Built FROM THE COLUMNS, not from a second read. The takes' `not_reviewed`
      // and the column header's word have to come from one reading of one run
      // state, which is exactly what AC-125 asks for and what § D22 rejected a
      // second source of. Never stored — recomputed on every read (AC-97).
      conflicts: buildConflicts(
        columns.map((c) => ({
          runId: c.run_id,
          agentId: c.agent_id,
          agentName: c.agent_name,
          status: c.status,
        })),
        columns.flatMap((c) => c.findings.map((finding) => ({ runId: c.run_id, finding }))),
      ),
    };
  }

  /** Newest multi-run of a repo, or `null` when it has never had one — a page
   *  state (AC-94), not an error. */
  async latestForRepo(workspaceId: string, repoId: string): Promise<MultiAgentRunRef | null> {
    const row = await this.repo.latestMultiRunForRepo(workspaceId, repoId);
    return row ? toMultiAgentRunRef(row) : null;
  }

  /** Newest multi-run of one PR, or `null` (R54). `null` and not a 404: "this PR
   *  has never been compared" is a state the page renders, and a 404 here would
   *  put an error on every PR page that has not been through this feature. */
  async latestForPull(workspaceId: string, prId: string): Promise<MultiAgentRunRef | null> {
    const row = await this.repo.latestMultiRunForPull(workspaceId, prId);
    return row ? toMultiAgentRunRef(row) : null;
  }

  /** Each agent's last `done` run — the pre-run estimate's only input
   *  (AC-17…AC-23). An agent with no such run is simply absent. */
  async lastSuccessfulRuns(workspaceId: string): Promise<LastSuccessfulRun[]> {
    return this.reviews.lastSuccessfulRunPerAgent(workspaceId);
  }
}

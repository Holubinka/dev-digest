import type { Container } from '../../platform/container.js';
import type { LLMProvider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import {
  reviewPullRequest,
  countBlockers,
  type ReviewOutcome as EngineOutcome,
} from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { attachedSkills, skillBodiesFor, taskLine } from './helpers.js';
import { buildPromptAssemblyLog, promptLogDetail } from './prompt-log.js';
import { loadDiff } from './diff-loader.js';
import type {
  AgentRun,
  RepoIntelContext,
  ReviewAgent,
  ReviewPull,
  ReviewRepo,
} from './types.js';

/**
 * The shape `container.projectContext` resolves to, named WITHOUT importing
 * `modules/context`: `no-cross-module` forbids that edge and counts an
 * `import type` as one. Reading it off the composition root's own type is the
 * same route `container.intentService` and `container.repoIntel` already take,
 * and it cannot drift from the port because it IS the port.
 */
type ProjectContextResult = Awaited<
  ReturnType<Container['projectContext']['resolveForRun']>
>;

/**
 * `buildCallersDigest` queries `getCallerSignatures` once for the WHOLE diff and
 * reuses that one digest on every map-reduce chunk (`run-executor.ts` builds it
 * before `reviewPullRequest` even picks a mode) — so its cost is `changedFiles.length`,
 * not "one file's worth", however many files a PR touches. `getCallerSignatures`
 * bounds callers PER symbol (`MAX_CALLERS_PER_SYMBOL`); nothing bounded the file
 * count feeding it, and a 166-file PR blew a single chunk's prompt past every
 * model's context window (275558 requested tokens against a 200000 limit) before
 * this cap existed. Same-shaped fix as `MAX_PLAN_FILES`/`MAX_ENV_VARS` elsewhere in
 * this repo: name the bound, don't let it default to "however many the diff has".
 */
const MAX_CALLERS_DIGEST_FILES = 40;

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * What has to be resolved before the engine can be called. Every field except
 * `llm` and `task` is best-effort: repo-intel off, unindexed or failing yields
 * `undefined`/`[]`, and the engine then omits that section, producing a prompt
 * byte-identical to the shape from before the feature that added it.
 */
interface PromptContext {
  llm: LLMProvider;
  callers: string | undefined;
  repoMap: string | undefined;
  skills: string[];
  /**
   * 08 — the agent's effective project-context set, already read, budgeted and
   * rendered. It arrives as `container.projectContext` with no import:
   * `modules/reviews` may not reach into `modules/context`.
   */
  projectContext: ProjectContextResult;
  task: string;
}

/** What an agent with nothing attached — or a failed resolve — gets. */
const NO_PROJECT_CONTEXT: ProjectContextResult = Object.freeze({
  blocks: Object.freeze([]) as unknown as string[],
  docs: Object.freeze([]) as unknown as ProjectContextResult['docs'],
  includedPaths: Object.freeze([]) as unknown as string[],
  note: undefined,
});

/** What an agent that opted out of repo-intel gets, and what a failed batch resolves to. */
const NO_REPO_INTEL: RepoIntelContext = Object.freeze({
  callers: undefined,
  repoMap: undefined,
  rankNote: '',
  summary: Object.freeze([]),
});

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService). Loads the diff and derives the PR's intent once — both shared
 * by every queued agent — then map-reduces each agent, streaming events over the
 * runBus and persisting each review. Per-agent failures are isolated; a failed
 * diff load fails every run, while a failed intent only omits a prompt section.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff and derives the PR's intent once, then map-reduces each
   * agent, streaming events over the runBus and persisting each review.
   * Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: ReviewPull,
    repo: ReviewRepo,
    jobs: { agent: ReviewAgent; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // Intent is PRE-WORK: derived ONCE for every queued agent, streamed into
    // each run's Live Log by the fanned-out logger, and cached on the PR. The
    // deriver arrives as `container.intentService` — modules/reviews may not
    // import modules/intent (`no-cross-module`), and the rendered section rides
    // on the result so nothing here needs one. A failure degrades the prompt to
    // exactly today's shape; it never fails a run.
    let intentSection: string | undefined;
    const derived = await runLog.step(
      'Deriving PR intent',
      () =>
        this.container.intentService.derive({
          workspaceId,
          prId: pull.id,
          onEvent: (kind, msg) => runLog.event(kind, msg),
        }),
      { kind: 'tool' },
    );
    if (derived.ok) {
      intentSection = derived.section;
      runLog.info(
        `Intent ready — ${derived.record.confidence} confidence from ` +
          `${derived.record.evidence.join(', ')}; ${derived.tokensIn}+${derived.tokensOut} tokens, ` +
          `${derived.costUsd == null ? 'cost unknown' : `$${derived.costUsd.toFixed(4)}`}`,
      );
    } else {
      runLog.info(`Intent unavailable — ${derived.reason}; reviewing without it`);
    }

    // Repo-intel is PRE-WORK too, for the same reason the diff is: it is keyed
    // on the PR, not on the agent, so N agents were making 3N identical index
    // queries and could disagree if the indexer wrote between two runs. Skipped
    // entirely when no queued agent wants it — one agent asking is enough,
    // since a second one opting out selects `NO_REPO_INTEL` rather than
    // re-querying.
    const repoIntel = jobs.some((j) => j.agent.repoIntel)
      ? await this.buildRepoIntelContext(pull.repoId, diff, runLog)
      : NO_REPO_INTEL;

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          { workspaceId, pull, repo, diff, intentSection, repoIntel, agent, runId },
          runLog,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /**
   * Execute a single agent's review against a PR, streaming progress.
   *
   * The phases below are separate methods to be *read* separately, not to be
   * called separately: one `try` has to cover all of them. Every failure from
   * resolving a provider to saving a trace lands in the same `catch`, and that
   * is the whole reason an `agent_runs` row is never left `running` — so
   * hoisting any phase out of this method to a caller would break the guarantee
   * while still compiling.
   */
  private async runOneAgent(run: AgentRun, parentLog: RunLogger): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff-load
    // and intent-derivation events are already in this run's buffer, so the
    // persisted trace below (built from the buffer) includes them too.
    const runLog = parentLog.forRun(run.runId, { agent: run.agent.name });

    runLog.info(
      `Starting review with agent "${run.agent.name}" (${run.agent.provider}/${run.agent.model})`,
    );

    // Hoisted out of the `try` so the failure path can see it. Everything
    // after `callEngine` returns can still throw — a NUL in the model's summary
    // did exactly that — and a run that fails at persistence has still spent
    // every token the engine reports here.
    let outcome: EngineOutcome | undefined;
    try {
      const context = await this.gatherPromptContext(run, runLog);
      outcome = await this.callEngine(run, context, runLog);
      this.logPromptAssembly(run, context.task, outcome, runLog);
      return await this.persistSuccess(run, outcome, context, start, runLog);
    } catch (err) {
      await this.persistFailure(run, err, start, runLog, outcome);
      throw err;
    }
  }

  /**
   * Resolve everything the engine call needs. Only the provider lookup can fail
   * the run — `container.llm` throws on a missing key, which `runOneAgent`'s
   * `catch` persists as a failed run. Every enrichment below it is best-effort
   * by design.
   */
  private async gatherPromptContext(run: AgentRun, runLog: RunLogger): Promise<PromptContext> {
    const { agent, pull } = run;

    const llm = await runLog.step(
      `Resolving ${agent.provider} provider`,
      () => this.container.llm(agent.provider),
      { kind: 'tool' },
    );

    // Per-agent repo-intel toggle (Agent editor). Opting out selects nothing
    // rather than skipping a query — the enrichment was already resolved once
    // for the batch — so this agent's prompt is identical to the repo-intel-off
    // baseline, independent of the global REPO_INTEL_ENABLED flag, which still
    // gates the facade internally.
    const { callers, repoMap, rankNote, summary } = agent.repoIntel
      ? run.repoIntel
      : NO_REPO_INTEL;
    // Reported here, per run, rather than where it was resolved: the batch
    // logger reaches every queued run, so an agent that opted out would be told
    // that enrichment it never received had been attached.
    if (agent.repoIntel) {
      for (const line of summary) runLog.info(line);
    } else {
      runLog.info('Repo intel disabled for this agent — skipping context enrichment');
    }

    // L02 — the agent's linked, globally-enabled skill bodies, in binding order.
    // The one enrichment that IS per-agent, so the one still resolved here.
    const skills = await this.buildSkillBodies(agent.id, runLog);

    // 08 — the agent's project-context documents. PER AGENT, not per batch, and
    // for the same reason the skills are: the effective set is this agent's own
    // attachments plus its own skills', so two queued agents on one PR resolve
    // to different sets.
    const projectContext = await this.buildProjectContext(run, runLog);

    return { llm, callers, repoMap, skills, projectContext, task: taskLine(pull) + rankNote };
  }

  /**
   * Resolve the agent's `## Project context` blocks.
   *
   * Best-effort like every other enrichment: a failure logs and returns nothing,
   * so the review degrades to the pre-08 prompt instead of failing the run. It
   * NEVER goes silent — a section that was expected and did not arrive is
   * exactly the case a reader needs told.
   */
  private async buildProjectContext(
    run: AgentRun,
    runLog: RunLogger,
  ): Promise<ProjectContextResult> {
    const { workspaceId, agent, repo, pull } = run;
    let resolved: ProjectContextResult;
    try {
      resolved = await this.container.projectContext.resolveForRun({
        workspaceId,
        agentId: agent.id,
        repoId: pull.repoId,
        repo: { owner: repo.owner, name: repo.name },
      });
    } catch (err) {
      runLog.info(`project context: lookup failed — ${(err as Error).message}`);
      return NO_PROJECT_CONTEXT;
    }
    if (resolved.note) runLog.info(resolved.note);
    if (resolved.docs.length > 0) {
      const tokens = resolved.docs
        .filter((d) => d.status === 'included' || d.status === 'truncated')
        .reduce((sum, d) => sum + d.tokens, 0);
      const skipped = resolved.docs.filter(
        (d) => d.status !== 'included' && d.status !== 'truncated',
      );
      runLog.info(
        `project context: ${resolved.includedPaths.length} of ${resolved.docs.length} ` +
          `document(s), ${tokens} token(s) attached` +
          (skipped.length > 0
            ? ` — skipped ${skipped.map((d) => `${d.path} (${d.status})`).join(', ')}`
            : ''),
      );
    }
    return resolved;
  }

  /**
   * Resolve the repo-intel enrichment for one PR, once for the whole batch.
   *
   * Every part is best-effort: when repo-intel is off, unindexed, or erroring,
   * the facade degrades and each builder returns nothing, so the prompt is
   * byte-identical to the shape from before the feature that added it
   * (acceptance #10).
   */
  private async buildRepoIntelContext(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<RepoIntelContext> {
    // Collected, not emitted: `gatherPromptContext` decides which runs hear it.
    const summary: string[] = [];
    return {
      // T1.3 — callers-in-prompt.
      callers: await this.buildCallersDigest(repoId, diff, runLog, summary),
      // T3 — repo skeleton, and the "changed files are top-5%" task framing.
      repoMap: await this.buildRepoMapDigest(repoId, runLog, summary),
      rankNote: await this.buildRankNote(repoId, diff, summary),
      summary,
    };
  }

  /**
   * The engine: assemble → single-pass → grounding.
   *
   * The pure review pipeline lives in `@devdigest/reviewer-core`, shared with
   * the CI runner; this module owns only the I/O either side of it. Every
   * conditional spread below carries the same contract — a feature that
   * resolved to nothing must produce a prompt byte-identical to the shape from
   * before that feature existed, which is why they are spreads and not
   * `x: undefined`.
   */
  private callEngine(
    run: AgentRun,
    context: PromptContext,
    runLog: RunLogger,
  ): Promise<EngineOutcome> {
    const { agent, pull, repo, diff, intentSection, runId } = run;
    return reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm: context.llm,
      // Per-agent review strategy, configured in the Agent editor. The default
      // is the column's (`single-pass`), not a constant here — see the schema
      // for why it is not `auto`.
      strategy: agent.strategy,
      // `length > 0` rather than truthiness: `[]` is truthy, and the point of
      // the guard is that an agent with nothing bound produces a prompt
      // byte-identical to the pre-skills shape.
      ...(context.skills.length > 0 ? { skills: context.skills } : {}),
      // 08 — the agent's project-context documents. A conditional spread for the
      // same reason as the line above it: an agent with nothing attached must
      // produce a prompt byte-identical to the pre-08 shape, and `specs:
      // undefined` is not that.
      ...(context.projectContext.blocks.length > 0
        ? { specs: context.projectContext.blocks }
        : {}),
      ...(context.callers ? { callers: context.callers } : {}),
      ...(context.repoMap ? { repoMap: context.repoMap } : {}),
      // PR author's description/body — untrusted; assemblePrompt wraps +
      // truncates it. Omitted when the PR has no body.
      ...(pull.body ? { prDescription: pull.body } : {}),
      // 05 — the derived intent, rendered by the intent service.
      ...(intentSection ? { intent: intentSection } : {}),
      task: context.task,
      sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
      onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
      checkCancelled: () => {
        if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
      },
    });
  }

  /**
   * What went into each prompt, WITHOUT its content.
   *
   * One line per prompt actually sent — single-pass: one; map-reduce: one per
   * changed file — each naming its chunk, so N lines are not N anonymous ones.
   * The payload is metadata only; `prompt-log.ts` holds why that is structural
   * rather than a matter of care here.
   */
  private logPromptAssembly(
    run: AgentRun,
    task: string,
    outcome: EngineOutcome,
    runLog: RunLogger,
  ): void {
    const verbose = this.container.config.promptLogVerbose;
    for (const prompt of outcome.prompts) {
      const log = buildPromptAssemblyLog({
        correlationId: run.runId,
        provider: run.agent.provider,
        model: run.agent.model,
        sections: prompt.sections,
        ...(verbose
          ? {
              detail: promptLogDetail({
                mode: outcome.mode,
                chunk: prompt.chunk,
                diff: run.diff,
                assembly: outcome.assembly,
                task,
              }),
            }
          : {}),
      });
      runLog.info(
        `Prompt assembled for "${prompt.chunk}" — ${prompt.sections.length} section(s), ` +
          `${log.total_chars} chars, ~${log.total_tokens_approx} tokens`,
        { chunk: prompt.chunk, prompt_assembly_log: log },
      );
    }
  }

  /** Persist the review, its findings, the run row and one `run_traces` document. */
  private async persistSuccess(
    run: AgentRun,
    outcome: EngineOutcome,
    context: PromptContext,
    start: number,
    runLog: RunLogger,
  ): Promise<RunOutcome> {
    const { workspaceId, pull, agent, runId } = run;
    const { tokensIn, tokensOut, costUsd, grounding } = outcome;
    const keptFindings = outcome.review.findings;

    const review = await this.repo.insertReview({
      workspaceId,
      prId: pull.id,
      agentId: agent.id,
      runId,
      // The state this review describes. Same value, from the same place, as the
      // `markReviewed` call below — taking it from anywhere else is how the two
      // start disagreeing about which commit was reviewed.
      headSha: pull.headSha,
      kind: 'review',
      verdict: outcome.review.verdict,
      summary: outcome.review.summary,
      score: outcome.review.score,
      model: agent.model,
    });
    const findingRows = await this.repo.insertFindings(review.id, keptFindings);
    runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

    // Mark the commit this review ran against so the PR list can tell
    // reviewed / needs-review (head moved) / stale apart.
    await this.repo.markReviewed(pull.id, pull.headSha);

    const durationMs = Date.now() - start;

    await this.repo.completeAgentRun(runId, {
      status: 'done',
      durationMs,
      tokensIn,
      tokensOut,
      costUsd,
      findingsCount: findingRows.length,
      grounding,
      score: outcome.review.score,
      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      blockers: countBlockers(keptFindings, agent.ciFailOn),
      error: null,
    });

    runLog.info('Run complete; trace persisted');
    await this.repo.saveRunTrace(
      runId,
      this.traceFromOutcome(run, outcome, context, findingRows.length, durationMs, runLog),
    );
    this.container.runBus.complete(runId);

    return { review, findings: findingRows, grounding, raw: outcome.review };
  }

  /**
   * The `run_traces` document for a run that finished. Sibling of
   * `traceFromBuffer`, which builds the same shape for one that did not — and
   * they are two methods rather than one because almost nothing is shared: the
   * failure path has no engine outcome to read stats, chunks or an assembly
   * from, and filling those with zeros through a common builder would make an
   * empty trace and a real one indistinguishable at the call site.
   */
  private traceFromOutcome(
    run: AgentRun,
    outcome: EngineOutcome,
    context: PromptContext,
    findings: number,
    durationMs: number,
    runLog: RunLogger,
  ): RunTrace {
    const { agent, pull } = run;
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: {
        duration_ms: durationMs,
        tokens_in: outcome.tokensIn,
        tokens_out: outcome.tokensOut,
        cost_usd: outcome.costUsd,
        findings,
        grounding: outcome.grounding,
      },
      prompt_assembly: outcome.assembly,
      tool_calls: outcome.chunks.map((c) => ({
        tool: 'review_file',
        args: c.label,
        meta: outcome.mode,
        ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
      })),
      raw_output: outcome.raw,
      memory_pulled: [],
      // The documents that actually went, in block order.
      specs_read: context.projectContext.includedPaths,
      // …and EVERY document of the effective set with what happened to it,
      // including the ones that did not go. A document dropped for budget or
      // missing from the clone is the case a reader most needs explained, and
      // `specs_read` alone cannot say it.
      project_context: context.projectContext.docs,
      // Persisted log = the run's FULL event buffer (incl. shared pre-work:
      // diff load + intent), not just the events this run's own method recorded.
      log: runLog.logFor(run.runId),
    };
  }

  /**
   * Persist status + the error text + the log-so-far, so the run and WHY it
   * failed are visible on the UI after a reload.
   *
   * Both writes swallow their own errors: this runs on a path that is already
   * failing, and the caller re-throws the original. A throw from here would
   * replace the real cause with a persistence error and leave the bus open.
   */
  private async persistFailure(
    run: AgentRun,
    err: unknown,
    start: number,
    runLog: RunLogger,
    outcome: EngineOutcome | undefined,
  ): Promise<void> {
    const cancelled = err instanceof RunCancelledError;
    const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
    runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);

    // What the engine actually spent, when it got far enough to report it.
    // This used to be a flat zero, which was right only for the failure it was
    // written for — one BEFORE the LLM call. A failure after it wrote `0` over
    // a real 167k, so the row that exists to record the cost hid it. `findings`
    // stays 0 either way: it counts findings STORED, and this path stored none.
    const grounding = outcome?.grounding ?? '0/0 passed';
    const durationMs = Date.now() - start;
    await this.repo
      .completeAgentRun(run.runId, {
        status: cancelled ? 'cancelled' : 'failed',
        durationMs,
        tokensIn: outcome?.tokensIn ?? 0,
        tokensOut: outcome?.tokensOut ?? 0,
        costUsd: outcome?.costUsd ?? null,
        findingsCount: 0,
        grounding,
        error: msg,
      })
      .catch(() => undefined);
    await this.repo
      .saveRunTrace(
        run.runId,
        this.traceFromBuffer(run.runId, run.pull, run.agent, grounding, durationMs),
      )
      .catch(() => undefined);
    this.container.runBus.complete(run.runId);
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. The `limit: 10`
   * passed to `getCallerSignatures` bounds callers PER SYMBOL, not the total —
   * a PR with hundreds of declared symbols across many files still gets one
   * digest entry per symbol, so the "under ~600 tokens" this comment used to
   * claim was never a real bound. `changedFiles` is capped at
   * `MAX_CALLERS_DIGEST_FILES` for that reason: this digest is built ONCE for
   * the whole diff and reused unchanged on every map-reduce chunk, so its size
   * is what every chunk's prompt pays, not what one file's review needs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
    summary: string[],
  ): Promise<string | undefined> {
    const allChangedFiles = diff.files.map((f) => f.path);
    if (allChangedFiles.length === 0) return undefined;
    const changedFiles = allChangedFiles.slice(0, MAX_CALLERS_DIGEST_FILES);
    const omitted = allChangedFiles.length - changedFiles.length;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    summary.push(
      omitted > 0
        ? `callers digest: ${rows.length} caller signature(s) attached (${omitted} changed file(s) past the ${MAX_CALLERS_DIGEST_FILES}-file cap were not queried)`
        : `callers digest: ${rows.length} caller signature(s) attached`,
    );
    return out.join('\n');
  }

  /**
   * L02 — resolve the agent's linked skill bodies for the prompt's
   * `## Skills / rules` slot, in binding order, dropping globally-disabled ones.
   *
   * ON TRUST: `assemblePrompt` joins these RAW — there is no `<untrusted>`
   * wrapper around a skill the way there is around the diff or the PR body — so
   * a skill body is an INSTRUCTION, standing exactly where the agent's own
   * system prompt stands. That is the whole reason an imported skill is stored
   * disabled and has to be turned on by a human first.
   *
   * Best-effort: a lookup failure logs and returns [], so a review degrades to
   * the pre-skills prompt instead of failing the run.
   */
  private async buildSkillBodies(agentId: string, runLog: RunLogger): Promise<string[]> {
    const links = await this.agents.linkedSkills(agentId).catch((err: Error) => {
      runLog.info(`skills: lookup failed — ${err.message}`);
      return [];
    });
    // One source for both numbers: the names must describe the bodies that
    // actually went, not the bindings that merely exist.
    const attached = attachedSkills(links);
    const bodies = skillBodiesFor(links);
    if (bodies.length === 0) return [];
    const tokens = bodies.reduce((n, b) => n + this.container.tokenizer.count(b), 0);
    const names = attached.map((l) => l.skill.name);
    runLog.info(
      `skills: ${bodies.length} skill(s), ${tokens} token(s) attached — ${names.join(', ')}`,
    );
    return bodies;
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
    summary: string[],
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      summary.push(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    summary: string[],
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      summary.push(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: ReviewPull,
    agent: ReviewAgent,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      // A run that failed before (or during) assembly attached nothing. Filling
      // this from a half-resolved context would report documents as sent that
      // no prompt ever carried.
      project_context: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}

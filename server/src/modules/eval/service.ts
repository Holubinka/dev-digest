import { randomUUID } from 'node:crypto';
import type {
  EvalAgentDashboard,
  EvalBatchResult,
  EvalBatchSummary,
  EvalCase,
  EvalCaseFromFinding,
  EvalCaseRow,
  EvalCaseSet,
  EvalCompare,
  EvalDashboardAll,
  EvalDashboardCard,
  EvalExpectation,
  EvalExpectations,
  EvalRunAllResult,
  EvalRunResult,
  SkillEvalCaseSet,
} from '@devdigest/shared';
import { AppError, ValidationError } from '../../platform/errors.js';
import { loadPrDiff } from '../_shared/pr-diff.js';
import { EvalBatchExecutor } from './batch-executor.js';
import {
  assertRunnableFragment,
  filesIn,
  fragmentFor,
  intersectsAHunk,
} from './diff-fragment.js';
import {
  MAX_CASES_PER_BATCH,
  MAX_CASES_PER_SET,
  MAX_EXPECTATIONS,
  MAX_EXPECTED_OUTPUT_BYTES,
  MAX_INPUT_DIFF_CHARS,
  MAX_CASE_NAME_CHARS,
  MAX_INPUT_META_BODY_CHARS,
  MAX_NOTES_CHARS,
  RECENT_RUNS_LIMIT,
  SUMMARY_BATCH_LIMIT,
  TREND_BATCH_LIMIT,
} from './constants.js';
import {
  asCategory,
  asSeverity,
  banner,
  caseIdsOf,
  changedLines,
  promptFromSnapshot,
  provenanceNote,
  readExpectations,
  slugify,
  toBatchSummary,
  toCaseRow,
  toEvalCase,
  toSkillCaseRow,
  toRunRecord,
  toTrendPoint,
  truncateCodePoints,
  uniqueName,
} from './helpers.js';
import type { EvalRepository } from './repository.js';
import type {
  EvalAgent,
  EvalContainer,
  EvalLogger,
  EvalReader,
  NewCaseInput,
  RunnableCase,
  UpdateCaseInput,
} from './types.js';

/**
 * eval — case creation, the case CRUD, the reads, and the lock a batch runs under.
 *
 * TENANCY, EVERYWHERE AND FIRST. `eval_runs` has no `workspace_id`, so the only
 * thing standing between a client-supplied `owner_id` and another workspace's
 * rows is that every path here resolves the owner through
 * `agentsRepo.getById(workspaceId, …)` — or the case through
 * `repo.getCase(workspaceId, …)` — BEFORE anything else happens, and answers
 * `undefined` (the route's 404) when it does not resolve. `undefined` rather
 * than a distinct error on purpose: "not yours" and "does not exist" must be
 * indistinguishable, or the 404 becomes an existence oracle.
 *
 * THE SINGLE-FLIGHT MAP is why `platform/container.ts` memoises this service and
 * nobody `new`s it. It is a lock exactly as long as there is one instance; a
 * second instance has a second empty map, "one batch per agent at a time"
 * (AC-28, AC-35) stops holding, and no test and no gate can see the difference.
 */
export class EvalService implements EvalReader {
  /** agentId → the `batch_id` currently running for it. */
  private inFlight = new Map<string, string>();

  private executor: EvalBatchExecutor;

  constructor(
    private container: EvalContainer,
    private repo: EvalRepository,
  ) {
    this.executor = new EvalBatchExecutor(container, repo);
  }

  // ---- creation from a decided finding (AC-1 … AC-12) ---------------------

  async caseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseFromFinding | undefined> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx) return undefined;
    // The finding is reached through its review's PR, and the PR is the row
    // that carries `workspace_id`. Without this line the route is an IDOR on a
    // finding id (AC-68).
    if (ctx.pull.workspaceId !== workspaceId) return undefined;

    const { finding, review, pull } = ctx;

    // AC-10 — the repeat click. Checked BEFORE the decision test and before the
    // diff is loaded: the case already exists, so there is nothing to refuse
    // and nothing to fetch.
    const existing = await this.repo.caseByFindingId(workspaceId, findingId);
    if (existing) return { case: toEvalCase(existing), created: false };

    // AC-3. The client renders the control disabled with the reason, so this is
    // the second lock rather than the first — the expectation's POLARITY is the
    // decision, and on an undecided finding there is nowhere to get it from.
    const decision: 'accepted' | 'dismissed' | null = finding.acceptedAt
      ? 'accepted'
      : finding.dismissedAt
        ? 'dismissed'
        : null;
    if (!decision) {
      throw new ValidationError(
        'This finding has been neither accepted nor dismissed, and the decision is what ' +
          'says whether the agent should have reported it (must_find) or should have stayed ' +
          'quiet (must_not_flag). Accept or dismiss it first.',
      );
    }
    const decidedAt = decision === 'accepted' ? finding.acceptedAt! : finding.dismissedAt!;

    // N1: this lesson runs agent-owned cases only, and `owner_id` is the agent
    // whose run produced the finding (AC-1). A review with no agent — a
    // hand-written summary row — has no owner to attribute the case to.
    if (!review.agentId) {
      throw new ValidationError(
        'The review that produced this finding is not attributed to an agent, so there is no ' +
          'agent whose eval set the case would belong to.',
      );
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, review.agentId);
    if (!agent) return undefined;

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) {
      throw new AppError(
        'diff_unavailable',
        'The repository this pull request belongs to is no longer available, so its diff ' +
          'cannot be read and there is nothing to store as the case input.',
        409,
      );
    }

    // AC-5 — no clone and no stored patches means no fragment. Refuse rather
    // than write a case with an empty input, which would score 0 for ever and
    // look like a failing agent.
    const diff = await loadPrDiff(this.container, pull, repoRow);
    if (diff.files.length === 0) {
      throw new AppError(
        'diff_unavailable',
        `No diff could be obtained for ${repoRow.owner}/${repoRow.name} #${pull.number} — ` +
          'neither from the clone nor from the stored pull-request file patches. Re-import ' +
          'the pull request and try again.',
        409,
      );
    }

    // AC-4 — the fragment is the ONE file the finding cites, with all its hunks.
    const fragment = fragmentFor(diff, finding.file);
    this.assertDiffSize(fragment);
    const fragmentDiff = assertRunnableFragment(fragment);

    // AC-6 — an expectation the citation gate could never anchor is refused
    // here, not stored to fail silently on every future run.
    if (!intersectsAHunk(fragmentDiff, finding.file, finding.startLine, finding.endLine)) {
      throw new AppError(
        'expectation_unanchored',
        `Lines ${finding.startLine}-${finding.endLine} of "${finding.file}" intersect no hunk ` +
          'of the stored diff fragment, so this expectation would never survive the citation ' +
          'gate and the case could never pass. Edit the finding\'s line range, or build the ' +
          'case by hand from a diff that covers those lines.',
        422,
      );
    }

    const expectation: EvalExpectation = {
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      polarity: decision === 'accepted' ? 'must_find' : 'must_not_flag',
      severity: asSeverity(finding.severity),
      category: asCategory(finding.category),
      title: finding.title,
    };

    const taken = (await this.repo.listCases(workspaceId, agent.id)).map((c) => c.name);
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: uniqueName(slugify(finding.title), taken),
      inputDiff: fragment,
      inputFiles: filesIn(fragment),
      inputMeta: {
        title: pull.title,
        body: pull.body ? truncateCodePoints(pull.body, MAX_INPUT_META_BODY_CHARS) : null,
      },
      expectedOutput: [expectation],
      notes: provenanceNote({
        findingId: finding.id,
        repo: `${repoRow.owner}/${repoRow.name}`,
        prNumber: pull.number,
        decision,
        decidedAt,
      }),
    });

    return { case: toEvalCase(row), created: true };
  }

  // ---- the case set and the case CRUD -------------------------------------

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseSet | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const [cases, latest] = await Promise.all([
      this.repo.listCases(workspaceId, agentId),
      this.repo.latestRunPerCase(workspaceId, agentId),
    ]);
    const byCase = new Map(latest.map((r) => [r.case_id, r]));
    const rows: EvalCaseRow[] = cases.map((c) => toCaseRow(c, byCase.get(c.id)));
    return {
      cases: rows,
      passing: rows.filter((r) => r.last_run?.pass === true).length,
      total: rows.length,
    };
  }

  /** The reciprocal of `listCases`: every case, across agents, this skill actually shaped. */
  async listCasesForSkill(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillEvalCaseSet | undefined> {
    const exists = await this.container.skillsRepo.existsInWorkspace(workspaceId, skillId);
    if (!exists) return undefined;

    const rows = (await this.repo.casesForSkill(workspaceId, skillId)).map(toSkillCaseRow);
    return {
      cases: rows,
      passing: rows.filter((r) => r.last_run?.pass === true).length,
      total: rows.length,
    };
  }

  async createCase(
    workspaceId: string,
    agentId: string,
    input: NewCaseInput,
  ): Promise<EvalCase | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const existing = await this.repo.listCases(workspaceId, agentId);
    if (existing.length >= MAX_CASES_PER_SET) {
      throw new AppError(
        'limit_exceeded',
        `This agent already has ${existing.length} eval cases, which is the per-agent ceiling ` +
          `of ${MAX_CASES_PER_SET}. Delete a case before adding another.`,
        422,
      );
    }

    this.assertDiffSize(input.input_diff);
    assertRunnableFragment(input.input_diff);
    this.assertExpectationsSize(input.expected_output);
    this.assertNotesSize(input.notes);

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: uniqueName(
        slugify(input.name),
        existing.map((c) => c.name),
      ),
      inputDiff: input.input_diff,
      // D13 — derived from the diff, never taken from the caller.
      inputFiles: filesIn(input.input_diff),
      inputMeta: this.normaliseMeta(input.input_meta),
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    return toEvalCase(row);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getCase(workspaceId, caseId);
    return row ? toEvalCase(row) : undefined;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateCaseInput,
  ): Promise<EvalCase | undefined> {
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing) return undefined;

    if (patch.input_diff !== undefined) {
      this.assertDiffSize(patch.input_diff);
      // AC-23, on save. The same guard runs again per case at run time, because
      // this column is free text and a run may be far later than the save.
      assertRunnableFragment(patch.input_diff);
    }
    if (patch.expected_output !== undefined) this.assertExpectationsSize(patch.expected_output);
    if (patch.notes !== undefined) this.assertNotesSize(patch.notes);

    const row = await this.repo.updateCase(workspaceId, caseId, {
      ...(patch.name !== undefined
        ? {
            name: uniqueName(
              slugify(patch.name),
              (await this.repo.listCases(workspaceId, existing.ownerId))
                .filter((c) => c.id !== caseId)
                .map((c) => c.name),
            ),
          }
        : {}),
      ...(patch.input_diff !== undefined
        ? { inputDiff: patch.input_diff, inputFiles: filesIn(patch.input_diff) }
        : {}),
      ...(patch.input_meta !== undefined
        ? { inputMeta: this.normaliseMeta(patch.input_meta) }
        : {}),
      ...(patch.expected_output !== undefined
        ? { expectedOutput: patch.expected_output }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCase(row) : undefined;
  }

  /** AC-22 — the runs cascade with the case; no past batch aggregate is touched. */
  deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  // ---- running (AC-21, AC-24 … AC-37) -------------------------------------

  /** One case is a batch of one (D2): same code path, `traces_total = 1`. */
  async runCase(workspaceId: string, caseId: string): Promise<EvalRunResult | undefined> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) return undefined;
    const agent = await this.container.agentsRepo.getById(workspaceId, row.ownerId);
    if (!agent) return undefined;

    const runnable = this.toRunnable(row.id, row.name, row.inputDiff ?? '', row.inputMeta, row.expectedOutput);
    // AC-23 at the route boundary: a single-case run refuses outright rather
    // than recording an errored row, because there is nothing else in the batch
    // for the failure to be a partial result of.
    this.assertDiffSize(runnable.inputDiff);
    assertRunnableFragment(runnable.inputDiff);

    const batchId = randomUUID();
    const { batch, runIds } = await this.withAgentLock(agent.id, batchId, () =>
      this.runBatch(workspaceId, batchId, agent, [runnable]),
    );
    return {
      run_id: runIds[0] ?? '',
      case_id: row.id,
      result: batch.result,
    };
  }

  async runSet(
    workspaceId: string,
    agentId: string,
    log: EvalLogger,
  ): Promise<EvalBatchResult | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const rows = await this.repo.listCases(workspaceId, agentId);

    // The three pre-flight refusals, IN ORDER, all before any model call.
    // AC-27 — an empty set. Returning an empty result instead would read as
    // "everything passed", which is fail-open for a regression harness.
    if (rows.length === 0) {
      throw new AppError(
        'no_cases',
        'This agent has no eval cases, so there is nothing to run. Turn a decided finding ' +
          'into a case from a pull request, or add one by hand on the Evals tab.',
        409,
      );
    }
    // AC-28 — a batch is already running for this agent; name its id.
    const running = this.inFlight.get(agentId);
    if (running) {
      throw new AppError(
        'batch_in_progress',
        `A batch is already running for this agent (batch ${running}). Wait for it to ` +
          'finish before starting another — every case is a paid model call.',
        409,
        { batch_id: running },
      );
    }
    // AC-70 — the per-batch ceiling, with both numbers in the message.
    if (rows.length > MAX_CASES_PER_BATCH) {
      throw new AppError(
        'set_too_large',
        `This set holds ${rows.length} cases and a single batch may run at most ` +
          `${MAX_CASES_PER_BATCH}. Every case is a paid model call, so the ceiling is the ` +
          'only spend limit there is. Delete or split cases before running the set.',
        422,
      );
    }
    // AC-29 — the provider key, checked inside the executor before its loop.

    const cases = rows.map((r) =>
      this.toRunnable(r.id, r.name, r.inputDiff ?? '', r.inputMeta, r.expectedOutput),
    );
    const batchId = randomUUID();
    const { batch } = await this.withAgentLock(agentId, batchId, () =>
      this.runBatch(workspaceId, batchId, agent, cases, log),
    );
    return batch;
  }

  /** AC-37 — every agent that has a case; the rest are named, not silently dropped. */
  async runAll(workspaceId: string, log: EvalLogger): Promise<EvalRunAllResult> {
    const [agents, counts] = await Promise.all([
      this.container.agentsRepo.list(workspaceId),
      this.repo.caseCountsByOwner(workspaceId),
    ]);
    const byOwner = new Map(counts.map((c) => [c.ownerId, c.total]));

    const batches: EvalBatchResult[] = [];
    const skipped: { agent_id: string; agent_name: string; reason: string }[] = [];

    for (const { agent } of agents) {
      if (!byOwner.get(agent.id)) {
        skipped.push({
          agent_id: agent.id,
          agent_name: agent.name,
          reason: 'No eval cases yet.',
        });
        continue;
      }
      try {
        const batch = await this.runSet(workspaceId, agent.id, log);
        if (batch) batches.push(batch);
      } catch (err) {
        // One agent's refusal — no key, a set over the ceiling, a batch already
        // running — must not abort the other agents' batches. It becomes a
        // named skip, which is what AC-37 asks the screen to show.
        if (err instanceof AppError) {
          skipped.push({ agent_id: agent.id, agent_name: agent.name, reason: err.message });
          continue;
        }
        throw err;
      }
    }
    return { batches, skipped };
  }

  // ---- the reads (AC-52 … AC-63) ------------------------------------------

  async dashboard(workspaceId: string): Promise<EvalDashboardAll> {
    const counts = await this.repo.caseCountsByOwner(workspaceId);
    if (counts.length === 0) return { cards: [], recent: [] };

    const [agents, batches] = await Promise.all([
      this.container.agentsRepo.list(workspaceId),
      this.repo.completedBatches(workspaceId, { limit: SUMMARY_BATCH_LIMIT }),
    ]);
    const byId = new Map(agents.map((a) => [a.agent.id, a.agent]));

    const summariesByOwner = new Map<string, EvalBatchSummary[]>();
    const recent: EvalBatchSummary[] = [];
    for (const row of batches) {
      const agent = byId.get(row.owner_id);
      if (!agent) continue;
      const summary = toBatchSummary(row, agent.name);
      if (!summary) continue;
      recent.push(summary);
      const list = summariesByOwner.get(row.owner_id) ?? [];
      list.push(summary);
      summariesByOwner.set(row.owner_id, list);
    }

    const cards: EvalDashboardCard[] = [];
    for (const { ownerId, total } of counts) {
      const agent = byId.get(ownerId);
      if (!agent) continue;
      // Newest first out of the query, so the trend has to be reversed to read
      // left-to-right in time.
      const summaries = (summariesByOwner.get(ownerId) ?? []).slice(0, TREND_BATCH_LIMIT);
      cards.push({
        agent_id: agent.id,
        agent_name: agent.name,
        provider: agent.provider,
        model: agent.model,
        cases_total: total,
        latest: summaries[0] ?? null,
        trend: [...summaries].reverse().map(toTrendPoint),
      });
    }

    return { cards, recent };
  }

  /** Four database reads, which is the spec's NFR for this screen. */
  async agentDashboard(
    workspaceId: string,
    agentId: string,
    range: { from?: Date; to?: Date },
  ): Promise<EvalAgentDashboard | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const [cases, batchRows] = await Promise.all([
      this.repo.listCases(workspaceId, agentId),
      this.repo.batchesForOwner(workspaceId, agentId, range, SUMMARY_BATCH_LIMIT),
    ]);
    const runs = await this.repo.runsForCases(
      workspaceId,
      cases.map((c) => c.id),
      RECENT_RUNS_LIMIT,
    );

    const summaries = batchRows
      .map((row) => toBatchSummary(row, agent.name))
      .filter((s): s is EvalBatchSummary => s !== undefined);
    const latest = summaries[0];
    const previous = summaries[1];

    // AC-56 — no deltas and no banner below two completed batches. Zero is the
    // contract's only representable "no delta"; the banner being `null` is what
    // actually tells the screen not to draw one.
    const delta =
      latest && previous
        ? {
            recall: latest.recall - previous.recall,
            precision: latest.precision - previous.precision,
            citation_accuracy: latest.citation_accuracy - previous.citation_accuracy,
          }
        : { recall: 0, precision: 0, citation_accuracy: 0 };

    return {
      dashboard: {
        owner_kind: 'agent',
        owner_id: agentId,
        cases_total: cases.length,
        current: {
          recall: latest?.recall ?? 0,
          precision: latest?.precision ?? 0,
          citation_accuracy: latest?.citation_accuracy ?? 0,
          traces_passed: latest?.passed ?? 0,
          traces_total: latest?.cases ?? 0,
          cost_usd: latest?.cost_usd ?? null,
        },
        delta,
        trend: [...summaries].slice(0, TREND_BATCH_LIMIT).reverse().map(toTrendPoint),
        recent_runs: runs.map(toRunRecord),
        alert: banner(latest, previous),
      },
      batches: summaries,
    };
  }

  async compare(workspaceId: string, a: string, b: string): Promise<EvalCompare | undefined> {
    const [rowA, rowB] = await Promise.all([
      this.repo.batchById(workspaceId, a),
      this.repo.batchById(workspaceId, b),
    ]);
    if (!rowA || !rowB) return undefined;

    // The contract reads old → new, so the two are ordered by time here rather
    // than by which query parameter they arrived in.
    const [older, newer] =
      new Date(rowA.ran_at).getTime() <= new Date(rowB.ran_at).getTime()
        ? [rowA, rowB]
        : [rowB, rowA];

    const agent = await this.container.agentsRepo.getById(workspaceId, older.owner_id);
    if (!agent) return undefined;
    const agentB = await this.container.agentsRepo.getById(workspaceId, newer.owner_id);
    if (!agentB) return undefined;

    const summaryA = toBatchSummary(older, agent.name);
    const summaryB = toBatchSummary(newer, agentB.name);
    if (!summaryA || !summaryB) return undefined;

    const [snapA, snapB] = await Promise.all([
      this.container.agentsRepo.getVersion(older.owner_id, summaryA.agent_version),
      this.container.agentsRepo.getVersion(newer.owner_id, summaryB.agent_version),
    ]);
    const textA = promptFromSnapshot(snapA?.configJson);
    const textB = promptFromSnapshot(snapB?.configJson);
    // AC-62 — same version means the prompt did not change, and the metric
    // deltas are shown anyway. Typically only the skill bindings moved, which
    // do not bump `agents.version` (D4) and are why the envelope stores them.
    const changed = summaryA.agent_version !== summaryB.agent_version && textA !== textB;

    const idsA = caseIdsOf(older);
    const idsB = caseIdsOf(newer);
    const setA = new Set(idsA);
    const setB = new Set(idsB);
    const onlyInA = idsA.filter((id) => !setB.has(id));
    const onlyInB = idsB.filter((id) => !setA.has(id));

    return {
      a: summaryA,
      b: summaryB,
      delta: {
        recall: summaryB.recall - summaryA.recall,
        precision: summaryB.precision - summaryA.precision,
        citation_accuracy: summaryB.citation_accuracy - summaryA.citation_accuracy,
        cost_usd:
          summaryA.cost_usd === null || summaryB.cost_usd === null
            ? null
            : summaryB.cost_usd - summaryA.cost_usd,
      },
      prompt: {
        changed,
        a_version: summaryA.agent_version,
        b_version: summaryB.agent_version,
        a_text: textA,
        b_text: textB,
        changed_lines: changed ? changedLines(textA, textB) : [],
      },
      // AC-63 — different in size OR in membership. Comparing two different
      // denominators as though they were one is exactly the trap D3 records.
      like_for_like: onlyInA.length === 0 && onlyInB.length === 0 && idsA.length === idsB.length,
      case_diff: { only_in_a: onlyInA, only_in_b: onlyInB },
    };
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Hold the agent's slot for the whole batch and release it however it ends.
   *
   * `finally`, not a happy-path delete: a batch that threw halfway must not
   * leave the agent permanently unrunnable until the process restarts.
   */
  private async withAgentLock<T>(
    agentId: string,
    batchId: string,
    body: () => Promise<T>,
  ): Promise<T> {
    this.inFlight.set(agentId, batchId);
    try {
      return await body();
    } finally {
      this.inFlight.delete(agentId);
    }
  }

  private async runBatch(
    workspaceId: string,
    batchId: string,
    agent: EvalAgent,
    cases: RunnableCase[],
    log?: EvalLogger,
  ): Promise<{ batch: EvalBatchResult; runIds: string[] }> {
    const skills = await this.container.agentsRepo.linkedSkills(agent.id);
    return this.executor.run({ workspaceId, batchId, agent, skills, cases, log });
  }

  private toRunnable(
    id: string,
    name: string,
    inputDiff: string,
    inputMeta: unknown,
    expectedOutput: unknown,
  ): RunnableCase {
    const meta = inputMeta as { body?: unknown } | null | undefined;
    const body = typeof meta?.body === 'string' ? meta.body : null;
    return {
      id,
      name,
      inputDiff,
      prDescription: body ? truncateCodePoints(body, MAX_INPUT_META_BODY_CHARS) : null,
      expectations: readExpectations(expectedOutput),
    };
  }

  private normaliseMeta(
    meta: { title?: string | null; body?: string | null } | null,
  ): { title: string | null; body: string | null } | null {
    if (!meta) return null;
    return {
      title: meta.title ? truncateCodePoints(meta.title, MAX_CASE_NAME_CHARS) : null,
      body: meta.body ? truncateCodePoints(meta.body, MAX_INPUT_META_BODY_CHARS) : null,
    };
  }

  /** AC-69, size half — checked in CODE POINTS, before anything is parsed. */
  private assertDiffSize(text: string): void {
    const length = [...text].length;
    if (length > MAX_INPUT_DIFF_CHARS) {
      throw new AppError(
        'limit_exceeded',
        `This case's diff is ${length} characters and the ceiling is ${MAX_INPUT_DIFF_CHARS}. ` +
          'The diff is the prompt, so an unbounded diff is an unbounded bill. Cut it to the ' +
          'hunks the expectations actually cite.',
        422,
      );
    }
  }

  /** AC-69, count and byte halves. The record cap is also `EvalExpectations.max(50)`. */
  private assertExpectationsSize(expectations: EvalExpectations): void {
    if (expectations.length > MAX_EXPECTATIONS) {
      throw new AppError(
        'limit_exceeded',
        `A case may carry at most ${MAX_EXPECTATIONS} expectations; this one carries ` +
          `${expectations.length}.`,
        422,
      );
    }
    const bytes = Buffer.byteLength(JSON.stringify(expectations), 'utf8');
    if (bytes > MAX_EXPECTED_OUTPUT_BYTES) {
      throw new AppError(
        'limit_exceeded',
        `This case's expected output is ${bytes} bytes and the ceiling is ` +
          `${MAX_EXPECTED_OUTPUT_BYTES}.`,
        422,
      );
    }
  }

  private assertNotesSize(notes: string | null): void {
    if (notes && [...notes].length > MAX_NOTES_CHARS) {
      throw new AppError(
        'limit_exceeded',
        `Notes may hold at most ${MAX_NOTES_CHARS} characters.`,
        422,
      );
    }
  }
}

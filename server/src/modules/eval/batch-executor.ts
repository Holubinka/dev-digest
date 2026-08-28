import type {
  EvalBatchAggregate,
  EvalBatchResult,
  EvalPerTrace,
  EvalRunEnvelope,
  Finding,
  LLMProvider,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { AppError, ConfigError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import { attachedSkills, skillBodiesFor, type LinkedSkillLike } from '../_shared/skill-prompt.js';
import { assertRunnableFragment } from './diff-fragment.js';
import { poolBatch, scoreCase, type ScoreCounters } from './scoring.js';
import { CASE_TIMEOUT_MS, EVAL_TASK_LINE, MAX_STORED_FINDINGS } from './constants.js';
import type { EvalAgent, EvalContainer, EvalLogger, RunnableCase } from './types.js';
import type { InsertEvalRun } from './repository.js';

/**
 * eval — running one agent's case set as one batch.
 *
 * WHAT THE MODEL IS SHOWN, exhaustively (AC-25): the current version's system
 * prompt, the linked skills' bodies, the case's `input_diff`, the case's
 * `input_meta.body`, and `EVAL_TASK_LINE`. Nothing else. No repo map, no
 * project-context specs, no derived intent, no memory, no callers — every one
 * of those depends on the state of a clone and an index, so two runs of two
 * agent versions would not have been comparable, which is the whole point of a
 * fixed input (D8).
 *
 * The conditional spreads below are the contract `run-executor.ts:411-433`
 * carries: a feature that resolved to nothing must produce a prompt
 * byte-identical to the shape from before that feature existed, which is why
 * they are spreads and not `x: undefined`.
 *
 * SEQUENTIAL, deliberately. AC-36 caps the provider at one concurrent call for
 * the duration of a batch, and a `for` loop gives that for free; every case is a
 * paid call, so there is nothing to win by racing them.
 *
 * FILENAME IS LOAD-BEARING: `*-executor.ts` may import no `src/adapters/**` and
 * no `node:fs` (`no-service-to-adapter-impl`, `no-fs-in-service`). That is why
 * the diff is parsed by `./diff-fragment.ts`, a plain module, and never here.
 */

/** The writes a batch performs. An interface so a hermetic test can fake it. */
export interface BatchStore {
  insertRun(values: InsertEvalRun): Promise<{ id: string }>;
  updateRunEnvelopes(workspaceId: string, batchId: string, aggregate: unknown): Promise<void>;
}

export interface BatchInput {
  workspaceId: string;
  batchId: string;
  agent: EvalAgent;
  /** Raw bindings; the two filters in `_shared/skill-prompt.ts` apply here too. */
  skills: LinkedSkillLike[];
  cases: RunnableCase[];
  log?: EvalLogger;
}

/** What a batch produced: the contract shape, plus the row ids it wrote. */
export interface BatchOutcome {
  batch: EvalBatchResult;
  /** The `eval_runs` ids, in case order — `EvalRunResult.run_id` for a single case. */
  runIds: string[];
}

/** One case's outcome, before it is folded into the batch. */
interface CaseOutcome {
  runId: string;
  run: InsertEvalRun;
  perTrace: EvalPerTrace;
  counters: ScoreCounters | null;
  costUsd: number | null;
  durationMs: number;
  errored: boolean;
}

export class EvalBatchExecutor {
  constructor(
    private container: EvalContainer,
    private store: BatchStore,
  ) {}

  async run(input: BatchInput): Promise<BatchOutcome> {
    const { workspaceId, batchId, agent, cases, log } = input;

    // REFUSAL 3 (AC-29), before the loop and therefore before any paid call.
    // `container.llm` throws `ConfigError` when the provider has no key in
    // `SecretsProvider`; translating it here is what makes "zero provider calls"
    // a property of the code path rather than of how far the loop happened to
    // get. Resolving ONCE also means one client for the whole batch.
    let llm: LLMProvider;
    try {
      llm = await this.container.llm(agent.provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          'provider_not_configured',
          `No API key is configured for "${agent.provider}", so this batch would have ` +
            'failed on its first case after starting. Add the key on the Settings screen, ' +
            'then run the set again.',
          409,
        );
      }
      throw err;
    }

    const attached = attachedSkills(input.skills);
    const skillBodies = skillBodiesFor(input.skills);
    const skillList = attached.map((l) => ({ id: l.skill.id, name: l.skill.name }));

    const outcomes: CaseOutcome[] = [];
    for (const c of cases) {
      outcomes.push(
        await this.runOneCase({ batchId, agent, llm, skillBodies, skillList, case: c, log }),
      );
    }

    // Write every row first (D9 — a dropped connection must not lose paid work),
    // then the aggregate over them. `insertRun` already ran inside the loop.
    const errored = outcomes.filter((o) => o.errored).length;
    const passed = outcomes.filter((o) => o.run.pass === true).length;
    const durationMs = outcomes.reduce((s, o) => s + o.durationMs, 0);
    const costs = outcomes.map((o) => o.costUsd).filter((c): c is number => c !== null);
    // `null` and `0` are different facts — "the provider reported no price" is
    // not "it was free", and only one of them should ever render as $0.00.
    const costUsd = costs.length > 0 ? costs.reduce((s, c) => s + c, 0) : null;

    // Pooled over the cases that actually produced counters. An errored case
    // contributes none, so it is outside every denominator (AC-33).
    const pooled = poolBatch(
      outcomes.map((o) => o.counters).filter((c): c is ScoreCounters => c !== null),
    );

    // AC-34: every case errored → NO aggregate. That absence is the only marker
    // the reads need: `completedBatches` selects on the aggregate being an
    // object, so such a batch is missing from the trend and from the comparison
    // list by construction rather than by a second flag someone must maintain.
    let aggregate: EvalBatchAggregate | null = null;
    if (cases.length > 0 && errored < cases.length) {
      aggregate = {
        batch_id: batchId,
        completed_at: new Date().toISOString(),
        cases: cases.length,
        passed,
        errored,
        recall: pooled.recall,
        precision: pooled.precision,
        citation_accuracy: pooled.citation_accuracy,
        cost_usd: costUsd,
        duration_ms: durationMs,
        case_ids: cases.map((c) => c.id),
      };
      await this.store.updateRunEnvelopes(workspaceId, batchId, aggregate);
    }

    log?.info(
      {
        batchId,
        agentId: agent.id,
        agentVersion: agent.version,
        cases: cases.length,
        passed,
        errored,
        durationMs,
        costUsd,
      },
      `eval batch ${batchId}: ${passed}/${cases.length} passed, ${errored} errored`,
    );

    const batch: EvalBatchResult = {
      batch_id: batchId,
      agent_id: agent.id,
      agent_version: agent.version,
      result: {
        // The pooled convention over an empty counter set is 1 (AC-47/AC-48's
        // rule, applied to a batch). For an all-errored batch that is not a
        // claim about quality — `aggregate: null` and `errored` carry that, and
        // such a batch never reaches a trend or a comparison.
        recall: pooled.recall,
        precision: pooled.precision,
        citation_accuracy: pooled.citation_accuracy,
        traces_passed: passed,
        traces_total: cases.length,
        duration_ms: durationMs,
        cost_usd: costUsd,
        per_trace: outcomes.map((o) => o.perTrace),
      },
      errored,
      aggregate,
    };
    return { batch, runIds: outcomes.map((o) => o.runId) };
  }

  private async runOneCase(args: {
    batchId: string;
    agent: EvalAgent;
    llm: LLMProvider;
    skillBodies: string[];
    skillList: { id: string; name: string }[];
    case: RunnableCase;
    log?: EvalLogger;
  }): Promise<CaseOutcome> {
    const { batchId, agent, llm, skillBodies, skillList, case: c, log } = args;
    const startedAt = Date.now();

    const baseEnvelope = {
      batch_id: batchId,
      agent_id: agent.id,
      agent_version: agent.version,
      provider: agent.provider,
      model: agent.model,
      skills: skillList,
      aggregate: null,
    } as const;

    try {
      // Parsed and guarded PER CASE rather than once up front: `input_diff` is
      // free text in the case editor, so a case edited into something with no
      // anchorable hunk must fail as ITS OWN error and leave the other 24 cases
      // of the batch to run (AC-32), not abort the batch someone just paid to
      // start. The single-case run path checks the same guard at the route and
      // answers 422 (AC-23).
      const diff = assertRunnableFragment(c.inputDiff);

      const outcome = await withTimeout(
        reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff,
          llm,
          strategy: agent.strategy,
          // `length > 0`, not truthiness: `[]` is truthy, and an agent with
          // nothing bound must produce the pre-skills prompt byte for byte.
          ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
          // The PR body, wrapped and truncated by the engine's own untrusted
          // slot (C12/AC-71). It is never concatenated into `systemPrompt` or
          // into the task line.
          ...(c.prDescription ? { prDescription: c.prDescription } : {}),
          task: EVAL_TASK_LINE,
        }),
        CASE_TIMEOUT_MS,
      );

      const kept = outcome.review.findings;
      const returned = kept.length + outcome.dropped.length;
      const score = scoreCase({ expectations: c.expectations, kept, returned });

      const stored: Finding[] = kept.slice(0, MAX_STORED_FINDINGS);
      const envelope: EvalRunEnvelope = {
        ...baseEnvelope,
        findings: stored,
        findings_truncated: kept.length > MAX_STORED_FINDINGS,
        returned,
        dropped: outcome.dropped.length,
        error: null,
      };

      const durationMs = Date.now() - startedAt;
      const run: InsertEvalRun = {
        caseId: c.id,
        actualOutput: envelope,
        pass: score.pass,
        recall: score.recall,
        precision: score.precision,
        citationAccuracy: score.citation_accuracy,
        durationMs,
        costUsd: outcome.costUsd,
      };
      const inserted = await this.store.insertRun(run);

      return {
        runId: inserted.id,
        run,
        perTrace: {
          name: c.name,
          pass: score.pass,
          expected: c.expectations,
          actual: stored,
        },
        counters: score.counters,
        costUsd: outcome.costUsd,
        durationMs,
        errored: false,
      };
    } catch (err) {
      // AC-32: the case is written with pass=false, NULL metrics and the error
      // text, and the batch continues. `null` rather than 0 in the three metric
      // columns because "not measured" and "measured as zero" are different
      // facts, and only the second belongs in a trend.
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      const envelope: EvalRunEnvelope = {
        ...baseEnvelope,
        findings: [],
        findings_truncated: false,
        returned: 0,
        dropped: 0,
        error: message,
      };
      const run: InsertEvalRun = {
        caseId: c.id,
        actualOutput: envelope,
        pass: false,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs,
        costUsd: null,
      };
      const inserted = await this.store.insertRun(run);
      log?.warn({ batchId, caseId: c.id, err: message }, `eval case "${c.name}" failed`);

      return {
        runId: inserted.id,
        run,
        perTrace: { name: c.name, pass: false, expected: c.expectations, actual: { error: message } },
        counters: null,
        costUsd: null,
        durationMs,
        errored: true,
      };
    }
  }
}

import { Intent, type IntentRecord } from '@devdigest/shared';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import type { PrIntentRow, PullRow, RepoRow } from '../../db/rows.js';
import type { IntentRepository } from './repository.js';
import type {
  IntentContainer,
  IntentDeriver,
  IntentDerivation,
  IntentSources,
} from './types.js';
import {
  INTENT_FEATURE,
  INTENT_MAX_RETRIES,
  INTENT_SYSTEM_PROMPT,
  INTENT_TIMEOUT_MS,
  MAX_COMMIT_MESSAGES,
  MAX_FILE_PATHS,
  MAX_PLAN_FILE_BYTES,
  MAX_PLAN_FILE_CHARS,
} from './constants.js';
import {
  bandConfidence,
  collectEvidence,
  parsePlanRefs,
  renderClassifierInput,
  renderIntentSection,
  toIntentRecord,
  truncateCodePoints,
} from './helpers.js';

type Emit = (kind: 'info' | 'tool' | 'error', msg: string) => void;

/**
 * intent — derive WHY a PR exists from the evidence already on disk, once per
 * PR, and cache it on `pr_intent`.
 *
 * ZERO GitHub calls: every source is a DB read or a clone read, because a
 * review run must not depend on network reachability. `GET /pulls/:id` is what
 * refreshes the cache.
 */
export class IntentService implements IntentDeriver {
  // The repository is a PARAMETER, never built in the body (`onion-architecture`
  // §3.3): it is the seam that makes this service testable without Postgres.
  // It has no `new IntentRepository(container.db)` default because that default
  // is what would force a `Db` onto `IntentContainer`; `platform/container.ts`
  // supplies it instead, which is the composition root's job.
  constructor(
    private container: IntentContainer,
    private repo: IntentRepository,
  ) {}

  async get(workspaceId: string, prId: string): Promise<IntentRecord | null | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const row = await this.repo.getIntent(prId);
    return row ? toIntentRecord(row) : null;
  }

  /**
   * NEVER throws. Everything from source gathering through the upsert is inside
   * one try: a missing provider key, an exhausted schema repair, a timeout or a
   * DB error all arrive as `{ ok: false, reason }`, and nothing is persisted.
   *
   * The route turns that into a 502 so Recompute can say what went wrong; the
   * review pre-pass logs it and carries on with a prompt byte-identical to
   * today's. A failed intent never fails a review.
   */
  async derive(input: {
    workspaceId: string;
    prId: string;
    onEvent?: Emit;
  }): Promise<IntentDerivation> {
    const emit: Emit = input.onEvent ?? (() => {});
    try {
      const pull = await this.repo.getPull(input.workspaceId, input.prId);
      if (!pull) return { ok: false, reason: 'Pull request not found' };
      const repo = await this.repo.getRepo(pull.repoId);
      if (!repo) return { ok: false, reason: 'Repo not found' };

      const sources = await this.gatherSources(pull, repo, emit);
      const evidence = collectEvidence(sources);
      const confidence = bandConfidence(evidence);

      const choice = await resolveFeatureModel(this.container, input.workspaceId, INTENT_FEATURE);
      const llm = await this.container.llm(choice.provider);
      const result = await llm.completeStructured<Intent>({
        model: choice.model,
        schema: Intent,
        schemaName: 'Intent',
        messages: [
          { role: 'system', content: await this.container.prompts.render(INTENT_SYSTEM_PROMPT, {}) },
          { role: 'user', content: renderClassifierInput(sources) },
        ],
        maxRetries: INTENT_MAX_RETRIES,
        timeoutMs: INTENT_TIMEOUT_MS,
        // No reasoning: this is a short extraction, and reasoning tokens bill
        // at the output rate. Measured 2026-08-05 against OpenRouter — the
        // same answer cost 1078 completion tokens with reasoning on and 113
        // with it off.
        reasoning: false,
      });

      const row = await this.repo.upsertIntent(input.prId, {
        intent: result.data.intent,
        inScope: result.data.in_scope,
        outOfScope: result.data.out_of_scope,
        riskAreas: result.data.risk_areas,
        confidence,
        evidence,
        planRefs: sources.planFiles.map((file) => file.path),
        provider: choice.provider,
        model: choice.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      });

      return this.derived(row, result.tokensIn, result.tokensOut, result.costUsd);
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  private derived(
    row: PrIntentRow,
    tokensIn: number,
    tokensOut: number,
    costUsd: number | null,
  ): IntentDerivation {
    const record = toIntentRecord(row);
    // The rendered section rides on the result so `run-executor.ts` needs no
    // import from this slice at all (`no-cross-module`).
    return { ok: true, record, section: renderIntentSection(record), tokensIn, tokensOut, costUsd };
  }

  private async gatherSources(pull: PullRow, repo: RepoRow, emit: Emit): Promise<IntentSources> {
    const [commits, filePaths] = await Promise.all([
      this.repo.getCommitMessages(pull.id, MAX_COMMIT_MESSAGES),
      this.repo.getFilePaths(pull.id, MAX_FILE_PATHS),
    ]);
    return {
      title: pull.title,
      body: pull.body,
      linkedIssue: pull.linkedIssue ?? null,
      planFiles: await this.readPlanFiles(pull.body, repo, emit),
      commitMessages: commits.map((message) => message.split('\n')[0]?.trim() ?? '').filter(Boolean),
      filePaths,
    };
  }

  /**
   * Plan/spec files linked from the body, read out of the clone through
   * `container.git` — never `node:fs`, which `no-fs-in-service` forbids and
   * `GitClient.readFile` already covers.
   *
   * A path that `parsePlanRefs` rejects is dropped before it reaches the
   * adapter, and a file that is simply not in the clone logs and is skipped.
   * Neither is an error: the derivation continues without `plan_spec` in its
   * evidence, which lands it at a lower band — the correct answer.
   */
  private async readPlanFiles(
    body: string | null,
    repo: RepoRow,
    emit: Emit,
  ): Promise<{ path: string; text: string }[]> {
    if (!body) return [];
    const refs = parsePlanRefs(body, { owner: repo.owner, name: repo.name });
    if (refs.length === 0) return [];
    const out: { path: string; text: string }[] = [];
    for (const path of refs) {
      try {
        const text = await this.container.git.readFile(
          { owner: repo.owner, name: repo.name },
          path,
          MAX_PLAN_FILE_BYTES,
        );
        // A blank read is no evidence, and a GitClient may answer '' for a file
        // that is not in the clone rather than throwing.
        if (text.trim().length === 0) {
          emit('info', `intent: ${path} is empty or not in the clone — skipping`);
          continue;
        }
        out.push({ path, text: truncateCodePoints(text, MAX_PLAN_FILE_CHARS) });
      } catch (err) {
        emit('info', `intent: could not read ${path} — ${(err as Error).message}`);
      }
    }
    if (out.length > 0) emit('info', `intent: read ${out.length} linked plan/spec file(s)`);
    return out;
  }
}

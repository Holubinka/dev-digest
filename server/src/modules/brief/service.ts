import {
  RiskBrief,
  type RiskBriefInputId,
  type RiskBriefRecord,
} from '@devdigest/shared';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { parsePlanRefs } from '../_shared/plan-refs.js';
import { withTimeout } from '../../platform/resilience.js';
import { ConfigError } from '../../platform/errors.js';
import {
  BRIEF_FEATURE,
  BRIEF_MAX_RETRIES,
  BRIEF_MAX_STATES,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TIMEOUT_MS,
  BRIEF_TOKEN_BUDGET,
  MAX_FILE_PATHS,
  MAX_PATH_LENGTH,
  MAX_SPEC_FILE_BYTES,
  MAX_SPEC_FILE_CHARS,
  MAX_SPEC_FILES,
} from './constants.js';
import {
  buildAllowedRefs,
  buildBlocks,
  buildRefLines,
  firstHunkLine,
  fitToBudget,
  groundBrief,
  intentFreshness,
  mergeInputs,
  toRiskBriefRecord,
} from './helpers.js';
import { truncateCodePoints } from '../_shared/repo-paths.js';
import type {
  BriefComputation,
  BriefContainer,
  BriefLogger,
  BriefPull,
  BriefReads,
  BriefRepoRef,
  BriefSources,
} from './types.js';

/**
 * brief — WHAT this PR state changes, WHY, and what to look at first.
 *
 * ONE `completeStructured` per computation and no second call of any kind: no
 * intent derivation, no `/blast/summary`. Both of those are reads here, through
 * ports that cannot express the writing half.
 */
export class BriefService {
  /**
   * The single-flight map (R45), keyed `${prId}:${headSha}`.
   *
   * Per INSTANCE, so it is a lock exactly as long as there is one instance —
   * which is why `platform/container.ts` memoises this service and nobody
   * `new`s it. Two tabs opening the same fresh state within a second of each
   * other is the ordinary case, not the corner one: the card computes on an
   * empty read, so nobody has to click twice for it to happen.
   */
  private inFlight = new Map<string, Promise<RiskBriefRecord>>();

  constructor(
    private container: BriefContainer,
    private repo: BriefReads,
  ) {}

  /**
   * The cached record for the PR's CURRENT head, workspace-scoped.
   *
   *   `undefined` → no such PR here; the route answers 404.
   *   `null`      → the PR exists, nothing computed for this state yet.
   *
   * ZERO model calls, always, however many times it is read (R28) — nothing on
   * this path reaches `container.llm`.
   */
  async get(workspaceId: string, prId: string): Promise<RiskBriefRecord | null | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const row = await this.repo.getBriefFor(prId, pull.headSha);
    return row ? toRiskBriefRecord(row) : null;
  }

  /**
   * Compute and persist the brief for the PR's current head.
   *
   * NEVER throws for a business failure: a schema repair that ran out, a
   * timeout, a DB error all arrive as `{ ok: false, reason }` and nothing is
   * written. A `ConfigError` is the one exception and propagates as itself, so
   * the route can answer `config_error` and the card can say WHICH thing is not
   * configured instead of showing a generic 502 (R42).
   *
   * `log` belongs to the CALLER, not to the instance: the service is built once
   * by the composition root, which has none, while a request has `req.log`. A
   * caller that joins an in-flight computation contributes no line of its own —
   * the run that is already going writes with the logger it was started with.
   */
  async compute(workspaceId: string, prId: string, log: BriefLogger): Promise<BriefComputation> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) return { ok: false, reason: 'Pull request not found' };

    const key = `${prId}:${pull.headSha}`;
    const running = this.inFlight.get(key);
    if (running) {
      try {
        return { ok: true, record: await running };
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }

    const attempt = this.run(workspaceId, pull, log);
    this.inFlight.set(key, attempt);
    try {
      return { ok: true, record: await attempt };
    } catch (err) {
      // A ConfigError has to reach the route as itself. "No key for the provider
      // this feature is pointed at" is a first-class state with its own copy and
      // its own link to Settings (R42); flattening it into a 502 turns the one
      // failure the user can fix into the one they cannot diagnose.
      if (err instanceof ConfigError) throw err;
      return { ok: false, reason: (err as Error).message };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** The whole computation. Throws; `compute` is what turns that into a result. */
  private async run(
    workspaceId: string,
    pull: BriefPull,
    log: BriefLogger,
  ): Promise<RiskBriefRecord> {
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new Error('Repo not found');

    const sources = await this.gather(workspaceId, pull, repo);
    const system = await this.container.prompts.render(BRIEF_SYSTEM_PROMPT, {});
    const count = (text: string) => this.container.tokenizer.count(text);

    const fit = fitToBudget(buildBlocks(sources), count(system), BRIEF_TOKEN_BUDGET, count);
    // AC-18 counts the FIRST assembled input, system and user together, before
    // the call — not the provider's own `tokens_in`, which arrives afterwards and
    // is a different number measured by a different counter. Both are recorded.
    const inputTokensCounted = count(system) + count(fit.user);
    // AFTER counting: `TiktokenTokenizer` only learns it is broken by failing one.
    const tokenizer = this.container.tokenizer.id;
    if (tokenizer === 'heuristic') {
      log.warn(
        { prId: pull.id, headSha: pull.headSha },
        'risk brief: token count came from the degradation heuristic, not the encoder',
      );
    }

    const allowed = buildAllowedRefs(fit.included);
    const choice = await resolveFeatureModel(this.container, workspaceId, BRIEF_FEATURE);
    const llm = await this.container.llm(choice.provider);
    // `withTimeout` around the whole call, not only `timeoutMs`: that option
    // bounds ONE HTTP request, and `OpenRouterProvider` ignores this module's
    // resilience helpers entirely behind its own 600 000 ms deadline
    // (`reviewer-core/src/llm/openrouter.ts:33,111`), so the per-request number
    // is not a bound on this computation (R43).
    const result = await withTimeout(
      llm.completeStructured<RiskBrief>({
        model: choice.model,
        schema: RiskBrief,
        schemaName: 'RiskBrief',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: fit.user },
        ],
        maxRetries: BRIEF_MAX_RETRIES,
        timeoutMs: BRIEF_TIMEOUT_MS,
        // No reasoning: this is an extraction over a fact list, and reasoning
        // tokens bill at the output rate — measured 1078 vs 113 completion
        // tokens for the same answer on the intent classifier.
        reasoning: false,
      }),
      BRIEF_TIMEOUT_MS,
    );

    const grounded = groundBrief(result.data, allowed);
    const intentComputedAt = sources.intent ? new Date(sources.intent.computed_at) : null;
    const headCommittedAt = await this.repo.getHeadCommittedAt(pull.id, pull.headSha);

    // A stored line is a line something will show, so the gate is HERE as well as
    // on the client. Every number came off the index at `link_sha` and is true at
    // that commit and no other: with `index_matches_head` false it points into a
    // tree the reviewer is not reading, and with `link_sha` null there is no
    // commit at which it was ever true. Persisting it anyway leaves a plausible
    // number in jsonb for the next reader of this record to render, and
    // `contracts/blast.ts:92-109` records what that already cost once — the link
    // opened, the file existed, the line existed, and it was a comment two lines
    // above the call site.
    const linkSha = sources.blast?.link_sha ?? null;
    const indexMatchesHead = sources.blast?.index_matches_head ?? false;
    // Only the references that SURVIVED grounding: a number for a ref the filter
    // removed belongs to nothing on the record, and `ref_lines` is matched by
    // exact `ref` value.
    const groundedRefs = new Set([
      ...grounded.risks.flatMap((risk) => risk.file_refs),
      ...grounded.review_focus.map((item) => item.ref),
    ]);
    const blastLines =
      indexMatchesHead && linkSha !== null
        ? buildRefLines(fit.included).filter((entry) => groundedRefs.has(entry.ref))
        : [];

    // A second source, and the only one that survives a stale index. These
    // numbers are read out of the PR's OWN patch, so they are true at `head_sha`
    // — which is the commit a reference links to — and they need no index at
    // all. That is also why they win over a blast number for the same path: the
    // text and the target have to describe one commit, and the target is the
    // head. A blast number keeps its place where nothing changed hands: a path
    // the diff does not touch, with the index fresh.
    const patchHeads = await this.repo.getFilePatchHeads(pull.id, [...groundedRefs]);
    const hunkLines = patchHeads.flatMap(({ path, head }) => {
      const line = firstHunkLine(head);
      return line === null ? [] : [{ ref: path, line, source: 'diff_hunk' as const }];
    });
    const hunkRefs = new Set(hunkLines.map((entry) => entry.ref));
    const refLines = [...hunkLines, ...blastLines.filter((entry) => !hunkRefs.has(entry.ref))];

    const row = await this.repo.upsertBrief(
      pull.id,
      pull.headSha,
      {
        // `grounded.what` / `grounded.why`, never `result.data`'s: the model's
        // prose is bounded on the way through `groundBrief` like everything else
        // it returned, and reading the raw pair here would walk straight past it.
        what: grounded.what,
        why: grounded.why,
        riskLevel: result.data.risk_level,
        risks: grounded.risks,
        reviewFocus: grounded.review_focus,
        inputs: mergeInputs(fit.inputs, this.missingInputs(sources)),
        refLines,
        droppedRefs: grounded.dropped_refs,
        droppedRisks: grounded.dropped_risks,
        intentComputedAt,
        intentFreshness: intentFreshness(intentComputedAt, headCommittedAt),
        blastStatus: sources.blast?.status ?? 'degraded',
        linkSha,
        indexMatchesHead,
        budget: BRIEF_TOKEN_BUDGET,
        inputTokensCounted,
        tokenizer,
        // Copied off the provider's own result, never invented: `attempts` is
        // how many tries the repair loop really took and `tokensIn` is what the
        // provider billed, which is not what we counted above.
        attempts: result.attempts,
        tokensIn: result.tokensIn,
        provider: choice.provider,
        model: choice.model,
        costUsd: result.costUsd,
      },
      BRIEF_MAX_STATES,
    );

    return toRiskBriefRecord(row);
  }

  /**
   * Every source, from the DB, the clone and two READ ports.
   *
   * `intentService.get` and `blastService.getBlast` are reads: neither derives,
   * neither summarises, and the port types in `types.ts` do not name the methods
   * that would (R16, R21). Either answering with nothing is a degraded input, not
   * a failure — the brief is computed anyway and the record says which one was
   * missing (R21, R22).
   */
  private async gather(
    workspaceId: string,
    pull: BriefPull,
    repo: BriefRepoRef,
  ): Promise<BriefSources> {
    const [intent, blast, filePaths, diff] = await Promise.all([
      this.container.intentService.get(workspaceId, pull.id).catch(() => null),
      this.container.blastService.getBlast(workspaceId, pull.id).catch(() => undefined),
      this.repo.getFilePaths(pull.id, MAX_FILE_PATHS),
      this.repo.getDiffStats(pull.id),
    ]);
    return {
      title: pull.title,
      body: pull.body,
      linkedIssue: pull.linkedIssue,
      intent: intent ?? null,
      blast: blast ?? null,
      diff,
      filePaths,
      specs: await this.readSpecs(pull.body, repo),
    };
  }

  /**
   * Plan/spec files linked from the PR body, read out of the clone through
   * `container.git` — never `node:fs`.
   *
   * A path `parsePlanRefs` rejects never reaches the adapter, and a file that is
   * simply not in the clone is skipped. Neither is an error: the computation
   * continues and `inputs` reports `specs: missing`, which is the correct answer
   * rather than a failed brief.
   */
  private async readSpecs(
    body: string | null,
    repo: BriefRepoRef,
  ): Promise<{ path: string; text: string }[]> {
    if (!body) return [];
    const refs = parsePlanRefs(body, repo, {
      maxFiles: MAX_SPEC_FILES,
      maxPathLength: MAX_PATH_LENGTH,
    });
    const out: { path: string; text: string }[] = [];
    for (const path of refs) {
      try {
        const text = await this.container.git.readFile(repo, path, MAX_SPEC_FILE_BYTES);
        if (text.trim().length === 0) continue;
        // The cap is applied HERE, before anything wraps it.
        out.push({ path, text: truncateCodePoints(text, MAX_SPEC_FILE_CHARS) });
      } catch {
        // Not in the clone, or refused by the containment gate. Either way there
        // is no document, which `specs: missing` already says.
      }
    }
    return out;
  }

  /**
   * The ids that never produced a block, and the one line saying why.
   *
   * The service answers this rather than `buildBlocks`, because "there was no
   * intent" and "the budget dropped the intent" are different facts and only the
   * gatherer knows the first one.
   */
  private missingInputs(sources: BriefSources): { id: RiskBriefInputId; detail: string }[] {
    const missing: { id: RiskBriefInputId; detail: string }[] = [];
    if (!sources.intent) missing.push({ id: 'intent', detail: 'no intent derived for this PR' });
    if (!sources.blast) missing.push({ id: 'blast', detail: 'no blast answer for this PR' });
    if (sources.title.trim().length === 0 && !sources.body?.trim()) {
      missing.push({ id: 'pr_text', detail: 'the PR has no title and no description' });
    }
    if (!sources.linkedIssue) missing.push({ id: 'linked_issue', detail: 'no linked issue' });
    if (sources.specs.length === 0) {
      missing.push({ id: 'specs', detail: 'no plan or spec file linked from the description' });
    }
    return missing;
  }
}

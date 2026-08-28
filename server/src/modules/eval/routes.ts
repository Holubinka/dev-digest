import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalExpectations,
  type EvalAgentDashboard,
  type EvalBatchResult,
  type EvalCase,
  type EvalCaseFromFinding,
  type EvalCaseSet,
  type EvalCompare,
  type EvalDashboardAll,
  type EvalRunAllResult,
  type EvalRunResult,
  type SkillEvalCaseSet,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { BATCH_STARTS_PER_MINUTE, MAX_CASE_NAME_CHARS, MAX_NOTES_CHARS } from './constants.js';

/**
 * eval module (L06).
 *   POST   /findings/:id/eval-case            → turn a decided finding into a case
 *   GET    /agents/:id/eval-cases             → the agent's set + the passing badge
 *   GET    /skills/:id/eval-cases             → every case this skill's last run shaped
 *   POST   /agents/:id/eval-cases             → a hand-made case
 *   GET    /eval-cases/:id                    → one case
 *   PUT    /eval-cases/:id                    → edit one case
 *   DELETE /eval-cases/:id                    → 204; its runs cascade
 *   POST   /eval-cases/:id/run                → run one case (traces_total = 1)
 *   POST   /agents/:id/eval-runs              → run the set. PAID. Rate-limited.
 *   POST   /eval-runs                         → run every agent that has cases. PAID.
 *   GET    /eval-dashboard                    → every agent's card + recent batches
 *   GET    /agents/:id/eval-dashboard?from&to → one agent's metrics, trend and batches
 *   GET    /eval-batches/compare?a&b          → two batches, old → new
 *
 * THIS MODULE'S WHOLE INPUT SURFACE IS UNTRUSTED. `input_diff` is a fragment of
 * a stranger's pull request or free text from the editor, and it enters a model
 * prompt; `owner_id` and `case_id` are client-supplied and `eval_runs` has no
 * `workspace_id` of its own; and the two run routes are the only place in this
 * codebase where one HTTP request can start N paid model calls. So:
 *
 *  - every handler resolves tenancy with `getContext` FIRST and answers 404 for
 *    anything the workspace does not own (AC-67, AC-68);
 *  - `expected_output` is parsed by `EvalExpectations` HERE, once, in the
 *    `schema` block — the service receives an already-parsed value and does not
 *    re-validate it. `EvalExpectation` is `.strict()`, so an object with unknown
 *    fields is refused rather than silently trimmed (AC-19);
 *  - the two run routes carry a per-route `config.rateLimit` keyed by workspace.
 *    Per route rather than globally, because the global limiter is not
 *    registered at all under `NODE_ENV=test` (`app.ts:105`), so a global bound
 *    would be both untested and unenforced there.
 *
 * The service is reached through the composition root rather than constructed
 * here: it carries the single-flight map behind AC-28 and AC-35, and ONE
 * memoised instance is what makes that a lock rather than a coincidence of how
 * often this module happens to be registered.
 */

/** `input_meta` is title + body only; `input_files` is derived, never posted (D13). */
const InputMeta = z
  .object({
    title: z.string().nullish(),
    body: z.string().nullish(),
  })
  .nullish();

const NewCaseBody = z.object({
  name: z.string().min(1).max(MAX_CASE_NAME_CHARS),
  input_diff: z.string().min(1),
  input_meta: InputMeta,
  expected_output: EvalExpectations,
  notes: z.string().max(MAX_NOTES_CHARS).nullish(),
});

const UpdateCaseBody = z.object({
  name: z.string().min(1).max(MAX_CASE_NAME_CHARS).optional(),
  input_diff: z.string().min(1).optional(),
  input_meta: InputMeta,
  expected_output: EvalExpectations.optional(),
  notes: z.string().max(MAX_NOTES_CHARS).nullish(),
});

/** An ISO instant from the query string, rejected at the edge if unparseable. */
const IsoDate = z
  .string()
  .min(1)
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Expected an ISO-8601 date' });

const RangeQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.evalService;

  /**
   * The bound is per WORKSPACE, and `@fastify/rate-limit` keys by IP by default
   * — a different guarantee in both directions: one shared address throttles
   * unrelated workspaces, and a distributed caller evades the bound entirely.
   * Copied from `onboarding/routes.ts`, including the fallback: when tenancy
   * cannot be resolved there is no workspace to key on, and one shared bucket
   * for everyone would let a single broken request throttle the whole install.
   */
  const perWorkspace = {
    rateLimit: {
      max: BATCH_STARTS_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: async (req: Parameters<typeof getContext>[1]) => {
        try {
          return (await getContext(container, req)).workspaceId;
        } catch {
          return req.ip;
        }
      },
    },
  };

  // ---- creation from a finding -------------------------------------------

  // No `schema.body`, and that is a requirement rather than an omission: this
  // POST carries no body, `apiFetch` omits `content-type` for a body-less POST,
  // and Fastify then rejects a declared JSON body as empty.
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams } },
    async (req): Promise<EvalCaseFromFinding> => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.caseFromFinding(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Finding not found');
      return result;
    },
  );

  // ---- the set and the case CRUD -----------------------------------------

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams } },
    async (req): Promise<EvalCaseSet> => {
      const { workspaceId } = await getContext(container, req);
      const set = await service.listCases(workspaceId, req.params.id);
      if (!set) throw new NotFoundError('Agent not found');
      return set;
    },
  );

  app.get(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams } },
    async (req): Promise<SkillEvalCaseSet> => {
      const { workspaceId } = await getContext(container, req);
      const set = await service.listCasesForSkill(workspaceId, req.params.id);
      if (!set) throw new NotFoundError('Skill not found');
      return set;
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: NewCaseBody } },
    async (req, reply): Promise<EvalCase> => {
      const { workspaceId } = await getContext(container, req);
      const body = req.body;
      const created = await service.createCase(workspaceId, req.params.id, {
        name: body.name,
        input_diff: body.input_diff,
        input_meta: body.input_meta ?? null,
        expected_output: body.expected_output,
        notes: body.notes ?? null,
      });
      if (!created) throw new NotFoundError('Agent not found');
      reply.status(201);
      return created;
    },
  );

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req): Promise<EvalCase> => {
    const { workspaceId } = await getContext(container, req);
    const found = await service.getCase(workspaceId, req.params.id);
    if (!found) throw new NotFoundError('Eval case not found');
    return found;
  });

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateCaseBody } },
    async (req): Promise<EvalCase> => {
      const { workspaceId } = await getContext(container, req);
      const body = req.body;
      const updated = await service.updateCase(workspaceId, req.params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.input_diff !== undefined ? { input_diff: body.input_diff } : {}),
        ...(body.input_meta !== undefined ? { input_meta: body.input_meta ?? null } : {}),
        ...(body.expected_output !== undefined
          ? { expected_output: body.expected_output }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      });
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return reply.status(204).send();
  });

  // ---- running ------------------------------------------------------------

  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams }, config: perWorkspace },
    async (req): Promise<EvalRunResult> => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.runCase(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: perWorkspace },
    async (req): Promise<EvalBatchResult> => {
      const { workspaceId } = await getContext(container, req);
      const batch = await service.runSet(workspaceId, req.params.id, req.log);
      if (!batch) throw new NotFoundError('Agent not found');
      return batch;
    },
  );

  app.post('/eval-runs', { config: perWorkspace }, async (req): Promise<EvalRunAllResult> => {
    const { workspaceId } = await getContext(container, req);
    return service.runAll(workspaceId, req.log);
  });

  // ---- the reads ----------------------------------------------------------

  app.get('/eval-dashboard', async (req): Promise<EvalDashboardAll> => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboard(workspaceId);
  });

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, querystring: RangeQuery } },
    async (req): Promise<EvalAgentDashboard> => {
      const { workspaceId } = await getContext(container, req);
      const dash = await service.agentDashboard(workspaceId, req.params.id, {
        ...(req.query.from ? { from: req.query.from } : {}),
        ...(req.query.to ? { to: req.query.to } : {}),
      });
      if (!dash) throw new NotFoundError('Agent not found');
      return dash;
    },
  );

  app.get(
    '/eval-batches/compare',
    { schema: { querystring: CompareQuery } },
    async (req): Promise<EvalCompare> => {
      const { workspaceId } = await getContext(container, req);
      const compared = await service.compare(workspaceId, req.query.a, req.query.b);
      if (!compared) throw new NotFoundError('Batch not found');
      return compared;
    },
  );
}

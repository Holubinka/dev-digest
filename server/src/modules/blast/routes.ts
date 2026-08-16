import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadiusView, BlastSummaryResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * blast module.
 *   GET  /pulls/:id/blast          → what this PR reaches. Postgres only, no LLM.
 *   POST /pulls/:id/blast/summary  → one paragraph over that same answer.
 *
 * Nothing is persisted by either route: the view is recomputed per request and
 * the paragraph is never written down, so there is no cache to invalidate when
 * the index moves under it.
 */

/**
 * One paid model call for a human pressing a button — the same number
 * `POST /pulls/:id/intent` settled on. The `security` skill puts AI generation at
 * 3/min and `POST /pulls/:id/review` allows 10/min while fanning out to several
 * far more expensive runs; 6 sits between them deliberately.
 */
const SUMMARY_RATE_LIMIT = { rateLimit: { max: 6, timeWindow: '1 minute' } };

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  // Reached through the composition root rather than constructed here, since
  // 2026-08-16: the Risk Brief needs the same answer and `no-cross-module`
  // forbids it importing this slice. Constructing a second instance beside the
  // container's would give one question two owners — the drift
  // `container.intentService` exists to prevent. The repository is still passed
  // IN, one level up, which is the seam `blast-service.test.ts` uses.
  const service = container.blastService;

  // A pure read: it resolves tenancy, reads Postgres and returns. No rate limit
  // beyond the app-wide 120/min, and no model call under any input.
  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadiusView> => {
      const { workspaceId } = await getContext(container, req);
      const view = await service.getBlast(workspaceId, req.params.id);
      // `undefined` is a PR this workspace cannot see. 404, not 403 and not an
      // empty 200: the response must not confirm that the id exists elsewhere.
      if (!view) throw new NotFoundError('Pull request not found');
      return view;
    },
  );

  // Spend. Tenancy is resolved inside `summarize` — through the same
  // workspace-scoped read the GET uses — BEFORE a provider is resolved, so an
  // id belonging to another workspace costs nothing and 404s.
  app.post(
    '/pulls/:id/blast/summary',
    { schema: { params: IdParams }, config: SUMMARY_RATE_LIMIT },
    async (req): Promise<BlastSummaryResponse> => {
      const { workspaceId } = await getContext(container, req);
      const summary = await service.summarize(workspaceId, req.params.id);
      if (!summary) throw new NotFoundError('Pull request not found');
      return summary;
    },
  );
}

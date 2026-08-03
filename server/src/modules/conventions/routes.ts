import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_RULE_CHARS } from './constants.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module.
 *   GET   /repos/:id/conventions          → last scan + current candidates
 *   POST  /repos/:id/conventions/extract  → scan now (one model call), same shape
 *   PATCH /conventions/:id                → accept / reject / edit one candidate
 *
 * There is no "create skill from these" route on purpose: the skill body is
 * assembled and edited in the modal, then saved through `POST /skills`, which
 * already versions bodies and records `evidence_files`. A second write path
 * would be a second thing to keep in step with it.
 */

/** An extraction is one paid model call over the whole repo. Throttle it. */
const EXTRACT_RATE_LIMIT = { rateLimit: { max: 6, timeWindow: '1 minute' } };

const UpdateConventionBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(1).max(MAX_RULE_CHARS).optional(),
    category: ConventionCategory.optional(),
  })
  .refine((b) => b.status !== undefined || b.rule !== undefined || b.category !== undefined, {
    message: 'Nothing to update',
  });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.list(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Repo not found');
    return result;
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams }, config: EXTRACT_RATE_LIMIT },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.extract(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Repo not found');
      // The audit is the only record of what grounding threw away — the scan
      // row keeps the two totals, the breakdown lives here.
      req.log.info({ repoId: req.params.id, ...result.audit }, 'conventions extraction');
      return result.response;
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const patch = req.body;
      const updated = await service.update(workspaceId, req.params.id, {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      });
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { IntentRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ExternalServiceError, NotFoundError } from '../../platform/errors.js';

/**
 * intent module.
 *   GET  /pulls/:id/intent → the cached IntentRecord, or null
 *   POST /pulls/:id/intent → recompute it (one LLM call)
 *
 * The deriver is reached as `container.intentService` rather than by
 * constructing `IntentService` here, because the review pre-pass has to reach
 * the SAME instance through the container (`no-cross-module`) and one owner of
 * the cache is the point.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // `null` is the Overview card's empty state, not an error: nothing has been
  // computed for this PR yet. A PR in another workspace is a 404 — `get`
  // resolves the pull through the workspace first, so a bare `pr_intent` lookup
  // by id (an IDOR) is not reachable from here.
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams } },
    async (req): Promise<IntentRecord | null> => {
      const { workspaceId } = await getContext(container, req);
      const record = await container.intentService.get(workspaceId, req.params.id);
      if (record === undefined) throw new NotFoundError('Pull request not found');
      return record;
    },
  );

  // Recompute. One call to a cheap model, but still spend: POST /pulls/:id/review
  // allows 10/min and fans out to several expensive runs, while the `security`
  // skill puts AI generation at 3/min. Six is the compromise for a human
  // clicking a button.
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req): Promise<IntentRecord> => {
      const { workspaceId } = await getContext(container, req);
      // Tenancy before spend: `derive` reports a PR it cannot see as an ordinary
      // failure, and answering 502 for someone else's PR is both wrong and a
      // leak of the fact that the id exists.
      const cached = await container.intentService.get(workspaceId, req.params.id);
      if (cached === undefined) throw new NotFoundError('Pull request not found');

      const out = await container.intentService.derive({ workspaceId, prId: req.params.id });
      if (!out.ok) throw new ExternalServiceError(out.reason);
      return out.record;
    },
  );
}

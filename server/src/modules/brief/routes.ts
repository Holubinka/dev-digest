import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RiskBriefRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ExternalServiceError, NotFoundError } from '../../platform/errors.js';

/**
 * brief module.
 *   GET  /pulls/:id/brief → the cached RiskBriefRecord for this PR's CURRENT
 *                           head, or null. Zero model calls, always.
 *   POST /pulls/:id/brief → compute it. One model call, rate-limited.
 *
 * The service is reached through the composition root, not constructed here: a
 * route is Infrastructure, and naming `BriefService` and `BriefRepository` and
 * reaching `container.db` is the composition root's job. It also carries the
 * single-flight map that makes AC-45 true, and one memoised instance is what
 * makes that a lock — see `platform/container.ts`.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.briefService;

  // `null` is the card's empty state, not an error: nothing has been computed
  // for this state of this PR yet. A PR in another workspace answers 404 —
  // `get` resolves the pull through the workspace first, so a bare `pr_brief`
  // lookup by id (an IDOR) is not reachable from here.
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<RiskBriefRecord | null> => {
      const { workspaceId } = await getContext(container, req);
      const record = await service.get(workspaceId, req.params.id);
      if (record === undefined) throw new NotFoundError('Pull request not found');
      return record;
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams },
      config: {
        rateLimit: {
          // 20 rather than the 6 the other paid routes use, because after the
          // "compute on an empty read" decision two triggers share this limit
          // and one of them is not a click.
          max: 20,
          timeWindow: '1 minute',
          /**
           * The spec's bound is per WORKSPACE, and `@fastify/rate-limit` keys by
           * IP by default — a different guarantee in both directions: one shared
           * address throttles unrelated workspaces, and a distributed caller
           * evades the bound entirely.
           *
           * An async `keyGenerator` is supported —
           * `keyGenerator?: (req) => string | number | Promise<string | number>`,
           * `node_modules/@fastify/rate-limit/types/index.d.ts:125`, read rather
           * than assumed.
           *
           * The cost, stated: `getContext` now runs twice per POST, once here
           * and once in the handler. Under `LocalNoAuthProvider` that is two
           * cheap DB reads and no network; not worth caching on the request
           * until something measures it.
           */
          keyGenerator: async (req) => {
            try {
              return (await getContext(container, req)).workspaceId;
            } catch {
              // Tenancy could not be resolved, so there is no workspace to key
              // on. Fall back to the address rather than to one shared bucket
              // for everyone, which would let one broken request throttle the
              // whole install.
              return req.ip;
            }
          },
        },
      },
    },
    async (req): Promise<RiskBriefRecord> => {
      const { workspaceId } = await getContext(container, req);
      // Tenancy BEFORE spend, and in this order on purpose: `compute` reports a
      // PR it cannot see as an ordinary failure, and answering 502 for someone
      // else's PR is both wrong and a confirmation that the id exists.
      const cached = await service.get(workspaceId, req.params.id);
      if (cached === undefined) throw new NotFoundError('Pull request not found');

      // A `ConfigError` from the provider is deliberately NOT caught: it carries
      // `config_error` / 500 through the app error handler, which is what tells
      // the card "the model for this feature is not configured" instead of a
      // generic failure (R42).
      // `req.log`, not `app.log`: the one line this computation writes — the
      // token count came from the degradation heuristic, not the encoder — is
      // only actionable next to the request that paid for it.
      const out = await service.compute(workspaceId, req.params.id, req.log);
      if (!out.ok) throw new ExternalServiceError(out.reason);
      return out.record;
    },
  );
}

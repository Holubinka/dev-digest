import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OnboardingPage, OnboardingRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * onboarding module.
 *   GET  /repos/:id/onboarding          → the saved tour, the current index
 *                                         state, staleness and the gate.
 *                                         Zero model calls, always.
 *   POST /repos/:id/onboarding/generate → generate it. One model call,
 *                                         rate-limited PER WORKSPACE.
 *
 * Generating is always an explicit human action. There is no "compute on an
 * empty read" here — unlike the brief — because a tour is opened once per person
 * and each open would otherwise spend the workspace's money.
 *
 * The service is reached through the composition root, not constructed here: a
 * route is Infrastructure, and naming `OnboardingService` and `OnboardingRepository`
 * and reaching `container.db` is the composition root's job. It also carries the
 * single-flight map that makes AC-74 true, and ONE memoised instance is what
 * makes that a lock rather than a coincidence of how often this module is
 * registered — see `platform/container.ts`.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.onboardingService;

  // A repo in another workspace answers exactly as a missing one: `page`
  // resolves the repo through the workspace first, so a bare `onboarding` lookup
  // by id — an IDOR — is not reachable from here, and the response never
  // confirms that an id exists somewhere else (AC-9).
  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams } },
    async (req): Promise<OnboardingPage> => {
      const { workspaceId } = await getContext(container, req);
      const page = await service.page(workspaceId, req.params.id, req.log);
      if (!page) throw new NotFoundError('Repo not found');
      return page;
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      // NO `schema.body`, and that is a requirement rather than an omission:
      // this POST carries no body, `apiFetch` omits `content-type` for a
      // body-less POST, and Fastify then rejects a declared JSON body as empty.
      schema: { params: IdParams },
      config: {
        rateLimit: {
          // The NFR's figure. Per-route rather than global, because the global
          // limiter is not registered at all under `NODE_ENV=test`.
          max: 6,
          timeWindow: '1 minute',
          /**
           * The bound is per WORKSPACE, and `@fastify/rate-limit` keys by IP by
           * default — a different guarantee in both directions: one shared
           * address throttles unrelated workspaces, and a distributed caller
           * evades the bound entirely.
           *
           * An async `keyGenerator` is supported —
           * `keyGenerator?: (req) => string | number | Promise<string | number>`,
           * `node_modules/@fastify/rate-limit/types/index.d.ts:125`.
           *
           * The cost, stated: `getContext` runs twice per POST, once here and
           * once in the handler. Under `LocalNoAuthProvider` that is two cheap
           * DB reads and no network.
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
    async (req): Promise<OnboardingRecord> => {
      const { workspaceId } = await getContext(container, req);
      // Tenancy BEFORE spend, and inside the service so the check and the model
      // call cannot drift apart: a repo this caller may not see is a 404 here,
      // never a 502 and never a generation.
      const record = await service.generate(workspaceId, req.params.id, req.log);
      if (!record) throw new NotFoundError('Repo not found');

      // The audit is what an operator reads when a tour looks thin: the five
      // drop counters are the only record of what grounding threw away, the
      // input rows say what the model was actually shown, and the three numbers
      // say what it cost (AC-40, AC-52).
      //
      // NO tour text and no `packages` blocks: that is content, the record
      // already holds it, and a log is not where it is read.
      req.log.info(
        {
          repoId: req.params.id,
          ...record.dropped,
          package_scan: record.package_scan,
          inputs: record.inputs.map((i) => ({ id: i.id, status: i.status, tokens: i.tokens })),
          index_state: record.index_state,
          attempts: record.attempts,
          tokens_in: record.tokens_in,
          cost_usd: record.cost_usd,
        },
        'onboarding generation',
      );
      return record;
    },
  );
}

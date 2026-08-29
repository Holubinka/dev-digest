import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PerfRange } from '@devdigest/shared';
import type { AgentPerf, AgentPerfDetail } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolvePeriod } from './helpers.js';
import { PerformanceService } from './service.js';

/**
 * Agent Performance (SPEC-07).
 *   GET /agents/performance   → AgentPerf        the global dashboard
 *   GET /agents/:id/stats     → AgentPerfDetail  the agent editor's Stats tab
 *
 * Both live here rather than in `modules/agents`: they aggregate `agent_runs`,
 * `reviews` and `findings`, which that slice does not own, and its service and
 * repository are already at the size where the onion skill says to split.
 * Sharing the `/agents` prefix across two plugins is safe — Fastify's router
 * resolves a static segment (`performance`) before a parametric one (`:id`), and
 * both plugins spell the parameter `:id`, which is what a shared subtree requires.
 *
 * Neither route reaches an LLM port. That is the feature's promise, and it is
 * visible here: there is nothing to reach one with.
 */

/** An ISO instant from the query string, rejected at the edge if unparseable. */
const IsoDate = z
  .string()
  .min(1)
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Expected an ISO-8601 date' });

/**
 * `?range=1d|30d|custom`, with `from`/`to` when the range is custom.
 *
 * The refinement is what makes AC-8 a 422 rather than a screen full of numbers
 * for a window nobody asked for: a custom range without bounds, or with `from`
 * at or after `to`, is refused before the handler runs.
 */
const PerfQuery = z
  .object({
    range: PerfRange.default('30d'),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
  })
  .refine(
    (q) =>
      q.range !== 'custom' ||
      (q.from !== undefined && q.to !== undefined && q.from.getTime() < q.to.getTime()),
    { message: 'A custom range needs `from` and `to`, with `from` before `to`', path: ['from'] },
  );

export default async function performanceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PerformanceService(app.container);

  app.get(
    '/agents/performance',
    { schema: { querystring: PerfQuery } },
    async (req): Promise<AgentPerf> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.dashboard(workspaceId, periodOf(req.query));
    },
  );

  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: PerfQuery } },
    async (req): Promise<AgentPerfDetail> => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.agentStats(workspaceId, req.params.id, periodOf(req.query));
      if (!stats) throw new NotFoundError('Agent not found');
      return stats;
    },
  );
}

/** The clock lives here, not in `helpers.ts`, which stays a pure function of its inputs. */
function periodOf(query: z.infer<typeof PerfQuery>) {
  const custom =
    query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : undefined;
  return resolvePeriod(query.range, new Date(), custom);
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ALLOWED_TRIGGERS } from './constants.js';
import { CiService } from './service.js';

/**
 * Export to CI (16).
 *   POST /agents/:id/export-ci      → generate the bundle, and for `open_pr` publish it
 *   POST /agents/:id/export-ci/zip  → the same files as an archive; no GitHub call
 *   GET  /agents/:id/ci             → this agent's installations, with staleness
 *   GET  /ci/runs                   → the ingested runs and the last successful poll
 *   POST /ci/runs/refresh           → poll Actions, then the same page plus `errors[]`
 *
 * NOTHING HERE POLLS ON A TIMER. Every Actions call is downstream of a request
 * a person made — the page opening or the Refresh button (AC-122). There is no
 * `setInterval`, no cron and no boot-time hook in this module.
 */

/**
 * An export builds a bundle and can write to someone else's repository, so it
 * is throttled the way `conventions/routes.ts:24` throttles its one paid call.
 * Both write paths share the limit — the zip route makes no GitHub call, but it
 * reads the agent, its skills and an 800 KB bundle off disk on every request.
 */
const EXPORT_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/**
 * The export body: the shared contract, narrowed at the edge.
 *
 * TWO NARROWINGS, each of them a criterion rather than a preference.
 *
 * `target` is `'gha'` and nothing else, so a request naming CircleCI, Jenkins or
 * the generic CLI is refused by the schema with the FIELD named and creates
 * neither files nor a row (AC-14, AC-15) — the generators for the other three
 * are the spec's non-goals N1–N3.
 *
 * `triggers` is an allowlist and not `z.string()`, because the values are
 * interpolated into the generated workflow's `types: [...]` line. A free string
 * there is a YAML injection into a file GitHub then executes, which is the one
 * place in this feature where a request body reaches an execution context.
 * `.min(1)` mirrors AC-28: clearing the last trigger is refused rather than
 * silently producing a workflow that never runs.
 *
 * `workflow` needs no narrowing: it is a field of `CiExportInput`, capped there,
 * so the wizard that sends it and the route that accepts it read the same
 * contract.
 */
const ExportBody = CiExportInput.extend({
  target: z.literal('gha').default('gha'),
  triggers: z.array(z.enum(ALLOWED_TRIGGERS)).min(1).default([...ALLOWED_TRIGGERS]),
});

/** `force: true` is the Refresh button; absent or false honours the 5-minute window. */
const RefreshBody = z.object({ force: z.boolean().default(false) });

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);
  service.registerIngestJobHandler(app.log);

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: ExportBody }, config: EXPORT_RATE_LIMIT },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.export(workspaceId, req.params.id, req.body);
      if (!result) throw new NotFoundError('Agent not found');
      return result;
    },
  );

  app.post(
    '/agents/:id/export-ci/zip',
    { schema: { params: IdParams, body: ExportBody }, config: EXPORT_RATE_LIMIT },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const archive = await service.zip(workspaceId, req.params.id, req.body);
      if (!archive) throw new NotFoundError('Agent not found');
      // A Buffer payload bypasses serialization, so the archive leaves as bytes
      // rather than as a JSON array of them. The filename is a constant: the
      // repository is a request value, and a request value in a response header
      // is how a header is injected. The browser names the file itself.
      return reply
        .type('application/zip')
        .header('content-disposition', 'attachment; filename="devdigest-ci.zip"')
        .send(Buffer.from(archive));
    },
  );

  app.get('/agents/:id/ci', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const rows = await service.installations(workspaceId, req.params.id);
    if (!rows) throw new NotFoundError('Agent not found');
    return rows;
  });

  app.get('/ci/runs', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runs(workspaceId);
  });

  app.post('/ci/runs/refresh', { schema: { body: RefreshBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.refresh(workspaceId, req.body.force);
  });
}

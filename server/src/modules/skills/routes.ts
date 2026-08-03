import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_BODY_CHARS, MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS } from './constants.js';
import { SkillsService } from './service.js';

/**
 * Skills module.
 *   GET    /skills                        → list (workspace-scoped, agent_count, NO body)
 *   GET    /skills/:id                    → one skill, body included
 *   POST   /skills                        → create (also the confirm step of an import)
 *   PUT    /skills/:id                    → update / toggle enabled (body edits version)
 *   DELETE /skills/:id                    → delete
 *   GET    /skills/:id/stats             → agents, runs, findings, acceptance
 *   GET    /skills/:id/versions           → body history (newest first)
 *   GET    /skills/:id/versions/:version  → one body snapshot
 *   POST   /skills/:id/versions/:version/restore → make that body current again
 *   POST   /skills/import/preview         → parse an upload  → draft, saves NOTHING
 *   POST   /skills/import/url             → fetch a URL      → draft, saves NOTHING
 *
 * Both import routes are previews: the client shows the draft, lets the user
 * edit it, and persists with `POST /skills`. Nothing is written until then, so
 * an abandoned import leaves nothing to clean up.
 *
 * Binding a skill to an agent lives on the agents module (`/agents/:id/skills`),
 * which owns both sides of `agent_skills`.
 */

/** Import throughput. Both routes turn attacker-influenced bytes into work. */
const IMPORT_RATE_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

const ImportUrlBody = z.object({ url: z.string().url() });

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1).max(MAX_NAME_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  type: SkillType,
  body: z.string().min(1).max(MAX_BODY_CHARS),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

/** `source` is absent on purpose — provenance is immutable once recorded. */
const UpdateSkillBody = z.object({
  name: z.string().min(1).max(MAX_NAME_CHARS).optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).max(MAX_BODY_CHARS).optional(),
  enabled: z.boolean().optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      type: body.type,
      body: body.body,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get('/skills/:id/versions/:version', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
    if (!version) throw new NotFoundError('Skill version not found');
    return version;
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(
        workspaceId,
        req.params.id,
        req.params.version,
      );
      if (!skill) throw new NotFoundError('Skill version not found');
      return skill;
    },
  );

  // No body schema: the payload is multipart, not JSON. The filename and the
  // bytes are validated by the parser, which is where the rules live.
  app.post('/skills/import/preview', { config: IMPORT_RATE_LIMIT }, async (req) => {
    await getContext(app.container, req);
    const part = await req.file();
    if (!part) throw new ValidationError('Expected a file upload');
    return service.previewImportFile({ filename: part.filename, bytes: await part.toBuffer() });
  });

  app.post(
    '/skills/import/url',
    { schema: { body: ImportUrlBody }, config: IMPORT_RATE_LIMIT },
    async (req) => {
      await getContext(app.container, req);
      return service.previewImportUrl(req.body.url);
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateContextDocBody,
  CreateContextFolderBody,
  SaveContextDocBody,
  SetContextDocsBody,
  type AgentContextDocs,
  type ContextDocsPage,
  type ContextFolderCreated,
  type SkillContextDocs,
  type SpecFile,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ValidationError } from '../../platform/errors.js';
import { ContextService } from './service.js';
import { ContextRepository } from './repository.js';
import { MAX_PATH_LENGTH } from './constants.js';

/**
 * context module — Project Context.
 *
 *   GET  /repos/:id/context/docs           → the page
 *   GET  /repos/:id/context/docs/content   → one document's markdown
 *   PUT  /repos/:id/context/docs/content   → overwrite a scanned document
 *   POST /repos/:id/context/docs           → create a document under .devdigest/
 *   POST /repos/:id/context/docs/upload    → the same, from a multipart upload
 *   POST /repos/:id/context/folders        → create a folder under .devdigest/
 *   POST /repos/:id/context/rescan         → enqueue a scan
 *   GET  /agents/:id/context-docs          → the agent's attachments + inherited
 *   PUT  /agents/:id/context-docs          → replace the agent's ordered set
 *   GET  /skills/:id/context-docs          → the skill's attachments
 *   PUT  /skills/:id/context-docs          → replace the skill's ordered set
 *
 * Registering `/agents/…` and `/skills/…` paths from THIS module is deliberate
 * and has precedent (`intent` owns `/pulls/:id/intent`): the alternative is
 * `modules/agents` importing this slice, which `no-cross-module` forbids. A
 * route's URL says which resource it addresses, not which folder owns it.
 *
 * The read path is reached through `container.projectContext`, the same instance
 * the review executor resolves an effective set with; the job handler is
 * registered here, once, at app boot — the shape `repo-intel/routes.ts` uses.
 */

const DocContentQuery = z.object({ path: z.string().min(1).max(MAX_PATH_LENGTH) });
const RepoQuery = z.object({ repo_id: z.string().uuid() });

/**
 * Every route that WRITES a file carries this, and the read routes do not.
 *
 * 30 a minute is the figure the non-functional requirements name. It is per
 * route and not global because the global limiter is turned off entirely under
 * `NODE_ENV=test` (`app.ts`), so a limit expressed only there is a limit no
 * integration test can ever observe. Rescan keeps its own, lower, six.
 */
const WRITE_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ContextService(container, new ContextRepository(container.db));
  service.registerScanJobHandler();

  app.get(
    '/repos/:id/context/docs',
    { schema: { params: IdParams } },
    async (req): Promise<ContextDocsPage> => {
      const { workspaceId } = await getContext(container, req);
      return service.docsPage(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/docs/content',
    { schema: { params: IdParams, querystring: DocContentQuery } },
    async (req): Promise<SpecFile> => {
      const { workspaceId } = await getContext(container, req);
      return service.docContent(workspaceId, req.params.id, req.query.path);
    },
  );

  // 201: a create makes a resource, and the client renders the returned
  // `SpecFile` as a list row without refetching anything.
  app.post(
    '/repos/:id/context/docs',
    { schema: { params: IdParams, body: CreateContextDocBody }, config: WRITE_RATE_LIMIT },
    async (req, reply): Promise<SpecFile> => {
      const { workspaceId } = await getContext(container, req);
      const doc = await service.createDoc(workspaceId, req.params.id, req.body);
      reply.code(201);
      return doc;
    },
  );

  // No body schema: the payload is multipart, not JSON, exactly as
  // `skills/routes.ts` documents for the one other upload in this API. The
  // filename and the bytes are validated by the service, which is where the
  // rules that apply to a document live.
  app.post(
    '/repos/:id/context/docs/upload',
    { schema: { params: IdParams }, config: WRITE_RATE_LIMIT },
    async (req, reply): Promise<SpecFile> => {
      const { workspaceId } = await getContext(container, req);
      const part = await req.file();
      if (!part) throw new ValidationError('Expected a file upload');
      const doc = await service.uploadDoc(workspaceId, req.params.id, {
        filename: part.filename,
        bytes: await part.toBuffer(),
      });
      reply.code(201);
      return doc;
    },
  );

  app.post(
    '/repos/:id/context/folders',
    { schema: { params: IdParams, body: CreateContextFolderBody }, config: WRITE_RATE_LIMIT },
    async (req, reply): Promise<ContextFolderCreated> => {
      const { workspaceId } = await getContext(container, req);
      const folder = await service.createFolder(workspaceId, req.params.id, req.body);
      reply.code(201);
      return folder;
    },
  );

  // 200 and not 201: a save changes a document that was already there, and the
  // response is that same document with its new size, tokens and hash.
  app.put(
    '/repos/:id/context/docs/content',
    { schema: { params: IdParams, body: SaveContextDocBody }, config: WRITE_RATE_LIMIT },
    async (req): Promise<SpecFile> => {
      const { workspaceId } = await getContext(container, req);
      return service.saveDoc(workspaceId, req.params.id, req.body);
    },
  );

  // The ONE route here that starts background work, so the one that is rate
  // limited. Six a minute is what a human clicking a button needs, and it is the
  // figure `POST /pulls/:id/intent` already settled on for the same shape.
  app.post(
    '/repos/:id/context/rescan',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req): Promise<{ status: 'scanning' }> => {
      const { workspaceId } = await getContext(container, req);
      return service.rescan(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, querystring: RepoQuery } },
    async (req): Promise<AgentContextDocs> => {
      const { workspaceId } = await getContext(container, req);
      return service.agentDocs(workspaceId, req.params.id, req.query.repo_id);
    },
  );

  // Set semantics: this ONE request attaches, detaches and reorders. The body's
  // `.max(50)` refuses an oversized set outright rather than truncating it —
  // a save that stores a different set from the one it was sent is worse than
  // a 400, because the editor renders it as saved.
  app.put(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req): Promise<AgentContextDocs> => {
      const { workspaceId } = await getContext(container, req);
      return service.setAgentDocs(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, querystring: RepoQuery } },
    async (req): Promise<SkillContextDocs> => {
      const { workspaceId } = await getContext(container, req);
      return service.skillDocs(workspaceId, req.params.id, req.query.repo_id);
    },
  );

  app.put(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req): Promise<SkillContextDocs> => {
      const { workspaceId } = await getContext(container, req);
      return service.setSkillDocs(workspaceId, req.params.id, req.body);
    },
  );
}

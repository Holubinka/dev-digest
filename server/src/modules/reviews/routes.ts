import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiAgentRunRequest, RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { MultiRunService } from './multi-run-service.js';
import { MAX_DIFF_CHARS, MAX_DIFF_BODY_BYTES } from './diff-review.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   POST   /reviews/diff      {diff, agentId|all}      → review a raw diff; persists nothing
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 *
 * Multi-agent review (SPEC-05) — same module, because a slice of its own could
 * not import `ReviewRunExecutor` (`no-cross-module`):
 *   POST   /pulls/:id/multi-agent-run  {agentIds}      → MultiAgentRunCreated
 *   POST   /multi-agent-runs/:id/rerun                 → MultiAgentRunCreated
 *   GET    /multi-agent-runs/:id                       → MultiAgentRun
 *   GET    /pulls/:id/multi-agent                      → MultiAgentRunRef | null
 *   GET    /repos/:id/multi-agent-runs/latest          → MultiAgentRunRef | null
 *   GET    /runs/last-successful                       → LastSuccessfulRun[]
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;

/**
 * `POST /reviews/diff` body.
 *
 * Declared rather than hand-parsed, so the type provider rejects it with a 422
 * before the handler runs (`onion-architecture` §3.1). `diff` is capped here as
 * well as by `bodyLimit` because the two answer different questions: the body
 * limit bounds the bytes on the wire, `max()` bounds what reaches a model.
 */
const DiffReviewBody = z.object({
  diff: z.string().min(1).max(MAX_DIFF_CHARS),
  agentId: z.string().uuid().optional(),
  all: z.boolean().optional(),
});

export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const multiRuns = new MultiRunService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Review a raw diff (no PR row; persists nothing) --------------------
  // Tighter than /pulls/:id/review's 10/min: that route hands its work to a
  // background executor and answers immediately with cancellable run ids, while
  // this one holds the connection open for the whole (paid) model call and
  // leaves nothing behind to cancel. Tenancy is resolved before any spend.
  app.post(
    '/reviews/diff',
    {
      schema: { body: DiffReviewBody },
      bodyLimit: MAX_DIFF_BODY_BYTES,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.reviewDiff(workspaceId, req.body, req.log);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // =========================================================================
  // Multi-Agent Review (SPEC-05)
  // =========================================================================

  // ---- Start a multi-run over a chosen SET of agents ----------------------
  // 5/min, half of /pulls/:id/review's 10: one call here fans out to up to ten
  // paid runs (§ Non-functional requirements). `.min(1)` is AC-27 and `.max(10)`
  // is AC-30, both answered by the type provider as a 422 in the structured
  // envelope BEFORE the handler runs — so nothing is created, which is what
  // those two criteria actually require.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: MultiAgentRunRequest },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRuns.create(workspaceId, req.params.id, req.body.agentIds, req.log);
    },
  );

  // ---- Re-run the stored set on the same PR (AC-114 … AC-117) -------------
  // Its own route rather than a client-named repeat: AC-28 refuses an unknown
  // agent id while AC-117 requires the survivors to run, and only a set read
  // from storage can satisfy both. Same 5/min bucket, same fan-out.
  app.post(
    '/multi-agent-runs/:id/rerun',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRuns.rerun(workspaceId, req.params.id, req.log);
    },
  );

  // ---- The whole multi-run: columns, findings and positions (AC-98) -------
  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiRuns.get(workspaceId, req.params.id);
  });

  // ---- Newest multi-run of one PR, or null (R54) --------------------------
  // `null`, not 404: "this PR has never been compared" is a state the PR page
  // renders, not a failure it reports, and a 404 would put an error toast on
  // every PR that has not been through this feature.
  app.get('/pulls/:id/multi-agent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiRuns.latestForPull(workspaceId, req.params.id);
  });

  // ---- Newest multi-run of one repo, or null (AC-94, same reason) ---------
  app.get('/repos/:id/multi-agent-runs/latest', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiRuns.latestForRepo(workspaceId, req.params.id);
  });

  // ---- Each agent's last successful run — the pre-run estimate (AC-17…23) -
  app.get('/runs/last-successful', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiRuns.lastSuccessfulRuns(workspaceId);
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}

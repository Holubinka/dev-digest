# Layering — what goes in each file

The anatomy of `modules/<name>/`. Every rule here is [SKILL.md](SKILL.md) §2's arrow applied to
one file.

A module is a vertical slice. Inside it, the rings run `routes.ts → service.ts →
repository.ts → db`, with `helpers.ts` as the pure core anything may call.

---

## 1. Module anatomy

`agents/` is the reference implementation. Copy its shape.

| File | Ring | Holds | Never holds |
|---|---|---|---|
| `routes.ts` | Infrastructure | Zod `schema`, tenancy resolution, delegation, `undefined` → `NotFoundError` | Drizzle, business rules, DTO mapping |
| `service.ts` | Application | The use case, policy, row → DTO mapping | `req`/`reply`, raw SQL, concrete adapters, `node:fs` |
| `<verb>-executor.ts` | Application | One long or background use case lifted out of a fat service | same as `service.ts` |
| `repository.ts` | Application | Drizzle, and only Drizzle | `Container`, DTOs, policy |
| `helpers.ts` | Core | Pure transforms, DTO mappers | anything with a callable dependency |
| `types.ts` | Ports | A port interface used only by this module | implementations |
| `constants.ts` | Core | Literals, job kinds, secret names | anything computed |

Only four of the eight modules have all of this today. `pulls`, `polling`, `settings` and
`workspace` are routes-only, and `pulls/routes.ts` is 420 lines. They are in the gate's baseline,
not an example to follow.

## 2. The route

```ts
export default async function agentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentsService(app.container);

  app.get('/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  });
}
```
— `modules/agents/routes.ts:70-83`

Four things happen and nothing else: validate (declaratively, via `schema`), resolve tenancy,
delegate, translate absence into an error.

**Declare the schema, do not parse in the body.** `fastify-type-provider-zod` rejects bad input
with a 422 before your handler runs, and types `req.params` for free. `reviews/routes.ts:32`
still calls `RunRequest.parse(req.body ?? {})` by hand — that is the exception the error handler
in `app.ts:136-152` still carries a fallback for, not the pattern.

**The `undefined` → 404 convention.** A service returns `undefined` for "not found"; the route
turns it into `NotFoundError`. Services do not throw HTTP concepts.

## 3. The service

```ts
export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }
}
```
— `modules/agents/service.ts:52-62`, abridged: the real class continues past `list`.

This is the shape to copy **except for one thing**: the repository is constructed, not injected.
For new code, add the seam:

```ts
constructor(container: Container, repo = new AgentsRepository(container.db)) {
  this.container = container;
  this.repo = repo;
}
```

One default parameter. Existing call sites (`new AgentsService(app.container)`) keep working, and
a test can now pass a fake. Without it the only way to substitute a repository is
`(svc as unknown as { repo: … }).repo = fake`, which is what
`test/repo-intel-facade-degraded.test.ts:33` has to do.

**Reach adapters through the container, never by import.** `container.git`, `await
container.github()`, `await container.llm(provider)`. The container resolves overrides and
secrets; importing `SimpleGitClient` bypasses both.

This is the half of the container that is prescribed, and it does not contradict the Service
Locator warning in `SKILL.md` §1 — see that section for the line. Ports come from the container;
the repository comes from a parameter. A reviewer who reads only §1 will flag `listModels` above
and be wrong.

**Degrade rather than throw when enrichment is optional:**

```ts
async listModels(provider: Provider): Promise<ModelInfo[]> {
  try { const llm = await this.container.llm(provider); return await llm.listModels(); }
  catch { return []; }
}
```
— `agents/service.ts:201-208`

## 4. When a service is too big

Not at a line count — at a **second reason to change**. `ReviewService` is 179 lines because the
435-line run pipeline moved to `run-executor.ts`:

```ts
constructor(private container: Container) {
  this.repo = new ReviewRepository(container.db);
  this.agents = container.agentsRepo;
  this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
}
```
— `reviews/service.ts:33-37`

The service keeps the public method surface and the short reads; the executor owns one long use
case. Note the executor takes its collaborators **as constructor parameters** — it already has
the seam §3 asks for.

`repo-intel/service.ts` is 764 lines and is the counter-example: its pipeline moved to
`pipeline/*.ts` but the facade never shrank.

## 5. The repository

```ts
export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }
}
```
— `modules/agents/repository.ts:51-56`

`Db`, not `Container`. Rows out, not DTOs. No policy — deciding *whether* a user may see a row is
the service's job; the repository only scopes the query it was asked for.

**Splitting a large repository.** Past ~200 lines, move the SQL into free functions grouped by
aggregate and keep the class as a dispatcher, so the public surface stays stable:

```ts
import * as pullRepo from './repository/pull.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }
}
```
— `reviews/repository.ts:24-32`

**Transactions across repositories.** Drizzle's `tx` is a `Db`-shaped client `[DZ1]`, so a method
that must join a caller's transaction takes the handle instead of reading `this.db`:

```ts
async insertRun(run: NewRun, db: Db | Tx = this.db) { … }
```

Then one `db.transaction(async (tx) => { … })` in the service passes `tx` to each repository.
Do not open a transaction inside a repository method that a caller might already have wrapped.

**Translate errors at this boundary** `[E4]`. A Postgres unique-violation should leave the
repository as a `platform/errors.ts` type, not as a `postgres` driver error. Nothing outside the
repository should need to know the driver.

## 6. Where mapping happens

Exactly one depth: **row → DTO in `helpers.ts`, called from the service.**

```ts
const rows = await this.repo.list(workspaceId);
return rows.map(toAgentDto);
```

Not in the route (`pulls/routes.ts:223-253` maps inline — a violation), and not in the
repository, which would make it impossible to compose two queries into one DTO.

`helpers.ts` is core: pure, no container, no I/O. `repos/helpers.ts:2` imports `db/schema` for a
`$inferSelect` type — a type-only edge, tolerated, and the reason `no-db-from-routes` sets
`dependencyTypesNot: ['type-only']`. A *value* import of `db/schema` into a helper is not
tolerated.

## 7. Cross-slice sharing

One slice importing another couples them at the file level. Three legitimate escapes, in order
of preference:

1. **`modules/_shared/`** — `getContext`, `IdParams`. For genuinely generic HTTP-adjacent pieces.
2. **A repository on the container** — `container.agentsRepo`, `container.reviewRepo`.
   Constructed in the composition root precisely "so consuming modules use `container.agentsRepo`
   instead of reaching into another module's folder" (`platform/container.ts:70-72`).
3. **A port** — when the other slice is really a service to this one, define the interface it
   needs (`modules/repo-intel/types.ts`) and inject it as `container.repoIntel`.

What is left over is job kinds: `repos/service.ts:11` imports `INDEX_JOB_KIND` from
`repo-intel/constants.ts` because a job kind has no neutral home. It is in the baseline. If you
add another cross-slice constant, put it in `_shared/` instead.

**Escape 2 and rule §3.5 pull against each other, and the ordering above is the tie-breaker.**
A repository returns rows (§3.2), so taking one off the container carries a `*Row` out of its
slice — which §3.5 forbids. That is not hypothetical: `reviews/service.ts:49,106,118` and
`run-executor.ts:59,143,451` all carry `AgentRow` in public signatures. No gate sees it, because
the type is imported from the neutral `db/rows.ts` rather than from `modules/agents/`, so
`no-cross-module` never matches and it is not in the baseline either.

So: escape 2 is for reaching a *behaviour* on another slice. The moment its rows start appearing
in your own signatures, you wanted escape 3 — declare the minimal shape your slice actually needs
in `modules/<yours>/types.ts` and map to it in the owning slice's `helpers.ts`.

## 8. `platform/` is not a lower layer

`platform/` holds cross-cutting infrastructure *and* the composition root, so it imports
`modules/`. That makes `platform ⇄ modules` a folder-level cycle by design `[S1]`. Do not
"fix" it, and do not treat `platform/` as a place where module code may be parked to dodge a
layering rule.

Two things in `platform/` are worth knowing:

- `platform/jobs.ts` owns the `jobs` table directly rather than through a repository. A real
  deviation, in the baseline, kept because `JobRunner` is infrastructure that happens to persist.
- `platform/sse.ts:103` exports a module-level `runBus` singleton that the container assigns
  rather than constructs. Two `buildApp()` instances in one process share run state.

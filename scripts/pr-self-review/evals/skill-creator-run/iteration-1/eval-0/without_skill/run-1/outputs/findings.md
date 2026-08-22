# Review: new `GET /pulls/:id/files/search` route

File under review: `server/src/modules/pulls/routes.ts` (new route appended to `pullsRoutes`, after the existing `POST /pulls/:id/comments` handler). Line numbers are for the file as it reads *after* the diff is applied — the new route occupies lines 368–395.

## Findings

### 1. SQL injection via unparameterized `sql.raw` — Critical (blocker)
**File:** `server/src/modules/pulls/routes.ts`, line ~384 (the `sql.raw(...)` call, lines 382–386).
```ts
sql.raw(
  `select path, patch from pr_files where pr_id = '${pr.id}' and path ilike '%${q ?? ''}%'`,
),
```
`q` is the raw, fully attacker-controlled `?q=` query string value, concatenated straight into a raw SQL statement via `sql.raw` — the one drizzle-orm escape hatch that explicitly bypasses parameterization. Anyone who can call this endpoint can inject arbitrary SQL (e.g. `?q=' UNION SELECT ... --`) to read other tables/workspaces, including `pr_files.patch` for PRs they shouldn't see. The codebase already shows the safe alternative one file over — `context/repository.ts` uses drizzle's tagged `sql\`... ${value} ...\`` template, which auto-parameterizes — so the safe primitive was available and simply wasn't used.

### 2. GitHub token written to logs on every query failure — Critical (blocker)
**File:** `server/src/modules/pulls/routes.ts`, lines 388–391 (the `catch` block).
```ts
} catch (err) {
  const token = await container.secrets.get('GITHUB_TOKEN');
  app.log.error({ err, token }, 'PR file search failed');
  throw new AppError('search_failed', 'File search failed.', 500);
}
```
The catch handler fetches the live `GITHUB_TOKEN` from `SecretsProvider` and logs it in plaintext, for a code path unrelated to GitHub. It's trivial to trigger — even a single stray `'` in `q` breaks the injected SQL and lands here — so any caller who can make this query fail (easy, per finding #1) gets the server to write the real GitHub token into its logs. Whoever can read those logs (or a downstream system they ship to) now has a credential for this installation's GitHub identity. There's no reason this handler needs to touch secrets at all.

### 3. No workspace/tenant scoping on the PR lookup (IDOR) — High
**File:** `server/src/modules/pulls/routes.ts`, lines 375–378.
```ts
const [pr] = await container.db
  .select()
  .from(t.pullRequests)
  .where(eq(t.pullRequests.id, req.params.id));
```
Every sibling route in this file scopes the PR by workspace first — `GET /pulls/:id` does `and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id))`, and the shared `resolvePrAndRepo` helper used by the comments routes does the same. This route never calls `getContext` and filters only by `id`. `pullRequests.workspaceId` is a real, enforced column, so once there's more than one workspace, a caller who has (or guesses) a PR UUID from another workspace can search and read that PR's file paths and patch text — someone else's source diffs.

### 4. `q` query parameter is unvalidated — Medium
**File:** `server/src/modules/pulls/routes.ts`, line 373.
```ts
const { q } = req.query as Record<string, string | undefined>;
```
Other routes with query strings in this codebase (`context/routes.ts`'s `DocContentQuery` / `RepoQuery`) declare a zod `querystring` schema so Fastify validates/coerces it. Here `q` is just cast, not validated — no length bound, no type guarantee (a repeated `?q=a&q=b` produces an array under Fastify's default parser, which would silently stringify into the SQL rather than being rejected). Beyond compounding finding #1, an unbounded `q` with no `LIMIT` on the query is also a mild DoS lever via pathological `ILIKE '%...%'` patterns.

### 5. DB access embedded directly in `routes.ts`, extending a known anti-pattern — Low/style
**File:** `server/src/modules/pulls/routes.ts`, lines 368–395 (whole handler).
`server/.dependency-cruiser.cjs`'s `no-db-from-routes` rule names this exact file in its own comment ("pulls/routes.ts is what happens without it: 420 lines and 16 container.db calls") as the poster child for the anti-pattern the `routes.ts → service.ts → repository.ts` layering exists to stop. It's already grandfathered in `.dependency-cruiser-known-violations.json` so `pnpm arch` won't fail here, but this PR adds more raw SQL directly in the route instead of a `pulls/repository.ts`, growing the exact debt the rule flags — with a hand-rolled interpolated string, worse than the query-builder style already used elsewhere in this file.

## Not flagged
Nothing else in this diff stood out — the `NotFoundError` handling for a missing PR and the overall shape of registering a new `app.get` alongside the existing routes follow the file's conventions correctly.

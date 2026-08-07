import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * The `devdigest/skills-lab` fixtures: two pull requests whose diffs exist only
 * as `pr_files.patch` text.
 *
 * They are here so the skills before/after can be reproduced from
 * `pnpm db:seed` by anyone, with no GitHub token and no network:
 * `diff-loader` falls back to reconstructing a diff from stored patches when a
 * repo has no clone, so a hand-written patch is a complete, byte-stable fixture.
 *
 * Two rules keep this honest, and both matter:
 *
 *  - The repo is named `skills-lab` so nobody mistakes these for imported work.
 *    `acme/payments-api` #482 is the cautionary tale — INSIGHTS.md records a
 *    morning lost to seeded findings that no run ever produced.
 *  - NO findings are ever seeded on these PRs. Every finding shown against them
 *    comes from a real model call. If a run returns nothing, that is the result.
 *
 * Both diffs ADD or CHANGE every line a reviewer needs to cite, which is a
 * design requirement rather than a coincidence: `groundFindings` drops any
 * finding whose range misses a hunk, so a fixture where the interesting answer
 * lives in an unchanged file would delete its own evidence.
 */

const PRICING_TS = `@@ -0,0 +1,17 @@
+/** Round a money amount to cents. */
+export function round(n: number): number {
+  return Math.round(n * 100) / 100;
+}
+
+export function applyDiscount(total: number, code: string): number {
+  if (total <= 0) {
+    throw new Error('total must be a positive amount');
+  }
+  if (code === 'HALF') {
+    return round(total / 2);
+  }
+  if (code === 'TENTH') {
+    return round(total * 0.9);
+  }
+  return round(total);
+}`;

const PRICING_TEST = `@@ -0,0 +1,8 @@
+import { describe, it, expect } from 'vitest';
+import { applyDiscount } from '../src/pricing';
+
+describe('applyDiscount', () => {
+  it('halves the total for HALF', () => {
+    expect(applyDiscount(100, 'HALF')).toBe(50);
+  });
+});`;

/**
 * PR #103's point is that branch coverage looks COMPLETE. Every branch has a
 * test; what none of them has is an assertion about the returned value. The
 * rounding is wrong — `Math.round(x) / 100` instead of `Math.round(x * 100) /
 * 100`, so a 100 subtotal at 20% returns 1.2 rather than 120 — and all three
 * tests still pass, because two assert on a spy and the third only checks the
 * type. That is what separates a checklist that enumerates branches from one
 * that reads assertions.
 */
const INVOICE_TS = `@@ -0,0 +1,10 @@
+import { taxFor } from './tax';
+
+/** Total including the regional tax rate, rounded to cents. */
+export function totalWithTax(subtotal: number, region: string): number {
+  if (subtotal < 0) {
+    throw new Error('subtotal must not be negative');
+  }
+  const rate = taxFor(region);
+  return Math.round(subtotal * (1 + rate)) / 100;
+}`;

const INVOICE_TEST = `@@ -0,0 +1,23 @@
+import { describe, it, expect, vi } from 'vitest';
+import * as tax from '../src/tax';
+import { totalWithTax } from '../src/invoice';
+
+describe('totalWithTax', () => {
+  it('applies the regional tax rate', () => {
+    const rate = vi.spyOn(tax, 'taxFor').mockReturnValue(0.2);
+    totalWithTax(100, 'EU');
+    expect(rate).toHaveBeenCalledWith('EU');
+  });
+
+  it('rejects a negative subtotal', () => {
+    const rate = vi.spyOn(tax, 'taxFor').mockReturnValue(0.2);
+    expect(() => totalWithTax(-1, 'EU')).toThrow();
+    expect(rate).not.toHaveBeenCalled();
+  });
+
+  it('rounds the total to cents', () => {
+    vi.spyOn(tax, 'taxFor').mockReturnValue(0.1);
+    const total = totalWithTax(10, 'US');
+    expect(typeof total).toBe('number');
+  });
+});`;

const SEARCH_ROUTES = `@@ -1,15 +1,18 @@
 import type { FastifyInstance } from 'fastify';
 import { z } from 'zod';
 import { SearchService } from './service.js';

-const Query = z.object({ q: z.string() });
+const Query = z.object({
+  query: z.string(),
+  limit: z.coerce.number().int().min(1).max(100).default(20),
+});

 export default async function searchRoutes(app: FastifyInstance) {
   const service = new SearchService(app.container);

   app.get('/search', { schema: { querystring: Query } }, async (req) => {
-    const { q } = req.query;
-    const results = await service.search(q);
-    return { results, total: results.length };
+    const { query, limit } = req.query;
+    const items = await service.search(query, limit);
+    return { items };
   });
 }`;

const SEARCH_DOCS = `@@ -10,8 +10,9 @@
 ## GET /search

 | Param | Type | Notes |
 |---|---|---|
 | q | string | the search term |
+| limit | number | page size, defaults to 20 |

 Returns { results, total }.
 `;

// ---- PR #104: the Smart Diff fixture --------------------------------------
//
// Nine files spanning all three Smart Diff roles, so the grouping, the collapsed
// lock file and the finding badges are all reproducible from `pnpm db:seed`.
// Every planted defect sits on an ADDED line, for the grounding reason above.
//
// The key in CONFIG_TS has never been a credential — it is there because a
// hardcoded secret is the finding this fixture exists to provoke. Keep the
// underscored words in it: an unbroken alphanumeric run after `sk_live_` matches
// Stripe's own detector, and GitHub push protection then refuses the push with
// "secret detected in server/src/db/seed-fixtures.ts". It still reads as a
// credential assigned in config, which is all the reviewer needs to see.

const RATELIMIT_TS = `@@ -0,0 +1,32 @@
+import type { NextFunction, Request, Response } from 'express';
+import { redis } from '../redis';
+import { config } from '../config';
+
+/** Bucket key for the caller: the API key when present, the socket address otherwise. */
+export function bucketKey(req: Request): string {
+  const apiKey = req.header('x-api-key');
+  return 'ratelimit:' + (apiKey ?? req.ip);
+}
+
+function limitFor(req: Request): number {
+  return req.header('x-api-key') ? config.rateLimit.authed : config.rateLimit.anonymous;
+}
+
+export async function rateLimit(req: Request, res: Response, next: NextFunction) {
+  const key = bucketKey(req);
+  const count = await redis.incr(key);
+  if (count === 1) {
+    await redis.expire(key, 3600);
+  }
+
+  if (count > limitFor(req)) {
+    res.setHeader('Retry-After', '3600');
+    return res.status(429).end();
+  }
+
+  return next();
+}
+
+export async function resetBucket(req: Request): Promise<void> {
+  await redis.del(bucketKey(req));
+}`;

const WEBHOOKS_TS = `@@ -58,7 +58,19 @@
 export async function webhookHandler(req: Request, res: Response) {
   const account = await db.accounts.find(req.body.accountId);
   if (!account) {
     return res.status(404).end();
   }
-  return res.status(202).end();
+
+  const target = req.body.callback_url;
+  const token = account.apiToken;
+  await fetch(target, {
+    method: 'POST',
+    headers: {
+      Authorization: 'Bearer ' + token,
+      'content-type': 'application/json',
+    },
+    body: JSON.stringify(req.body.event),
+  });
+
+  return res.status(202).end();
 }`;

const USERS_TS = `@@ -41,4 +41,10 @@
 export async function listUsers(req: Request, res: Response) {
   const users = await db.users.findMany();
-  return res.json(users);
+  const result = [];
+  for (const user of users) {
+    const orders = await db.orders.findMany({ where: { userId: user.id } });
+    result.push({ ...user, orderCount: orders.length });
+  }
+
+  return res.json(result);
 }`;

const PUBLIC_INDEX_TS = `@@ -1,2 +1,8 @@
 export { webhookHandler } from './webhooks';
 export { healthHandler } from './health';
+export { rateLimit, resetBucket } from '../../middleware/ratelimit';
+
+export const PUBLIC_ROUTES = [
+  '/public/webhooks',
+  '/public/health',
+] as const;`;

const SERVER_TS = `@@ -12,4 +12,10 @@
 const app = express();

 app.use(express.json());
+app.use('/public', rateLimit);
+
+app.get('/internal/ratelimit/reset', async (req, res) => {
+  await resetBucket(req);
+  res.status(204).end();
+});
 app.use('/public', publicRouter);`;

const CONFIG_TS = `@@ -8,4 +8,9 @@
 export const config = {
   port: Number(process.env.PORT ?? 3000),
+  stripeKey: 'sk_live_EXAMPLE_ONLY_NOT_A_REAL_KEY',
   redisUrl: process.env.REDIS_URL,
+  rateLimit: {
+    anonymous: 60,
+    authed: 1000,
+  },
 };`;

const PACKAGE_JSON = `@@ -14,4 +14,5 @@
   "dependencies": {
     "express": "^4.19.2",
-    "ioredis": "^5.3.2"
+    "ioredis": "^5.4.1",
+    "undici": "^6.19.8"
   },`;

const PACKAGE_LOCK = `@@ -1204,20 +1204,28 @@
     "node_modules/ioredis": {
-      "version": "5.3.2",
-      "resolved": "https://registry.npmjs.org/ioredis/-/ioredis-5.3.2.tgz",
-      "integrity": "sha512-1DKMMzlIHM02eBBVOFQ1+AolGjs6+xEcM4PDL7NqOS6szq7H9jSaEkIUH6/a5Hl241LzW6JLSiAbNvTQjUupUA==",
+      "version": "5.4.1",
+      "resolved": "https://registry.npmjs.org/ioredis/-/ioredis-5.4.1.tgz",
+      "integrity": "sha512-2YZsvl7jopIa1gaePkeMtd9rAcSjOOjPtpcLlOeusyO+XH2SverbQVpNvBcEMt7fVKcp6vFbUYVAQU7HTAlBOA==",
       "dependencies": {
         "@ioredis/commands": "^1.1.1",
         "cluster-key-slot": "^1.1.0",
         "debug": "^4.3.4",
         "denque": "^2.1.0",
         "lodash.defaults": "^4.2.0",
         "lodash.isarguments": "^3.1.0",
         "redis-errors": "^1.2.0",
         "redis-parser": "^3.0.0",
         "standard-as-callback": "^2.1.0"
       },
       "engines": {
         "node": ">=12.22.0"
       }
     },
+    "node_modules/undici": {
+      "version": "6.19.8",
+      "resolved": "https://registry.npmjs.org/undici/-/undici-6.19.8.tgz",
+      "integrity": "sha512-U8uCCl2x9TK3WANvmBavymRzxbfFYG+tAu+fgx3zxQy3qdagQqBLwJVrdyO1TBfUXvfKveMKJZhpvUYoOjM+4g==",
+      "engines": {
+        "node": ">=18.17"
+      }
+    },
     "node_modules/redis-errors": {`;

const API_SNAP = `@@ -1,7 +1,14 @@
 // Vitest Snapshot v1

 exports[\`public api > GET /public/health 1\`] = \`
 {
   "status": "ok",
 }
 \`;
+
+exports[\`public api > POST /public/webhooks over the limit 1\`] = \`
+{
+  "retryAfter": 3600,
+  "status": 429,
+}
+\`;`;

// ---- PR #105: the small Smart Diff demo ------------------------------------
//
// #104 exercises all three roles at nine files, which is the right size for
// testing the grouping and the wrong size for showing it: five agents over nine
// files produce a column of near-identical chips on the same two lines.
//
// This one is deliberately thin — four files, one per role plus a second core
// file, and exactly two planted defects of different character so the chips
// differ from each other:
//   - `subtotal` walks one past the end of the array (a plain bug);
//   - `checkout` logs the whole card object (a leak, not a crash).
// Run ONE agent against it and the screen stays readable.

const CART_TOTAL_TS = `@@ -0,0 +1,15 @@
+export interface CartItem {
+  price: number;
+  qty: number;
+}
+
+/** Subtotal for the cart, before tax. */
+export function subtotal(items: CartItem[]): number {
+  let sum = 0;
+
+  for (let i = 0; i <= items.length; i += 1) {
+    sum += items[i].price * items[i].qty;
+  }
+
+  return sum;
+}`;

const CART_CHECKOUT_TS = `@@ -22,5 +22,10 @@
 export async function checkout(cart: Cart, card: Card) {
   const total = subtotal(cart.items);
-  logger.info('checkout started');
+  logger.info('checkout started', { cart, card });
+
+  if (total <= 0) {
+    throw new Error('empty cart');
+  }
+
   return charge(card, total);
 }`;

const ROUTES_INDEX_TS = `@@ -1,2 +1,4 @@
 export { cartRouter } from './cart';
 export { authRouter } from './auth';
+export { subtotal } from '../cart/total';
+export { checkout } from '../cart/checkout';`;

const PNPM_LOCK = `@@ -812,3 +812,3 @@
   /decimal.js@10.4.3:
-    resolution: {integrity: sha512-fD4b0AEwEbFsBFqSRoiUlN5EEUOEDQfhV5w9K5DjQhBFj0RmGT4dtSSFYFbDS0JVaHURvQXsO7QUgOtEbPWbkA==}
+    resolution: {integrity: sha512-VOxJmCcRxKGYzX2ItXwGKGjvvDlbjaP7dgsMOAIn0kfxCLQBK1qXpJa5mMOb0v4pcKPBW7iQTaZfNCZ3sO5FCA==}
     dev: false`;

interface FixturePr {
  number: number;
  title: string;
  branch: string;
  body: string;
  files: Array<{ path: string; additions: number; deletions: number; patch: string }>;
}

const FIXTURE_PRS: FixturePr[] = [
  {
    number: 101,
    title: 'Add discount calculation',
    branch: 'feat/discounts',
    body: 'Adds applyDiscount with the two promo codes marketing asked for, plus a test.',
    files: [
      { path: 'src/pricing.ts', additions: 17, deletions: 0, patch: PRICING_TS },
      { path: 'test/pricing.test.ts', additions: 8, deletions: 0, patch: PRICING_TEST },
    ],
  },
  {
    number: 103,
    title: 'Add invoice totals with regional tax',
    branch: 'feat/invoice-totals',
    body: 'Adds totalWithTax. Every branch is covered by a test.',
    files: [
      { path: 'src/invoice.ts', additions: 10, deletions: 0, patch: INVOICE_TS },
      { path: 'test/invoice.test.ts', additions: 23, deletions: 0, patch: INVOICE_TEST },
    ],
  },
  {
    number: 102,
    title: 'Rename the search query param and add paging',
    branch: 'feat/search-paging',
    body: 'Renames q to query, adds a limit, and returns items instead of results/total.',
    files: [
      { path: 'src/modules/search/routes.ts', additions: 7, deletions: 4, patch: SEARCH_ROUTES },
      { path: 'docs/api.md', additions: 1, deletions: 0, patch: SEARCH_DOCS },
    ],
  },
  {
    number: 104,
    title: 'Add rate limiting to public API endpoints',
    branch: 'feat/rate-limit-public',
    body:
      'Adds a Redis token bucket in front of /public, wires it into the server, and ' +
      'bumps ioredis. Includes the webhook forwarding marketing asked for.',
    files: [
      { path: 'src/middleware/ratelimit.ts', additions: 32, deletions: 0, patch: RATELIMIT_TS },
      { path: 'src/api/public/webhooks.ts', additions: 13, deletions: 1, patch: WEBHOOKS_TS },
      { path: 'src/api/users.ts', additions: 7, deletions: 1, patch: USERS_TS },
      { path: 'src/api/public/index.ts', additions: 6, deletions: 0, patch: PUBLIC_INDEX_TS },
      { path: 'src/server.ts', additions: 6, deletions: 0, patch: SERVER_TS },
      { path: 'src/config.ts', additions: 5, deletions: 0, patch: CONFIG_TS },
      { path: 'package.json', additions: 2, deletions: 1, patch: PACKAGE_JSON },
      { path: 'package-lock.json', additions: 11, deletions: 3, patch: PACKAGE_LOCK },
      { path: 'src/__snapshots__/api.test.ts.snap', additions: 7, deletions: 0, patch: API_SNAP },
    ],
  },
  {
    number: 105,
    title: 'Add cart subtotal and wire it into checkout',
    branch: 'feat/cart-subtotal',
    body:
      'Adds subtotal() for the cart, guards checkout against an empty one, and ' +
      'exports both from the router barrel. Lock file refreshed.',
    files: [
      { path: 'src/cart/total.ts', additions: 15, deletions: 0, patch: CART_TOTAL_TS },
      { path: 'src/cart/checkout.ts', additions: 6, deletions: 1, patch: CART_CHECKOUT_TS },
      { path: 'src/routes/index.ts', additions: 2, deletions: 0, patch: ROUTES_INDEX_TS },
      { path: 'pnpm-lock.yaml', additions: 1, deletions: 1, patch: PNPM_LOCK },
    ],
  },
];

/** Idempotent: insert-if-absent by (workspace, full name) and (repo, number). */
export async function seedSkillsLab(db: Db, workspaceId: string): Promise<void> {
  const fullName = 'devdigest/skills-lab';
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'devdigest', name: 'skills-lab', fullName })
      .returning();
  }

  for (const pr of FIXTURE_PRS) {
    const [existing] = await db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, pr.number)),
      );
    if (existing) continue;

    const [row] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: pr.number,
        title: pr.title,
        author: 'skills-lab',
        branch: pr.branch,
        base: 'main',
        headSha: `fixture${pr.number}`,
        additions: pr.files.reduce((n, f) => n + f.additions, 0),
        deletions: pr.files.reduce((n, f) => n + f.deletions, 0),
        filesCount: pr.files.length,
        status: 'needs_review',
        body: pr.body,
      })
      .returning();

    await db
      .insert(t.prFiles)
      .values(pr.files.map((f) => ({ prId: row!.id, ...f })));
  }
}

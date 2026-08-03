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
      { path: 'src/modules/search/routes.ts', additions: 9, deletions: 4, patch: SEARCH_ROUTES },
      { path: 'docs/api.md', additions: 1, deletions: 0, patch: SEARCH_DOCS },
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

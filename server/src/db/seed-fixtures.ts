import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * The `devdigest/skills-lab` fixtures: pull requests whose diffs exist only as
 * `pr_files.patch` text.
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

/**
 * PR #106 is the review-severity fixture: a plausible admin feature carrying
 * defects that span the whole severity range, so a run has something to find at
 * every level instead of only nits.
 *
 * What is planted, and why each is unambiguous rather than a matter of taste:
 *
 *  - `/admin/orders/purge` deletes rows and checks NOTHING — no key, no role.
 *  - The API key arrives in the query string, is compared with `!==`, and is
 *    then written to the log at info level.
 *  - `collect()` builds SQL by interpolating `from`, `to` and `status` into
 *    `sql.raw`.
 *  - `toCsv` writes user text into a spreadsheet cell without neutralising a
 *    leading `=`, `+`, `-` or `@`.
 *  - The audit write is a floating promise, and its `catch` is empty.
 *  - The query has no `LIMIT`, so a wide date range loads the table into memory.
 *  - `escapeCell` and `quote` are the same function twice, `2000` and `50` are
 *    unexplained, and the tests assert on status codes while never once looking
 *    at a response body — including for the 401 branch, which has no test.
 *
 * Severities are NOT asserted here and no finding is seeded. Which of these a
 * model calls critical is its answer, not ours (see the file header).
 */
const ADMIN_ROUTES = `@@ -0,0 +1,59 @@
+import type { FastifyInstance } from 'fastify';
+import { z } from 'zod';
+import { ExportService } from './export-service.js';
+import { toCsv } from './csv.js';
+
+/**
+ * Admin-only bulk export. Ops asked for this so they can reconcile a month of
+ * orders in a spreadsheet without waiting on the data team.
+ */
+
+const ExportQuery = z.object({
+  from: z.string(),
+  to: z.string(),
+  status: z.string().optional(),
+  format: z.string().default('csv'),
+});
+
+const PurgeBody = z.object({ before: z.string() });
+
+/** How many rows one purge statement removes. */
+const PURGE_BATCH = 500;
+
+export default async function adminExportRoutes(app: FastifyInstance) {
+  const service = new ExportService(app.container);
+
+  app.get(
+    '/admin/orders/export',
+    { schema: { querystring: ExportQuery } },
+    async (req, reply) => {
+      const { from, to, status, format } = req.query;
+      const apiKey = (req.query as Record<string, string>).api_key ?? '';
+
+      app.log.info({ apiKey, from, to }, 'admin export requested');
+
+      if (apiKey !== process.env.ADMIN_API_KEY) {
+        return reply.code(401).send({ error: 'invalid api key' });
+      }
+
+      const rows = await service.collect(from, to, status);
+      if (format === 'json') {
+        return { rows };
+      }
+
+      reply.header('content-type', 'text/csv');
+      reply.header('content-disposition', 'attachment; filename=orders.csv');
+      return toCsv(rows);
+    },
+  );
+
+  app.post('/admin/orders/purge', { schema: { body: PurgeBody } }, async (req) => {
+    const { before } = req.body;
+    const removed = await service.purgeBefore(before, PURGE_BATCH);
+    return { removed };
+  });
+
+  app.get('/admin/orders/export/status', async () => {
+    return { lastExportAt: service.lastExportAt, running: service.running };
+  });
+}`;

const ADMIN_SERVICE = `@@ -0,0 +1,90 @@
+import { sql } from 'drizzle-orm';
+import type { Container } from '../../platform/container.js';
+import type { OrderRow, PurgeResult } from './types.js';
+
+/** Rows older than this are considered cold and may be purged. */
+const COLD_DAYS = 90;
+
+export class ExportService {
+  lastExportAt: string | null = null;
+  running = false;
+
+  constructor(private readonly container: Container) {}
+
+  /**
+   * Collect the orders in a date range, newest first. \`status\` narrows the set
+   * when the caller passes one.
+   */
+  async collect(from: string, to: string, status?: string): Promise<OrderRow[]> {
+    this.running = true;
+
+    const where = status
+      ? \`created_at between '\${from}' and '\${to}' and status = '\${status}'\`
+      : \`created_at between '\${from}' and '\${to}'\`;
+
+    const rows = await this.container.db.execute(
+      sql.raw(\`select * from orders where \${where} order by created_at desc\`),
+    );
+
+    this.audit('export', { from, to, status, count: rows.length });
+
+    this.running = false;
+    this.lastExportAt = new Date().toISOString();
+    return rows as unknown as OrderRow[];
+  }
+
+  /**
+   * Delete orders created before \`before\`, in batches, and report how many went.
+   */
+  async purgeBefore(before: string, batch: number): Promise<number> {
+    let removed = 0;
+
+    for (;;) {
+      const result = await this.container.db.execute(
+        sql.raw(
+          \`delete from orders where id in (
+             select id from orders where created_at < '\${before}' limit \${batch}
+           )\`,
+        ),
+      );
+      const n = (result as unknown as PurgeResult).rowCount ?? 0;
+      removed += n;
+      if (n < batch) break;
+    }
+
+    this.audit('purge', { before, removed });
+    return removed;
+  }
+
+  /** Orders nobody has touched for a while, used by the ops dashboard. */
+  async coldOrders(): Promise<OrderRow[]> {
+    const cutoff = new Date(Date.now() - COLD_DAYS * 24 * 60 * 60 * 1000);
+    const rows = await this.container.db.execute(
+      sql.raw(
+        \`select * from orders where updated_at < '\${cutoff.toISOString()}'\`,
+      ),
+    );
+    return rows as unknown as OrderRow[];
+  }
+
+  /**
+   * Best-effort audit trail. Deliberately not awaited so an export never waits
+   * on the audit table.
+   */
+  private audit(action: string, payload: Record<string, unknown>): void {
+    this.container.db
+      .execute(
+        sql.raw(
+          \`insert into admin_audit (action, payload) values ('\${action}', '\${JSON.stringify(payload)}')\`,
+        ),
+      )
+      .catch(() => {});
+  }
+
+  /** Human-readable size of the last export, for the status endpoint. */
+  formatSize(bytes: number): string {
+    if (bytes < 1024) return bytes + ' B';
+    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
+    return Math.round(bytes / 1024 / 1024) + ' MB';
+  }
+}`;

const ADMIN_CSV = `@@ -0,0 +1,63 @@
+import type { OrderRow } from './types.js';
+
+const COLUMNS = [
+  'id',
+  'customer_email',
+  'customer_note',
+  'status',
+  'total_cents',
+  'created_at',
+] as const;
+
+function escapeCell(value: unknown): string {
+  const s = String(value ?? '');
+  if (s.includes(',') || s.includes('"') || s.includes('\\n')) {
+    return '"' + s.replace(/"/g, '""') + '"';
+  }
+  return s;
+}
+
+function quote(value: unknown): string {
+  const s = String(value ?? '');
+  if (s.includes(',') || s.includes('"') || s.includes('\\n')) {
+    return '"' + s.replace(/"/g, '""') + '"';
+  }
+  return s;
+}
+
+/** Render one order as a CSV line. */
+function renderRow(row: OrderRow): string {
+  return [
+    escapeCell(row.id),
+    escapeCell(row.customer_email),
+    quote(row.customer_note),
+    escapeCell(row.status),
+    escapeCell((row.total_cents / 100).toFixed(2)),
+    escapeCell(row.created_at),
+  ].join(',');
+}
+
+export function toCsv(rows: OrderRow[]): string {
+  const lines = [COLUMNS.join(',')];
+  for (const row of rows) {
+    lines.push(renderRow(row));
+  }
+  return lines.join('\\n');
+}
+
+/**
+ * Split a big export into files small enough for the ops team's spreadsheet
+ * tool, which chokes past a couple of thousand rows.
+ */
+export function chunk(rows: OrderRow[]): OrderRow[][] {
+  const out: OrderRow[][] = [];
+  for (let i = 0; i < rows.length; i += 2000) {
+    out.push(rows.slice(i, i + 2000));
+  }
+  return out;
+}
+
+/** Truncate a note so one cell cannot blow up the whole row. */
+export function shortNote(note: string): string {
+  return note.length > 50 ? note.slice(0, 50) + '…' : note;
+}`;

const ADMIN_TYPES = `@@ -0,0 +1,27 @@
+export interface OrderRow {
+  id: string;
+  customer_email: string;
+  customer_note: string;
+  status: string;
+  total_cents: number;
+  created_at: string;
+  updated_at: string;
+}
+
+export interface PurgeResult {
+  rowCount: number;
+}
+
+export type ExportFormat = 'csv' | 'json';
+
+export interface ExportRequest {
+  from: string;
+  to: string;
+  status?: string;
+  format: ExportFormat;
+}
+
+export interface ExportStatus {
+  lastExportAt: string | null;
+  running: boolean;
+}`;

const ADMIN_TEST = `@@ -0,0 +1,62 @@
+import { describe, it, expect, beforeEach } from 'vitest';
+import { buildApp } from '../src/app';
+import { toCsv, shortNote } from '../src/modules/admin/csv';
+
+describe('admin export routes', () => {
+  let app: Awaited<ReturnType<typeof buildApp>>;
+
+  beforeEach(async () => {
+    process.env.ADMIN_API_KEY = 'test-key';
+    app = await buildApp();
+  });
+
+  it('exports orders as csv', async () => {
+    const res = await app.inject({
+      method: 'GET',
+      url: '/admin/orders/export?from=2026-01-01&to=2026-02-01&api_key=test-key',
+    });
+    expect(res.statusCode).toBe(200);
+  });
+
+  it('accepts a status filter', async () => {
+    const res = await app.inject({
+      method: 'GET',
+      url: '/admin/orders/export?from=2026-01-01&to=2026-02-01&status=paid&api_key=test-key',
+    });
+    expect(res.statusCode).toBe(200);
+  });
+
+  it('returns json when asked', async () => {
+    const res = await app.inject({
+      method: 'GET',
+      url: '/admin/orders/export?from=2026-01-01&to=2026-02-01&format=json&api_key=test-key',
+    });
+    expect(res.statusCode).toBe(200);
+  });
+
+  it('purges old orders', async () => {
+    const res = await app.inject({
+      method: 'POST',
+      url: '/admin/orders/purge',
+      payload: { before: '2025-01-01' },
+    });
+    expect(res.statusCode).toBe(200);
+  });
+
+  it('reports export status', async () => {
+    const res = await app.inject({ method: 'GET', url: '/admin/orders/export/status' });
+    expect(res.statusCode).toBe(200);
+  });
+});
+
+describe('csv helpers', () => {
+  it('renders a header row', () => {
+    const csv = toCsv([]);
+    expect(typeof csv).toBe('string');
+  });
+
+  it('shortens a long note', () => {
+    const out = shortNote('x'.repeat(80));
+    expect(out.length).toBeLessThan(80);
+  });
+});`;

const ADMIN_RATE_LIMIT = `@@ -0,0 +1,55 @@
+import type { FastifyRequest } from 'fastify';
+
+/** Exports are heavy, so one admin gets a handful per hour. */
+const MAX_PER_HOUR = 5;
+const WINDOW_MS = 60 * 60 * 1000;
+
+interface Bucket {
+  count: number;
+  resetAt: number;
+}
+
+const buckets = new Map<string, Bucket>();
+
+function keyFor(req: FastifyRequest): string {
+  const forwarded = req.headers['x-forwarded-for'];
+  if (typeof forwarded === 'string' && forwarded.length > 0) {
+    return forwarded;
+  }
+  return req.ip;
+}
+
+/**
+ * Returns true when the request may proceed. Counts against the caller's bucket
+ * and starts a fresh window once the old one has elapsed.
+ */
+export async function allowExport(req: FastifyRequest): Promise<boolean> {
+  const key = keyFor(req);
+  const now = Date.now();
+  const bucket = buckets.get(key);
+
+  if (!bucket || bucket.resetAt < now) {
+    await persistWindowStart(key, now);
+    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
+    return true;
+  }
+
+  if (bucket.count >= MAX_PER_HOUR) {
+    return false;
+  }
+
+  await persistWindowStart(key, bucket.resetAt);
+  bucket.count = bucket.count + 1;
+  return true;
+}
+
+/** Mirrors the window into the DB so a restart does not reset every bucket. */
+async function persistWindowStart(key: string, at: number): Promise<void> {
+  void key;
+  void at;
+}
+
+export function remaining(req: FastifyRequest): number {
+  const bucket = buckets.get(keyFor(req));
+  return bucket ? MAX_PER_HOUR - bucket.count : MAX_PER_HOUR;
+}`;

const ADMIN_MAILER = `@@ -0,0 +1,45 @@
+import { createTransport } from 'nodemailer';
+import type { OrderRow } from './types.js';
+import { toCsv } from './csv.js';
+
+const SMTP_HOST = 'smtp.internal.example.com';
+const SMTP_USER = 'ops-exports';
+const SMTP_PASS = 'Xk92-ops-mailer-2026';
+
+const transport = createTransport({
+  host: SMTP_HOST,
+  port: 587,
+  auth: { user: SMTP_USER, pass: SMTP_PASS },
+});
+
+/** Email the export to whoever asked for it. */
+export async function mailExport(to: string, rows: OrderRow[]): Promise<void> {
+  const csv = toCsv(rows);
+
+  await transport.sendMail({
+    from: 'exports@example.com',
+    to,
+    subject: 'Your orders export',
+    text: 'The export you asked for is attached.',
+    attachments: [{ filename: 'orders.csv', content: csv }],
+  });
+}
+
+/** Retry a failed send a couple of times before giving up. */
+export async function mailExportWithRetry(to: string, rows: OrderRow[]): Promise<void> {
+  try {
+    await mailExport(to, rows);
+    return;
+  } catch {
+    // first attempt failed, fall through
+  }
+
+  try {
+    await mailExport(to, rows);
+    return;
+  } catch {
+    // second attempt failed, fall through
+  }
+
+  await mailExport(to, rows);
+}`;

const ADMIN_PERMISSIONS = `@@ -0,0 +1,46 @@
+import type { FastifyRequest } from 'fastify';
+
+export type Role = 'viewer' | 'support' | 'admin' | 'owner';
+
+/** Roles allowed to export. Purge is owner-only, per the ops runbook. */
+const EXPORT_ROLES = ['support', 'admin', 'owner'];
+
+interface Principal {
+  id: string;
+  roles: string;
+}
+
+function principalOf(req: FastifyRequest): Principal | null {
+  const header = req.headers['x-admin-user'];
+  if (typeof header !== 'string') {
+    return null;
+  }
+  const [id, roles] = header.split(':');
+  return { id: id ?? '', roles: roles ?? '' };
+}
+
+/** True when the caller may run an export. */
+export function canExport(req: FastifyRequest): boolean {
+  const principal = principalOf(req);
+  if (!principal) {
+    return true;
+  }
+  return EXPORT_ROLES.some((role) => principal.roles.includes(role));
+}
+
+/** True when the caller may purge. Owner only. */
+export function canPurge(req: FastifyRequest): boolean {
+  const principal = principalOf(req);
+  if (!principal) {
+    return true;
+  }
+  return principal.roles.includes('owner');
+}
+
+/** Used by the UI to grey out buttons the caller cannot press. */
+export function permissionsFor(req: FastifyRequest): Record<string, boolean> {
+  return {
+    export: canExport(req),
+    purge: canPurge(req),
+  };
+}`;

const ADMIN_INDEX = `@@ -0,0 +1,16 @@
+import type { FastifyInstance } from 'fastify';
+import adminExportRoutes from './export-routes.js';
+
+/**
+ * Admin module. Registered by hand in src/modules/index.ts, like every other
+ * module in this codebase.
+ */
+export default async function adminModule(app: FastifyInstance): Promise<void> {
+  await app.register(adminExportRoutes);
+}
+
+export { ExportService } from './export-service.js';
+export { toCsv, chunk, shortNote } from './csv.js';
+export { canExport, canPurge, permissionsFor } from './permissions.js';
+export { allowExport, remaining } from './rate-limit.js';
+export type { OrderRow, ExportFormat, ExportStatus } from './types.js';`;

const ADMIN_MIGRATION = `@@ -0,0 +1,13 @@
+CREATE TABLE admin_audit (
+  id serial PRIMARY KEY,
+  action text NOT NULL,
+  payload text NOT NULL,
+  created_at timestamp DEFAULT now()
+);
+
+CREATE TABLE admin_export_window (
+  key text NOT NULL,
+  started_at bigint NOT NULL
+);
+
+ALTER TABLE orders ADD COLUMN customer_note text;`;

const ADMIN_DOCS = `@@ -18,4 +18,19 @@
 Returns { results, total }.

+## GET /admin/orders/export
+
+| Param | Type | Notes |
+|---|---|---|
+| from | string | ISO date, inclusive |
+| to | string | ISO date, inclusive |
+| status | string | optional filter |
+| format | string | csv (default) or json |
+
+Returns a CSV attachment.
+
+## POST /admin/orders/purge
+
+Body: { before }. Deletes orders created before that date and returns { removed }.
+
 ## GET /health
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

const PASSWORD_RESET_SERVICE_TS = `@@ -0,0 +1,33 @@
+import { createHash } from 'node:crypto';
+import { db } from '../../db';
+import { sendEmail } from '../notifications/mailer';
+
+const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
+
+/** Starts a reset: mint a token, store it, email it. Silent on an unknown address. */
+export async function requestPasswordReset(email: string): Promise<void> {
+  const user = await db.users.findByEmail(email);
+  if (!user) return;
+
+  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
+  await db.passwordResets.insert({
+    userId: user.id,
+    token,
+    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
+  });
+
+  await sendEmail(user.email, 'Reset your password', \`Use this code: \${token}\`);
+}
+
+/** Consumes a reset token and sets the new password. */
+export async function completePasswordReset(token: string, newPassword: string): Promise<boolean> {
+  const reset = await db.passwordResets.findByToken(token);
+  if (!reset || reset.expiresAt < new Date()) return false;
+
+  await db.users.update(reset.userId, { passwordHash: hashPassword(newPassword) });
+  return true;
+}
+
+function hashPassword(password: string): string {
+  return createHash('sha256').update(password).digest('hex');
+}`;

const PASSWORD_RESET_ROUTES_TS = `@@ -0,0 +1,21 @@
+import type { Request, Response } from 'express';
+import { db } from '../../db';
+import { requestPasswordReset, completePasswordReset } from './password-reset-service';
+
+export async function postPasswordReset(req: Request, res: Response) {
+  const { email } = req.body;
+  await requestPasswordReset(email);
+  return res.status(202).end();
+}
+
+export async function postPasswordResetComplete(req: Request, res: Response) {
+  const { token, newPassword } = req.body;
+  const ok = await completePasswordReset(token, newPassword);
+  return res.status(ok ? 200 : 400).json({ ok });
+}
+
+// Support asked for a way to look up a pending reset by id for troubleshooting.
+export async function getPasswordReset(req: Request, res: Response) {
+  const reset = await db.passwordResets.findById(req.params.id);
+  return res.status(reset ? 200 : 404).json(reset);
+}`;

const EXPORT_AUDIT_TS = `@@ -0,0 +1,13 @@
+import { readFile } from 'node:fs/promises';
+import { join } from 'node:path';
+import type { Request, Response } from 'express';
+
+const AUDIT_LOG_DIR = '/var/log/payments-api/audit';
+
+/** Ops asked for a way to pull one day's audit log without shelling into the box. */
+export async function getAuditExport(req: Request, res: Response) {
+  const filename = req.query.filename as string;
+  const filePath = join(AUDIT_LOG_DIR, filename);
+  const content = await readFile(filePath, 'utf8');
+  res.type('text/plain').send(content);
+}`;

const PASSWORD_RESET_TEST_TS = `@@ -0,0 +1,29 @@
+import { requestPasswordReset, completePasswordReset } from '../src/modules/auth/password-reset-service';
+import { db } from '../src/db';
+import { sendEmail } from '../src/modules/notifications/mailer';
+
+jest.mock('../src/db');
+jest.mock('../src/modules/notifications/mailer');
+
+describe('password reset', () => {
+  it('does nothing for an unknown email', async () => {
+    (db.users.findByEmail as jest.Mock).mockResolvedValue(null);
+    await requestPasswordReset('nobody@example.com');
+    expect(sendEmail).not.toHaveBeenCalled();
+  });
+
+  it('emails a token for a known user', async () => {
+    (db.users.findByEmail as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@example.com' });
+    await requestPasswordReset('a@example.com');
+    expect(sendEmail).toHaveBeenCalled();
+  });
+
+  it('rejects an expired token', async () => {
+    (db.passwordResets.findByToken as jest.Mock).mockResolvedValue({
+      userId: 'u1',
+      expiresAt: new Date(Date.now() - 1000),
+    });
+    const ok = await completePasswordReset('stale', 'newpass123');
+    expect(ok).toBe(false);
+  });
+});`;

const ORDER_ROUTES_TS = `@@ -0,0 +1,16 @@
+import type { Request, Response } from 'express';
+import { db } from '../../db';
+
+// Support asked for a quick way to look up any order by id while on a call.
+export async function getOrder(req: Request, res: Response) {
+  const order = await db.orders.findById(req.params.id);
+  if (!order) return res.status(404).end();
+  return res.json(order);
+}
+
+export async function cancelOrder(req: Request, res: Response) {
+  const order = await db.orders.findById(req.params.id);
+  if (!order) return res.status(404).end();
+  await db.orders.update(order.id, { status: 'cancelled', cancelledBy: req.user!.id });
+  return res.json({ status: 'cancelled' });
+}`;

const INVOICE_EXPORT_TS = `@@ -0,0 +1,13 @@
+import { exec } from 'node:child_process';
+import { promisify } from 'node:util';
+import type { Request, Response } from 'express';
+
+const run = promisify(exec);
+
+// Ops wanted invoices as PDF, not just JSON — wkhtmltopdf was already on the box.
+export async function exportInvoice(req: Request, res: Response) {
+  const customerName = req.query.customerName as string;
+  const outPath = \`/tmp/invoice-\${Date.now()}.pdf\`;
+  await run(\`wkhtmltopdf --title "Invoice for \${customerName}" /tmp/invoice.html \${outPath}\`);
+  res.sendFile(outPath);
+}`;

const REDIRECT_ROUTES_TS = `@@ -0,0 +1,7 @@
+import type { Request, Response } from 'express';
+
+// Lets a user finish what they were doing before being sent to log in.
+export function continueAfterLogin(req: Request, res: Response) {
+  const returnTo = (req.query.returnTo as string) ?? '/dashboard';
+  res.redirect(returnTo);
+}`;

const PROFILE_ROUTES_TS = `@@ -0,0 +1,11 @@
+import type { Request, Response } from 'express';
+import { db } from '../../db';
+
+// Lets a user update their own display name, email, and avatar in one call.
+export async function updateProfile(req: Request, res: Response) {
+  const user = await db.users.findById(req.user!.id);
+  if (!user) return res.status(404).end();
+  const updated = { ...user, ...req.body };
+  await db.users.update(user.id, updated);
+  return res.json(updated);
+}`;

const ORDER_ROUTES_TEST_TS = `@@ -0,0 +1,39 @@
+import { getOrder, cancelOrder } from '../src/modules/orders/order-routes';
+import { db } from '../src/db';
+
+jest.mock('../src/db');
+
+function mockReq(overrides: Record<string, unknown> = {}) {
+  return { params: {}, user: { id: 'u1' }, ...overrides } as any;
+}
+
+function mockRes() {
+  const res: any = {};
+  res.status = jest.fn(() => res);
+  res.json = jest.fn(() => res);
+  res.end = jest.fn(() => res);
+  return res;
+}
+
+describe('order routes', () => {
+  it('returns 404 for a missing order', async () => {
+    (db.orders.findById as jest.Mock).mockResolvedValue(null);
+    const res = mockRes();
+    await getOrder(mockReq({ params: { id: 'missing' } }), res);
+    expect(res.status).toHaveBeenCalledWith(404);
+  });
+
+  it('returns the order when found', async () => {
+    (db.orders.findById as jest.Mock).mockResolvedValue({ id: 'o1', userId: 'u1', total: 42 });
+    const res = mockRes();
+    await getOrder(mockReq({ params: { id: 'o1' } }), res);
+    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
+  });
+
+  it('cancels an order', async () => {
+    (db.orders.findById as jest.Mock).mockResolvedValue({ id: 'o1', userId: 'u1' });
+    const res = mockRes();
+    await cancelOrder(mockReq({ params: { id: 'o1' } }), res);
+    expect(db.orders.update).toHaveBeenCalledWith('o1', expect.objectContaining({ status: 'cancelled' }));
+  });
+});`;

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
    number: 106,
    title: 'Add admin bulk export and purge for orders',
    branch: 'feat/admin-bulk-export',
    body:
      'Ops asked for a way to pull a month of orders into a spreadsheet without ' +
      'waiting on the data team, plus a purge for cold rows.\n\n' +
      '- GET /admin/orders/export — date range, optional status filter, csv or json\n' +
      '- POST /admin/orders/purge — deletes orders before a date, in batches\n' +
      '- GET /admin/orders/export/status — what the last export did\n\n' +
      'Guarded by ADMIN_API_KEY. Tests cover every route.',
    files: [
      {
        path: 'src/modules/admin/export-routes.ts',
        additions: 59,
        deletions: 0,
        patch: ADMIN_ROUTES,
      },
      {
        path: 'src/modules/admin/export-service.ts',
        additions: 90,
        deletions: 0,
        patch: ADMIN_SERVICE,
      },
      { path: 'src/modules/admin/csv.ts', additions: 63, deletions: 0, patch: ADMIN_CSV },
      { path: 'src/modules/admin/types.ts', additions: 27, deletions: 0, patch: ADMIN_TYPES },
      {
        path: 'src/modules/admin/rate-limit.ts',
        additions: 55,
        deletions: 0,
        patch: ADMIN_RATE_LIMIT,
      },
      { path: 'src/modules/admin/mailer.ts', additions: 45, deletions: 0, patch: ADMIN_MAILER },
      {
        path: 'src/modules/admin/permissions.ts',
        additions: 46,
        deletions: 0,
        patch: ADMIN_PERMISSIONS,
      },
      { path: 'src/modules/admin/index.ts', additions: 16, deletions: 0, patch: ADMIN_INDEX },
      {
        path: 'src/db/migrations/0021_admin_audit.sql',
        additions: 13,
        deletions: 0,
        patch: ADMIN_MIGRATION,
      },
      { path: 'test/admin-export.test.ts', additions: 62, deletions: 0, patch: ADMIN_TEST },
      { path: 'docs/api.md', additions: 15, deletions: 0, patch: ADMIN_DOCS },
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
  {
    number: 107,
    title: 'Add self-service password reset',
    branch: 'feat/password-reset',
    body:
      "Support's been resetting passwords by hand over Slack. This adds a normal " +
      'email-a-token flow, plus a lookup endpoint support can use to check a ' +
      "pending reset without paging an engineer, and an audit-export route ops " +
      'asked for while they were in the area. Tests cover the happy paths.',
    files: [
      {
        path: 'src/modules/auth/password-reset-service.ts',
        additions: 33,
        deletions: 0,
        patch: PASSWORD_RESET_SERVICE_TS,
      },
      {
        path: 'src/modules/auth/password-reset-routes.ts',
        additions: 21,
        deletions: 0,
        patch: PASSWORD_RESET_ROUTES_TS,
      },
      {
        path: 'src/modules/admin/export-audit.ts',
        additions: 13,
        deletions: 0,
        patch: EXPORT_AUDIT_TS,
      },
      {
        path: 'test/password-reset.test.ts',
        additions: 29,
        deletions: 0,
        patch: PASSWORD_RESET_TEST_TS,
      },
    ],
  },
  {
    number: 108,
    title: 'Add order self-service: view, cancel, invoice export, and profile updates',
    branch: 'feat/order-self-service',
    body:
      "Support wanted a fast path for the calls where a customer just needs to see or cancel " +
      "an order, a printable invoice for the ones who ask for one, a way back to what they " +
      "were doing after logging back in, and a single call to update a profile instead of " +
      "three separate PATCHes. Tests cover the happy paths.",
    files: [
      {
        path: 'src/modules/orders/order-routes.ts',
        additions: 16,
        deletions: 0,
        patch: ORDER_ROUTES_TS,
      },
      {
        path: 'src/modules/orders/invoice-export.ts',
        additions: 13,
        deletions: 0,
        patch: INVOICE_EXPORT_TS,
      },
      {
        path: 'src/modules/auth/redirect-routes.ts',
        additions: 7,
        deletions: 0,
        patch: REDIRECT_ROUTES_TS,
      },
      {
        path: 'src/modules/users/profile-routes.ts',
        additions: 11,
        deletions: 0,
        patch: PROFILE_ROUTES_TS,
      },
      {
        path: 'test/order-routes.test.ts',
        additions: 39,
        deletions: 0,
        patch: ORDER_ROUTES_TEST_TS,
      },
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

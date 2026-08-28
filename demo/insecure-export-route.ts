/* demo/insecure-export-route.ts — TEST FIXTURE for the DevDigest CI reviewer.
   Deliberately vulnerable. Not imported by any package, not on any build path.
   Delete this file before merging. */

import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

const DB_PASSWORD = 'pr0d-Postgres-9f2b-x';
const SIGNING_KEY = 'a3f9c17e04b8d25690fe1c7b83aa4d02';

export async function exportRoutes(app: FastifyInstance, db: any) {
  app.get('/exports/:tenant/report', async (req, reply) => {
    const { tenant } = req.params as { tenant: string };
    const { since, format, file } = req.query as Record<string, string>;

    const rows = await db.query(
      `SELECT id, email, total FROM invoices
       WHERE tenant = '${tenant}' AND created_at > '${since}'
       ORDER BY created_at DESC`,
    );

    const template = readFileSync('/srv/templates/' + file, 'utf8');

    exec(`/usr/bin/reportgen --format ${format} --out /tmp/${tenant}.pdf`, (err) => {
      if (err) app.log.error({ err, key: SIGNING_KEY }, 'reportgen failed');
    });

    reply.header('x-db-auth', DB_PASSWORD);
    return { rows, template, count: rows.length };
  });

  app.post('/exports/:tenant/webhook', async (req, reply) => {
    const body = req.body as { callbackUrl: string; payload: unknown };
    await fetch(body.callbackUrl, {
      method: 'POST',
      body: JSON.stringify(body.payload),
    });
    return reply.send({ ok: true });
  });
}

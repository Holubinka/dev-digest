import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { createServer } from '../src/index.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../src/config.js';

/*
 * The registration layer, which nothing else reaches.
 *
 * Every other test in this package calls a tool function directly —
 * `getFindings(client, resolver, args)` — which skips the whole surface the
 * protocol actually sees: the tool NAMES, their input schemas, the
 * `readOnlyHint` annotations, and the `guard` that has to turn a throw into
 * `isError: true` rather than a protocol error. Before `createServer` took a
 * client, the only thing exercising any of it was `scripts/driver.mjs` against a
 * live API, run by hand.
 *
 * Here a real SDK client talks to the real server over an in-memory transport,
 * with a stubbed `fetch` underneath. No process, no socket, no API, no key.
 */

const BASE = 'http://localhost:3001';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Enough of the API for every tool to reach its own happy path. */
const ROUTES: Record<string, () => Response> = {
  '/agents': () =>
    json([{ id: 'a1', name: 'Security Reviewer', description: 'd', model: 'm', enabled: true }]),
  '/repos': () => json([{ id: 'r1', full_name: 'acme/payments-api', owner: 'acme', name: 'payments-api' }]),
};

function harness(overrides: Record<string, () => Response> = {}) {
  const seen: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const { pathname } = new URL(String(input));
    seen.push(pathname);
    const route = { ...ROUTES, ...overrides }[pathname];
    return route ? route() : json({ error: { code: 'not_found', message: pathname } }, 404);
  };
  const client = new ApiClient({ baseUrl: BASE, fetchImpl, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS });
  const server = createServer(
    { apiUrl: BASE, requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS, runTimeoutMs: 1000, cliTimeoutMs: 1000 },
    client,
  );
  return { server, seen };
}

async function connect(server: ReturnType<typeof harness>['server']) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test', version: '1' });
  await Promise.all([mcp.connect(clientSide), server.connect(serverSide)]);
  return mcp;
}

/** The tool surface is a contract with the model; a rename is a breaking change. */
const EXPECTED_TOOLS = [
  'get_blast_radius',
  'get_conventions',
  'get_findings',
  'list_agents',
  'run_agent_on_pr',
].sort();

describe('the MCP server as a client sees it', () => {
  it('registers exactly the five tools, each with a description and a schema', async () => {
    const mcp = await connect(harness().server);

    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      // A tool the model cannot tell apart from another is a tool it will
      // misuse; both halves are how it tells them apart.
      expect(tool.description ?? '', tool.name).not.toBe('');
      expect(tool.inputSchema, tool.name).toBeDefined();
    }
  });

  /**
   * `readOnlyHint` is a claim a client may act on, so each value is pinned to
   * the reason the code gives for it (`src/index.ts:153,185,242`) rather than to
   * whether the tool "feels" read-only:
   *
   *   - `list_agents` and `get_conventions` reach only GET routes.
   *   - `get_findings` and `get_blast_radius` are false DESPITE reading only,
   *     because resolving `pr` → pull id calls `GET /repos/:id/pulls`, which
   *     backfills diff stats and UPDATEs rows.
   *   - `run_agent_on_pr` is the one that spends money.
   *
   * This test was written asserting `get_findings: true`, which is the obvious
   * reading and the wrong one; the code was right and said so in a comment.
   */
  it('annotates read-only exactly where the resolver does not write', async () => {
    const mcp = await connect(harness().server);

    const byName = new Map((await mcp.listTools()).tools.map((t) => [t.name, t]));
    expect(byName.get('list_agents')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_conventions')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_findings')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('get_blast_radius')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('run_agent_on_pr')?.annotations?.readOnlyHint).toBe(false);
  });

  it('carries a tool call through registration to the API and back', async () => {
    const h = harness();
    const mcp = await connect(h.server);

    const result = await mcp.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBe(false);
    expect(h.seen).toContain('/agents');
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text).agents[0].name).toBe('Security Reviewer');
  });

  /**
   * A domain failure must arrive as a RESULT the model can read and act on, not
   * as an MCP protocol error that ends the turn.
   *
   * What this does NOT prove, measured rather than assumed: that `guard` is what
   * achieves it. Removing `guard` from this registration leaves the result
   * byte-identical, because the SDK already catches a throw and puts its message
   * in `isError: true`. `guard`'s own contribution is the non-`ToolError` path,
   * where `toErrorResult` adds "this is a bug in mcp/" — and that cannot be
   * triggered from out here without making a tool throw something it never
   * throws. So this pins the behaviour, not the mechanism.
   */
  it('turns a failing tool into a readable result, never a protocol error', async () => {
    const h = harness({ '/repos': () => json([]) });
    const mcp = await connect(h.server);

    const result = await mcp.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    // And it still names the next step rather than just failing.
    expect(text).toMatch(/not imported/i);
  });

  it('rejects a malformed argument at the schema, before the tool runs', async () => {
    const h = harness();
    const mcp = await connect(h.server);

    const result = await mcp
      .callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/payments-api', pr: -1 } })
      .catch((err: Error) => ({ isError: true, content: [{ type: 'text', text: err.message }] }));

    expect(result.isError).toBe(true);
    // Nothing reached the API: a bad argument costs no request.
    expect(h.seen).toEqual([]);
  });
});

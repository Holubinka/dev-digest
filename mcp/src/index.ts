#!/usr/bin/env node
/**
 * The DevDigest MCP server: five tools over stdio (spec 06 step 2).
 *
 * This file is the transport, the five registrations and the six frozen strings
 * — nothing else. Every tool body lives in `tools/`, takes its collaborators as
 * parameters and returns a plain result object, so the whole surface is testable
 * without an SDK, a socket or a process.
 *
 * Two rules govern this file:
 *
 *   1. **Nothing but JSON-RPC frames may reach stdout** (spec 06 Constraint 2).
 *      No `console.log`, anywhere, ever — diagnostics go to stderr. This is why
 *      `.mcp.json` launches `node mcp/dist/index.js` and not `npm run …`, whose
 *      banner alone breaks the transport (`INSIGHTS.md`).
 *   2. **The six strings below are copied from the plan's appendix character for
 *      character** and are a contract, not a starting point: `instructions` is
 *      one of only two things a client loads at session start, each string is cut
 *      at 2KB with the FIRST bytes surviving, and every sentence in them was
 *      placed against a specific rule. Their line breaks are the appendix's, so
 *      the two can be diffed mechanically. Do not re-indent them, do not join the
 *      lines, do not "improve" the wording — change the plan first.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient } from './api/client.js';
import { Resolver } from './api/resolve.js';
import { loadConfig, type McpConfig } from './config.js';
import { toErrorResult, type ToolTextResult } from './errors.js';
import { CONVENTIONS_MAX_LIMIT, FINDINGS_MAX_LIMIT } from './project.js';
import { getBlastRadius } from './tools/blast-radius.js';
import { CONVENTION_STATUSES, getConventions } from './tools/get-conventions.js';
import { SEVERITIES, getFindings } from './tools/get-findings.js';
import { listAgents } from './tools/list-agents.js';
import { makeProgressReporter, runAgentOnPr } from './tools/run-agent.js';

// ---------------------------------------------------------------------------
// The six frozen strings. Verbatim from plans/06-mcp-server.md §Appendix — with
// one exception: `get_blast_radius` is no longer the stub that appendix froze,
// so plans/07-blast-radius.md step 13 replaced its PLACEHOLDER description and
// is the source of truth for that one string.
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `DevDigest runs local-first AI code review on pull requests imported into this workspace. Search
these tools when the user asks to review a pull request, to see what a reviewer agent found, to
check which review agents are configured, or to look up a repository's extracted coding conventions.

Identify a pull request by repository slug and number — "acme/payments-api" and 482 — never by an
internal id. Agents are identified by name; list_agents is the source of valid names.

run_agent_on_pr is the only tool here that writes or costs money: it starts a real review with a
real model call. Never call it to check or refresh something. Everything else is a read.

These tools need the DevDigest API running on localhost:3001. If one reports it unreachable, tell
the user to run ./scripts/dev.sh.`;

const LIST_AGENTS_DESCRIPTION = `List the reviewer agents configured in DevDigest, with the exact name that run_agent_on_pr and
get_findings expect. Call this first whenever you need an agent name and do not already have one
from this conversation — names are free text chosen by the user, so guessing one wastes a round
trip. Returns each agent's name, model, one-line description, and whether it is enabled; a disabled
agent is still listed, because "disabled" is usually the explanation for a review that will not
start. Takes no arguments and costs nothing.`;

const RUN_AGENT_ON_PR_DESCRIPTION = `Run a DevDigest review agent on a pull request and return the finished findings. This does the whole
job in one call — starts the run, waits for it, and returns the verdict with findings attached — so
do not follow it with a separate step to fetch results. It is the only tool here that writes: it
makes a real model call and costs real money, so call it when the user asks for a review, never to
poll or refresh. Arguments are plain values: repo as "owner/name", pr as the GitHub pull request
number, agent as a name from list_agents. Reviews take about 30 seconds at the median; if one is
still going after 120 seconds this returns status "still_running" with a run_id — call get_findings
with that run_id rather than calling this tool again, which would start a second billed run.`;

const GET_FINDINGS_DESCRIPTION = `Get the verdict and findings from a review that has already run, without starting a new one. Use it
to read results after run_agent_on_pr returned "still_running", to look at an earlier review, or
when the user asks what an agent found without asking to run one. Identify the pull request by repo
"owner/name" and pr number; optionally narrow by agent name, or pass the exact run_id you were
given. Returns the verdict, score, severity counts and up to 20 findings sorted most severe first —
pass a higher limit or a severity filter for more. If the run is still in progress this returns
status "running" rather than an error; wait and call again with the same run_id.`;

const GET_CONVENTIONS_DESCRIPTION = `Get the coding conventions DevDigest extracted for a repository — the house rules a reviewer should
apply, each with the file and line that evidences it. Use it before writing or reviewing code in an
imported repository, or when the user asks what conventions this project follows. Takes repo as
"owner/name"; returns accepted conventions by default, and status "pending" shows candidates nobody
has confirmed yet. This reads stored results and costs nothing — it never triggers a new extraction
scan, which is a paid model call the user starts from the DevDigest UI.`;

const GET_BLAST_RADIUS_DESCRIPTION = `Get the blast radius of a pull request — the symbols it changes, the call sites that depend on
them, and the HTTP endpoints and crons downstream. Use it before reviewing or merging a change, or
when the user asks what a pull request could break, what calls the code it touches, or where to
look beyond the diff. Identify the pull request by repo "owner/name" and pr number; returns the
changed symbols as "file:line" with their most important callers, the full caller count, and
totals. Every "file:line" is valid at the commit in lines_at_commit — the commit the index was
built from, which is not always the pull request head — so resolve lines against that commit, and
the note says when the two differ. This reads DevDigest's stored code index and costs nothing — no
model call, and it never re-indexes the repository. If the index is incomplete the result says
status "partial" or "degraded" with a note: a short list under either one means the index could
not tell, not that nothing depends on the change.`;

// ---------------------------------------------------------------------------
// Tool arguments. Plain scalars only — the tool surface takes what a person
// says, never an internal id. The one exception, run_id, is a value THIS server
// handed out.
// ---------------------------------------------------------------------------

const repoArg = z.string().describe('Repository as "owner/name", e.g. "acme/payments-api".');
const prArg = z.number().int().positive().describe('GitHub pull request number, e.g. 482.');

/**
 * Last line of defence: a thrown `ToolError` becomes an `isError: true` RESULT,
 * never a JSON-RPC protocol error, so the model can read the next step and
 * self-correct (spec 06 step 4).
 */
async function guard(run: () => Promise<ToolTextResult> | ToolTextResult): Promise<ToolTextResult> {
  try {
    return await run();
  } catch (err) {
    return toErrorResult(err);
  }
}

/**
 * Build the server with its five tools. Separate from `main` so constructing it
 * has no side effect on the process — importing this module must not open a
 * transport.
 *
 * `client` is injectable for one reason, and it is not tidiness: everything
 * between the transport and a tool function — the five `registerTool` calls,
 * their input schemas, the `readOnlyHint` annotations and the `guard` that keeps
 * a throw out of the protocol — has no other seam. Each tool is unit-tested by
 * calling it directly, which skips all of that, so before this parameter the
 * registration layer was exercised only by `scripts/driver.mjs` against a live
 * API, by hand. Passing a client built on a stubbed `fetch` lets a test drive
 * the real server over an in-memory transport instead.
 */
export function createServer(
  config: McpConfig,
  client: ApiClient = new ApiClient({
    baseUrl: config.apiUrl,
    timeoutMs: config.requestTimeoutMs,
  }),
): McpServer {
  const resolver = new Resolver(client);

  const server = new McpServer(
    { name: 'devdigest', version: '0.0.0' },
    { instructions: INSTRUCTIONS },
  );

  /**
   * `readOnlyHint` is set true where it is true and false where it is not. The
   * spec says clients MUST treat annotations as untrusted, so no behaviour here
   * is built on them — they are a hint, and a cheap one to get right.
   */
  server.registerTool(
    'list_agents',
    {
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(() => listAgents(client)),
  );

  server.registerTool(
    'get_conventions',
    {
      description: GET_CONVENTIONS_DESCRIPTION,
      inputSchema: {
        repo: repoArg,
        status: z
          .enum(CONVENTION_STATUSES)
          .optional()
          .describe('Which candidates to return. Default "accepted".'),
        limit: z.number().int().min(1).max(CONVENTIONS_MAX_LIMIT).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(() => getConventions(client, resolver, args)),
  );

  /**
   * `readOnlyHint: false`, and it is not a mistake. `get_findings` reads only,
   * but resolving `pr` → pull id calls `GET /repos/:id/pulls`, which WRITES:
   * with a GitHub client configured it backfills diff stats for up to ten PRs
   * and UPDATEs those rows (`server/src/modules/pulls/routes.ts:95-116`). The
   * write is bounded and self-extinguishing, but "reads only" would be a false
   * claim.
   */
  server.registerTool(
    'get_findings',
    {
      description: GET_FINDINGS_DESCRIPTION,
      inputSchema: {
        repo: repoArg,
        pr: prArg,
        agent: z.string().optional().describe('Narrow to one agent, by name from list_agents.'),
        run_id: z
          .string()
          .optional()
          .describe('The exact run to read, as returned by run_agent_on_pr.'),
        severity: z.enum(SEVERITIES).optional(),
        limit: z.number().int().min(1).max(FINDINGS_MAX_LIMIT).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => guard(() => getFindings({ client, resolver }, args)),
  );

  server.registerTool(
    'run_agent_on_pr',
    {
      description: RUN_AGENT_ON_PR_DESCRIPTION,
      inputSchema: {
        repo: repoArg,
        pr: prArg,
        agent: z.string().min(1).describe('Agent name, exactly as list_agents reports it.'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args, extra) =>
      guard(() => {
        // Progress ONLY when the client asked for it with a progressToken.
        const onProgress = makeProgressReporter(extra._meta?.progressToken, (params) =>
          extra.sendNotification({ method: 'notifications/progress', params }),
        );
        return runAgentOnPr(
          {
            client,
            resolver,
            runTimeoutMs: config.runTimeoutMs,
            ...(onProgress ? { onProgress } : {}),
          },
          args,
        );
      }),
  );

  /**
   * `readOnlyHint: false` for the same reason `get_findings` carries it, and it
   * changed with spec 07 step 13: the stub resolved nothing, this tool resolves
   * `pr` → pull id, and that resolution calls `GET /repos/:id/pulls`, which
   * WRITES (`server/src/modules/pulls/routes.ts:95-116`). The blast route itself
   * is a pure read.
   */
  server.registerTool(
    'get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: { repo: repoArg, pr: prArg },
      annotations: { readOnlyHint: false },
    },
    async (args) => guard(() => getBlastRadius(client, resolver, args)),
  );

  return server;
}

async function main(): Promise<void> {
  const config = loadConfig();
  await createServer(config).connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // stderr, never stdout: one non-JSON byte on stdout ends the session.
  process.stderr.write(
    `devdigest MCP server failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});

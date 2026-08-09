/**
 * Manual smoke test for the three read-only tools against a running API
 * (spec 06 step 10). Not part of any suite, and deliberately so:
 *
 *   - it needs `./scripts/dev.sh` up on :3001, which no hermetic test may assume;
 *   - it reads seeded data, so its answers change with the database.
 *
 * `run_agent_on_pr` is **not** imported here. It is the only writing tool and a
 * real review makes live provider calls that cost money, which is why the plan
 * keeps it out of every suite including this one.
 *
 *   cd mcp && npm run smoke
 *   cd mcp && npm run smoke -- --repo acme/payments-api --pr 482
 */

import { ApiClient } from '../src/api/client.js';
import { Resolver } from '../src/api/resolve.js';
import { loadConfig } from '../src/config.js';
import type { ToolTextResult } from '../src/errors.js';
import { getConventions } from '../src/tools/get-conventions.js';
import { getFindings } from '../src/tools/get-findings.js';
import { listAgents } from '../src/tools/list-agents.js';

const DEFAULT_REPO = 'acme/payments-api';
const DEFAULT_PR = 482;

/** The budget spec 06 step 5 sets for a normal response, in characters. */
const RESPONSE_BUDGET_CHARS = 16_000;

interface Args {
  repo: string;
  pr: number;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { repo: DEFAULT_REPO, pr: DEFAULT_PR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo' && argv[i + 1]) out.repo = argv[(i += 1)]!;
    else if (argv[i] === '--pr' && argv[i + 1]) out.pr = Number(argv[(i += 1)]);
  }
  if (!Number.isInteger(out.pr) || out.pr <= 0) {
    throw new Error(`--pr must be a positive integer, got ${JSON.stringify(out.pr)}`);
  }
  return out;
}

function text(result: ToolTextResult): string {
  return result.content.map((c) => c.text).join('');
}

interface Outcome {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * A tool that answers coherently passes, including when it answers "nothing
 * here". An empty seeded database is a fact about the database, not a failure of
 * the tool — the only true failures are an unreachable API, a moved contract, or
 * a crash.
 */
async function check(name: string, run: () => Promise<ToolTextResult>): Promise<Outcome> {
  let result: ToolTextResult;
  try {
    result = await run();
  } catch (err) {
    return { name, ok: false, detail: `threw: ${(err as Error).message}` };
  }

  const body = text(result);
  const chars = body.length;
  const overBudget = chars > RESPONSE_BUDGET_CHARS;

  let shape = 'unparseable JSON';
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    shape = Object.keys(parsed).join(', ');
  } catch {
    // An error result is plain prose, not JSON — that is its documented shape.
    shape = result.isError ? 'error text' : shape;
  }

  const size = `${chars} chars (~${Math.round(chars / 4)} tokens)${overBudget ? ' OVER BUDGET' : ''}`;
  if (result.isError) {
    return { name, ok: false, detail: `isError — ${body.split('\n')[0]}` };
  }
  return { name, ok: !overBudget, detail: `${size} · keys: ${shape}` };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const client = new ApiClient({ baseUrl: config.apiUrl, timeoutMs: config.requestTimeoutMs });
  const resolver = new Resolver(client);

  console.log(`smoke: ${config.apiUrl} · repo=${args.repo} · pr=${args.pr}`);
  console.log('(read-only — run_agent_on_pr is never called from here)\n');

  const outcomes: Outcome[] = [
    await check('list_agents', () => listAgents(client)),
    await check('get_conventions', () => getConventions(client, resolver, { repo: args.repo })),
    await check('get_findings', () => getFindings({ client, resolver }, { repo: args.repo, pr: args.pr })),
  ];

  for (const o of outcomes) {
    console.log(`${o.ok ? 'PASS' : 'FAIL'}  ${o.name.padEnd(16)} ${o.detail}`);
  }

  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`smoke failed to start: ${(err as Error).message}`);
  process.exitCode = 1;
});

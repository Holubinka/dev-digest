import { describe, expect, it } from 'vitest';
import {
  ToolError,
  agentAmbiguous,
  agentNotFound,
  apiError,
  apiUnreachable,
  contractMismatch,
  invalidArgument,
  prNotFound,
  prNotImported,
  repoNotImported,
  runFailed,
  toErrorResult,
} from '../src/errors.js';

/** Every row of spec 06 step 4 becomes an `isError: true` result. */
describe('the step-4 failure table', () => {
  it('repo not imported — enumerates what IS imported', () => {
    const err = repoNotImported('x/y', ['a/b', 'c/d']);
    expect(err.kind).toBe('repo_not_imported');
    expect(err.message).toBe(
      'Repo "x/y" is not imported into DevDigest. Imported repos: a/b, c/d. ' +
        'Ask the user to add it in the DevDigest UI — this server cannot import repos.',
    );
    expect(err.toResult()).toEqual({
      isError: true,
      content: [{ type: 'text', text: err.message }],
    });
  });

  it('repo not imported — lists at most 20 and says how many more there are', () => {
    const many = Array.from({ length: 25 }, (_, i) => `acme/repo-${i}`);
    const err = repoNotImported('x/y', many);
    expect(err.message).toContain('acme/repo-19 (+5 more)');
    expect(err.message).not.toContain('acme/repo-20');
  });

  it('repo not imported — says so plainly when nothing is imported', () => {
    expect(repoNotImported('x/y', []).message).toContain('Imported repos: none.');
  });

  it('PR number unknown — enumerates the known numbers', () => {
    const err = prNotFound('x/y', 7, [1, 2, 3]);
    expect(err.kind).toBe('pr_not_found');
    expect(err.message).toBe(
      'PR #7 not found in x/y. Known PR numbers: 1, 2, 3. ' +
        'If the PR is new, open the repo in DevDigest to sync it.',
    );
  });

  it('PR present upstream but never persisted — names the sync step', () => {
    const err = prNotImported('x/y', 7);
    expect(err.kind).toBe('pr_not_imported');
    expect(err.message).toContain('PR #7 in x/y');
    expect(err.message).toMatch(/DevDigest/);
  });

  it('agent name unknown — points at list_agents', () => {
    const err = agentNotFound('z');
    expect(err.kind).toBe('agent_not_found');
    expect(err.message).toBe('Agent "z" not found. Call list_agents for the valid names.');
  });

  it('agent name ambiguous — lists the candidates', () => {
    const err = agentAmbiguous('sec', [
      { name: 'Sec', model: 'gpt-4o' },
      { name: 'SEC', model: 'claude-3-5-sonnet' },
    ]);
    expect(err.kind).toBe('agent_ambiguous');
    expect(err.message).toContain('"Sec" (gpt-4o)');
    expect(err.message).toContain('"SEC" (claude-3-5-sonnet)');
    expect(err.message).toContain('list_agents');
  });

  it('API unreachable — names the script that starts it', () => {
    const err = apiUnreachable('http://localhost:3001');
    expect(err.kind).toBe('api_unreachable');
    expect(err.message).toBe(
      'Cannot reach the DevDigest API at http://localhost:3001. ' +
        'Start it with ./scripts/dev.sh (API on :3001), then retry.',
    );
  });

  it('response failed safeParse — names the path and forbids a retry', () => {
    const err = contractMismatch('GET /agents → 0.name');
    expect(err.kind).toBe('contract_mismatch');
    expect(err.message).toBe(
      'The DevDigest API returned a shape this MCP server does not recognise ' +
        '(GET /agents → 0.name). The API contract moved; mcp/ needs updating. Do not retry.',
    );
  });

  it('run failed — repeats the run error verbatim and points at the trace', () => {
    const err = runFailed('failed', 'provider returned 429 rate_limit_exceeded');
    expect(err.kind).toBe('run_failed');
    expect(err.message).toBe(
      'provider returned 429 rate_limit_exceeded Check the run trace in the DevDigest UI.',
    );
  });

  it('run failed without a recorded error — still says where to look', () => {
    const err = runFailed('cancelled', null);
    expect(err.message).toContain('cancelled');
    expect(err.message).toContain('Check the run trace in the DevDigest UI.');
  });

  it('an API error envelope keeps the server code and message', () => {
    const err = apiError(404, 'not_found', 'Repo not found');
    expect(err.kind).toBe('api_error');
    expect(err.message).toContain('404');
    expect(err.message).toContain('not_found');
    expect(err.message).toContain('Repo not found');
  });

  it('an invalid argument says what the shape must be', () => {
    const err = invalidArgument('repo must look like "owner/name"');
    expect(err.kind).toBe('invalid_argument');
    expect(err.message).toContain('owner/name');
  });
});

describe('every row names a next step', () => {
  const rows: ToolError[] = [
    repoNotImported('x/y', ['a/b']),
    prNotFound('x/y', 7, [1]),
    prNotImported('x/y', 7),
    agentNotFound('z'),
    agentAmbiguous('sec', [{ name: 'Sec', model: 'gpt-4o' }]),
    apiUnreachable('http://localhost:3001'),
    apiError(500, 'internal_error', 'boom'),
    contractMismatch('GET /agents → 0.name'),
    runFailed('failed', 'boom'),
    invalidArgument('repo must look like "owner/name"'),
  ];

  it.each(rows.map((r) => [r.kind, r] as const))('%s', (_kind, err) => {
    const result = err.toResult();
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    // An actionable next step: a tool to call, a UI to open, a command to run,
    // or an explicit "do not retry".
    expect(text).toMatch(
      /list_agents|get_findings|DevDigest UI|dev\.sh|Do not retry|open the repo in DevDigest|owner\/name/,
    );
  });
});

describe('toErrorResult', () => {
  it('passes a ToolError through with its own text', () => {
    const err = agentNotFound('z');
    expect(toErrorResult(err)).toEqual(err.toResult());
  });

  it('wraps an unexpected error rather than letting it escape the tool call', () => {
    const result = toErrorResult(new TypeError('kaboom'));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('kaboom');
  });
});

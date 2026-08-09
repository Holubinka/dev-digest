import { describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import {
  EXIT_BLOCKING,
  EXIT_CLEAN,
  EXIT_UNAVAILABLE,
  runCli,
  type CliDeps,
} from '../src/cli/run.js';
import type { ExecLike } from '../src/cli/git.js';

const BASE = 'http://127.0.0.1:3001';
const ROOT = '/Users/dev/checkout';

/** A real `git diff HEAD` fragment — the server rejects a body with no @@ hunk. */
const DIFF = `diff --git a/src/pay.ts b/src/pay.ts
--- a/src/pay.ts
+++ b/src/pay.ts
@@ -1,3 +1,4 @@
 export function pay(amount: number) {
+  console.log(process.env.STRIPE_KEY);
   return amount;
 }
`;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const finding = (over: Record<string, unknown> = {}) => ({
  severity: 'CRITICAL',
  category: 'security',
  title: 'Secret written to the log',
  file: 'src/pay.ts',
  start_line: 2,
  end_line: 2,
  rationale: 'STRIPE_KEY reaches stdout.',
  suggestion: null,
  confidence: 0.9,
  ...over,
});

const review = (over: Record<string, unknown> = {}) => ({
  agent_name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4o-mini',
  verdict: 'request_changes',
  score: 40,
  blockers: 1,
  grounding: '1/1 passed',
  findings: [finding()],
  ...over,
});

interface HarnessOptions {
  /** What `git diff --no-color HEAD` prints. */
  diff?: string;
  /** What `POST /reviews/diff` answers with. */
  response?: unknown;
  status?: number;
  /** Make every git invocation fail, the way a non-repository does. */
  gitFails?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const posted: { path: string; body: unknown }[] = [];
  const gitCalls: string[][] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const { pathname } = new URL(String(input));
    posted.push({ path: pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(options.response ?? { files: 1, reviews: [] }, options.status ?? 200);
  };

  const exec: ExecLike = async (file, args) => {
    gitCalls.push([file, ...args]);
    if (options.gitFails) {
      const error = new Error('Command failed: git') as Error & { stderr: string };
      error.stderr = 'fatal: not a git repository (or any of the parent directories): .git';
      throw error;
    }
    if (args[0] === 'rev-parse') return { stdout: `${ROOT}\n`, stderr: '' };
    if (args[0] === 'diff') return { stdout: options.diff ?? DIFF, stderr: '' };
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };

  const deps: CliDeps = {
    client: new ApiClient({ baseUrl: BASE, fetchImpl }),
    exec,
    cwd: `${ROOT}/src`,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { deps, out, err, posted, gitCalls };
}

describe('devdigest review', () => {
  it('exits 0 when the review ran and nothing blocks', async () => {
    const h = harness({ response: { files: 1, reviews: [review({ blockers: 0, findings: [] })] } });

    expect(await runCli(['review'], h.deps)).toBe(EXIT_CLEAN);
    expect(h.posted.map((p) => p.path)).toEqual(['/reviews/diff']);
    expect(h.posted[0]!.body).toEqual({ diff: DIFF, all: true });
  });

  it('exits 1 when a blocking finding came back, and prints severity path:line title', async () => {
    const h = harness({ response: { files: 1, reviews: [review()] } });

    expect(await runCli(['review', '--mode', 'working'], h.deps)).toBe(EXIT_BLOCKING);
    expect(h.out).toEqual(['CRITICAL src/pay.ts:2 Secret written to the log']);
    // Diagnostics never contaminate the finding stream.
    expect(h.err.join('\n')).toContain('1 blocking finding(s)');
  });

  it('exits 2 when the review could not be run at all', async () => {
    const h = harness({ status: 500, response: { error: { code: 'boom', message: 'no key' } } });

    expect(await runCli(['review'], h.deps)).toBe(EXIT_UNAVAILABLE);
    expect(h.out).toEqual([]);
    expect(h.err.join('\n')).toContain('no key');
  });

  it('exits 2 outside a git repository, before calling the API', async () => {
    const h = harness({ gitFails: true });

    expect(await runCli(['review'], h.deps)).toBe(EXIT_UNAVAILABLE);
    expect(h.posted).toEqual([]);
    expect(h.err.join('\n')).toContain('not a git repository');
  });

  it('exits 2 on --mode staged, saying it is not implemented', async () => {
    const h = harness();

    expect(await runCli(['review', '--mode', 'staged'], h.deps)).toBe(EXIT_UNAVAILABLE);
    expect(h.err.join('\n')).toContain('not implemented');
    // Refused before anything is read or spent.
    expect(h.gitCalls).toEqual([]);
    expect(h.posted).toEqual([]);
  });

  it('exits 2 on --mode branch, saying it is not implemented', async () => {
    const h = harness();

    expect(await runCli(['review', '--mode', 'branch'], h.deps)).toBe(EXIT_UNAVAILABLE);
    expect(h.err.join('\n')).toContain('not implemented');
  });

  it('exits 2 on an unknown --mode without touching git or the API', async () => {
    const h = harness();

    expect(await runCli(['review', '--mode', 'everything'], h.deps)).toBe(EXIT_UNAVAILABLE);
    expect(h.gitCalls).toEqual([]);
    expect(h.posted).toEqual([]);
  });

  it('--help names the three exit codes and the untracked-file exclusion', async () => {
    const h = harness();

    expect(await runCli(['--help'], h.deps)).toBe(EXIT_CLEAN);
    const help = h.out.join('\n');
    expect(help).toContain('UNTRACKED FILES ARE NOT INCLUDED');
    expect(help).toContain('git add -N');
    expect(help).toMatch(/^\s*0\s+the review ran and found nothing blocking$/m);
    expect(help).toMatch(/^\s*1\s+the review ran and found at least one BLOCKING finding/m);
    expect(help).toMatch(/^\s*2\s+the review could not be run at all/m);
    // Help is not a review, so it must not have run one.
    expect(h.posted).toEqual([]);
  });

  it('reads the whole tree: rev-parse from the cwd, diff from the root', async () => {
    const h = harness({ response: { files: 1, reviews: [review({ blockers: 0, findings: [] })] } });

    await runCli(['review'], h.deps);
    expect(h.gitCalls).toEqual([
      ['git', 'rev-parse', '--show-toplevel'],
      ['git', 'diff', '--no-color', 'HEAD'],
    ]);
  });

  it('exits 0 with an untracked-file reminder when the tracked tree is clean', async () => {
    const h = harness({ diff: '' });

    expect(await runCli(['review'], h.deps)).toBe(EXIT_CLEAN);
    expect(h.posted).toEqual([]);
    expect(h.err.join('\n')).toContain('Untracked files are not included');
  });

  it('sums blockers across agents and sorts each agent findings', async () => {
    const h = harness({
      response: {
        files: 1,
        reviews: [
          review({
            blockers: 1,
            findings: [
              finding({ severity: 'SUGGESTION', title: 'Rename it', start_line: 3 }),
              finding({ severity: 'CRITICAL', title: 'Secret written to the log' }),
            ],
          }),
          review({ agent_name: 'Perf', blockers: 2, findings: [] }),
        ],
      },
    });

    expect(await runCli(['review'], h.deps)).toBe(EXIT_BLOCKING);
    expect(h.out).toEqual([
      'CRITICAL src/pay.ts:2 Secret written to the log',
      'SUGGESTION src/pay.ts:3 Rename it',
    ]);
    expect(h.err.join('\n')).toContain('3 blocking finding(s) across 2 agent(s)');
  });

  it('reports a moved API contract instead of guessing an exit code', async () => {
    const h = harness({ response: { files: 1, reviews: [{ agent_name: 'x' }] } });

    expect(await runCli(['review'], h.deps)).toBe(EXIT_UNAVAILABLE);
    expect(h.err.join('\n')).toContain('does not recognise');
  });
});

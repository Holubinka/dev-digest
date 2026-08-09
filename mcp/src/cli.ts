#!/usr/bin/env node
/**
 * The `devdigest` binary (spec 07 step 15) — `package.json` `bin`.
 *
 * Wiring only: the real subprocess runner, the real `ApiClient`, the real
 * streams. Every decision is in `cli/run.ts`, which takes all three as
 * parameters.
 *
 * This file is NOT reachable from `src/index.ts`, and must never become
 * reachable: `index.ts` is the MCP stdio server, where stdout is the transport,
 * and this one writes findings to stdout by design (`mcp/AGENTS.md`).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ApiClient } from './api/client.js';
import { loadConfig } from './config.js';
import { EXIT_UNAVAILABLE, runCli, type CliDeps } from './cli/run.js';

const execFileAsync = promisify(execFile);

/**
 * Survive the reader closing the pipe first.
 *
 * This CLI's whole stdout contract is "one line per finding", so `| head`,
 * `| grep -q` and a pager are the expected consumers — and every one of them
 * can close the pipe mid-write. `process.stdout` then emits an `error` event
 * with no listener, which Node turns into an unhandled exception: a stack
 * trace on stderr and a crash instead of an exit code. Measured 2026-08-09
 * with `node dist/cli.js --help | head -3`.
 *
 * Anything that is not EPIPE is re-thrown, so a genuinely broken stream still
 * fails loudly.
 */
function ignoreEpipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });
}
ignoreEpipe(process.stdout);
ignoreEpipe(process.stderr);

const exec: CliDeps['exec'] = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, [...args], {
    cwd: options.cwd,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  });
  return { stdout, stderr };
};

async function main(): Promise<number> {
  const config = loadConfig();
  // The RUN timeout, not the 15s per-request one: this single request holds the
  // connection open for the whole model call.
  const client = new ApiClient({ baseUrl: config.apiUrl, timeoutMs: config.runTimeoutMs });
  return runCli(process.argv.slice(2), {
    client,
    exec,
    cwd: process.cwd(),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}

// `process.exitCode`, never `process.exit()`: stdout is a pipe when the output
// is piped or captured, writes to a pipe are asynchronous, and `process.exit`
// truncates whatever has not flushed — which here is the findings.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // Only a failure OUTSIDE runCli lands here — a bad DEVDIGEST_API_URL is the
    // realistic one, since `loadConfig` throws before the client exists.
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = EXIT_UNAVAILABLE;
  });

/**
 * `devdigest review` — the whole command, with every edge injected
 * (spec 07 step 15).
 *
 * Separate from `src/cli.ts` so a test can drive it with a stubbed subprocess
 * runner and a stubbed `fetch` and read back the exit code, without importing a
 * module that calls `process.exit`. `cli.ts` is the ten lines that wire the real
 * `execFile`, the real `ApiClient` and the real streams to this function.
 *
 * Nothing in this file — or in anything it imports — writes to a stream: every
 * byte leaves through `deps.out` / `deps.err`. The package's only
 * `process.stdout.write` is in `src/cli.ts`, and `src/index.ts` (the MCP stdio
 * server) does not import `cli.ts`. That injection is the whole guard, and it
 * is not "separate module graphs": `../project.js` and `../api/schemas.js` are
 * imported by `index.ts` too, so a `console.log` added to one of those lands on
 * the transport's stdout and kills the session
 * (`mcp/AGENTS.md` §"Only JSON-RPC may reach stdout").
 */

import type { ApiClient } from '../api/client.js';
import { compareFindings } from '../project.js';
import { HELP, parseArgs } from './args.js';
import { MAX_DIFF_CHARS, repoRoot, workingDiff, type ExecLike } from './git.js';
import { DiffReviewPayload } from './schema.js';

/** The review ran and found nothing at or above any agent's blocking severity. */
export const EXIT_CLEAN = 0;
/** The review ran and found at least one blocking finding. */
export const EXIT_BLOCKING = 1;
/** The review could not be run at all. */
export const EXIT_UNAVAILABLE = 2;

export interface CliDeps {
  client: ApiClient;
  exec: ExecLike;
  cwd: string;
  /** Findings only. One line, no trailing newline — the sink adds it. */
  out: (line: string) => void;
  /** Everything else: progress, counts, failures. */
  err: (line: string) => void;
}

/**
 * `argv` is `process.argv.slice(2)`.
 *
 * Returns the exit code instead of setting one, so the caller owns the single
 * `process.exitCode` write and a test owns nothing at all.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    for (const line of HELP.split('\n')) deps.out(line);
    return EXIT_CLEAN;
  }
  if (parsed.kind === 'error') {
    deps.err(parsed.message);
    deps.err('Run `devdigest --help` for usage.');
    return EXIT_UNAVAILABLE;
  }
  if (parsed.mode !== 'working') {
    // Validated, then refused. The name is reserved so a future implementation
    // does not have to change the argument surface (spec 07 §Out of scope).
    deps.err(
      `--mode ${parsed.mode} is not implemented — only --mode working reviews anything today.`,
    );
    return EXIT_UNAVAILABLE;
  }

  try {
    const root = await repoRoot(deps.exec, deps.cwd);
    const diff = await workingDiff(deps.exec, root);

    if (diff.trim() === '') {
      // Clean, not unavailable: the review DID run its course and there is
      // nothing blocking. A pre-commit hook on an untouched tree must not fail.
      deps.err(
        'No uncommitted changes to tracked files against HEAD — nothing to review. ' +
          'Untracked files are not included; `git add -N <file>` makes a new file visible.',
      );
      return EXIT_CLEAN;
    }
    if (diff.length > MAX_DIFF_CHARS) {
      deps.err(
        `The working-tree diff is ${diff.length} characters, over the ${MAX_DIFF_CHARS} the ` +
          `DevDigest API accepts. Commit or stash part of the change and re-run.`,
      );
      return EXIT_UNAVAILABLE;
    }

    deps.err(`Reviewing ${diff.length} characters of working-tree diff from ${root}…`);
    const payload = await deps.client.post(
      '/reviews/diff',
      // Every enabled agent, because the CLI takes no agent argument. The
      // server resolves this with the same `resolveTargets` the PR route uses.
      { diff, all: true },
      DiffReviewPayload,
    );

    let blockers = 0;
    for (const review of payload.reviews) {
      blockers += review.blockers;
      deps.err(
        `${review.agent_name} (${review.provider}/${review.model}) — ${review.verdict}, ` +
          `score ${review.score}, ${review.findings.length} finding(s), ` +
          `${review.blockers} blocking, grounding ${review.grounding}`,
      );
      // Sorted here rather than trusted from the wire: the API returns findings
      // in insertion order, and an unordered list makes two runs of the same
      // diff print differently for no reason a reader can see.
      for (const finding of [...review.findings].sort(compareFindings)) {
        deps.out(`${finding.severity} ${finding.file}:${finding.start_line} ${finding.title}`);
      }
    }

    deps.err(
      blockers > 0
        ? `${blockers} blocking finding(s) across ${payload.reviews.length} agent(s).`
        : `No blocking findings across ${payload.reviews.length} agent(s).`,
    );
    return blockers > 0 ? EXIT_BLOCKING : EXIT_CLEAN;
  } catch (err) {
    // ApiClient already decodes its three failure modes into a message that
    // names the next step; a git failure arrives the same way from `git.ts`.
    deps.err(err instanceof Error ? err.message : String(err));
    return EXIT_UNAVAILABLE;
  }
}

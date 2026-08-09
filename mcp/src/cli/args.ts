/**
 * `devdigest` argument parsing (spec 07 step 15).
 *
 * Hand-rolled on purpose. This package has exactly two runtime dependencies —
 * the MCP SDK and Zod — and a flag parser is not worth a third
 * (`mcp/AGENTS.md`). Pure: values in, a decision out, no I/O and no `process`.
 */

export const MODES = ['working', 'staged', 'branch'] as const;
export type Mode = (typeof MODES)[number];

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'review'; mode: Mode; agent?: string }
  | { kind: 'error'; message: string };

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/**
 * `argv` is everything after the binary name, i.e. `process.argv.slice(2)`.
 *
 * A bare `devdigest` is an ERROR rather than a help screen: help exits 0, and 0
 * is the "reviewed, nothing blocking" code in this tool's contract. Printing
 * help for a typo would report a review that never ran as a clean one.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };

  const rest = [...argv];
  if (rest[0] === 'review') rest.shift();
  else if (rest.length === 0) {
    return { kind: 'error', message: 'Nothing to do. The only command is `devdigest review`.' };
  } else if (!rest[0]!.startsWith('-')) {
    return {
      kind: 'error',
      message: `Unknown command ${JSON.stringify(rest[0])}. The only command is \`devdigest review\`.`,
    };
  }

  let mode: Mode = 'working';
  let agent: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--agent') {
      const value = rest[++i];
      if (value === undefined || value.trim() === '') {
        return { kind: 'error', message: '--agent needs an agent name.' };
      }
      agent = value.trim();
      continue;
    }
    const inlineAgent = /^--agent=(.*)$/.exec(arg);
    if (inlineAgent) {
      const value = inlineAgent[1]!.trim();
      if (value === '') return { kind: 'error', message: '--agent needs an agent name.' };
      agent = value;
      continue;
    }
    if (arg === '--mode') {
      const value = rest[++i];
      if (value === undefined) {
        return { kind: 'error', message: `--mode needs a value: ${MODES.join(', ')}.` };
      }
      if (!isMode(value)) {
        return {
          kind: 'error',
          message: `Unknown --mode ${JSON.stringify(value)}. Valid modes: ${MODES.join(', ')}.`,
        };
      }
      mode = value;
      continue;
    }
    const inline = /^--mode=(.*)$/.exec(arg);
    if (inline) {
      const value = inline[1]!;
      if (!isMode(value)) {
        return {
          kind: 'error',
          message: `Unknown --mode ${JSON.stringify(value)}. Valid modes: ${MODES.join(', ')}.`,
        };
      }
      mode = value;
      continue;
    }
    return { kind: 'error', message: `Unknown option ${JSON.stringify(arg)}.` };
  }

  return agent === undefined ? { kind: 'review', mode } : { kind: 'review', mode, agent };
}

/**
 * The whole contract in one screen.
 *
 * The two things a caller cannot infer from a successful run are pinned here and
 * by a test: what the exit codes mean, and that untracked files are invisible to
 * `git diff HEAD`. Silently reviewing everything EXCEPT the new file someone just
 * wrote is the failure this paragraph exists to prevent.
 */
export const HELP = `devdigest review — review your uncommitted changes with the DevDigest agents.

Usage:
  devdigest review [--mode working]
  devdigest --help

Options:
  --mode <working|staged|branch>  What to review. Default: working.
                                  "staged" and "branch" are reserved names and
                                  exit 2 with "not implemented".
  --agent <name>                  Review with ONE agent instead of every enabled
                                  one. The name is the one the Agents screen
                                  shows, e.g. "Security Reviewer".
                                  One paid model call instead of N.
  -h, --help                      Print this and exit 0.

What gets reviewed:
  "git diff HEAD", run from the repository root: every change to a TRACKED file,
  staged or not.

  UNTRACKED FILES ARE NOT INCLUDED. "git diff HEAD" cannot see a file git has
  never been told about, so a brand-new file is reviewed as if it did not exist.
  Run "git add -N <file>" to make it visible to the diff, then re-run.

Output:
  One line per finding on stdout:  <SEVERITY> <path>:<line> <title>
  Everything else — agent, verdict, counts, errors — goes to stderr.

Exit codes:
  0  the review ran and found nothing blocking
  1  the review ran and found at least one BLOCKING finding, meaning at or above
     the reviewing agent's own ci_fail_on severity
  2  the review could not be run at all: bad arguments, not a git repository,
     no commits yet, a diff over the size cap, an unimplemented --mode, or the
     DevDigest API being unreachable

Cost and persistence:
  Without --agent, every ENABLED agent reviews the diff — one paid model call
  each, and they run one after another, so five agents take five times as long.
  --agent narrows that to one. Nothing is persisted either way: there is no pull
  request to attach a run, a review or a finding to.

Environment:
  DEVDIGEST_API_URL          default http://localhost:3001 (loopback only)
  DEVDIGEST_CLI_TIMEOUT_MS   default 600000 — how long to wait for the review.
                             Reviewing with every enabled agent is what gets
                             near this; --agent stays far below it.
`;

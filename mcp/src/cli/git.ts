/**
 * The two git reads the CLI makes (spec 07 step 15).
 *
 * `execFile`, never `exec` and never `{ shell: true }`: the arguments below are
 * fixed literals today, but a shell in this position is the difference between
 * a future `--path <user string>` being a path and being a command
 * (`security` A05 "Command injection"). The subprocess runner arrives as a
 * parameter, which is what lets the tests drive this with no git at all.
 */

export interface ExecLike {
  (
    file: string,
    args: readonly string[],
    options: { cwd: string; maxBuffer: number },
  ): Promise<{ stdout: string; stderr: string }>;
}

/**
 * A working-tree diff can be large, and `execFile`'s default 1 MiB ceiling
 * kills the child with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` rather than
 * truncating — a silently half-read diff would be worse. Sized well above the
 * API's own diff cap so an over-cap diff is reported as over-cap, not as a
 * buffer crash.
 */
export const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * The API's `MAX_DIFF_CHARS` (`server/src/modules/reviews/diff-review.ts`),
 * restated because `mcp/` may not import from `server/src/**`.
 *
 * The API is authoritative — it rejects an over-cap body with a 422 either way.
 * This copy exists only so the message names the diff and the cap instead of
 * being a validation error, so drift costs a worse message and nothing else.
 */
export const MAX_DIFF_CHARS = 200_000;

function gitFailure(what: string, err: unknown): Error {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  const detail = stderr && stderr.length > 0 ? stderr : (err as Error).message;
  return new Error(`${what}: ${detail}`);
}

/** The repository root, so the diff is the whole tree and not one subdirectory. */
export async function repoRoot(exec: ExecLike, cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout.trim();
  } catch (err) {
    throw gitFailure(`${cwd} is not inside a git repository`, err);
  }
}

/**
 * `git diff HEAD` — staged and unstaged changes to tracked files, in one diff.
 *
 * `--no-color` is explicit: a user with `color.ui = always` in their git config
 * gets ANSI escapes even on a pipe, and the server's parser would then find no
 * `@@` hunks and reject the whole body.
 *
 * Untracked files are absent by construction. That is documented in `--help`
 * rather than worked around, because the alternatives (`--no-index` per file,
 * or `add -N` on the user's behalf) both write to someone's index.
 */
export async function workingDiff(exec: ExecLike, root: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['diff', '--no-color', 'HEAD'], {
      cwd: root,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    throw gitFailure('could not read `git diff HEAD`', err);
  }
}

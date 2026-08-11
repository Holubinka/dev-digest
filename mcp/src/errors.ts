/**
 * Tool errors that move the agent forward (spec 06 step 4).
 *
 * Per the MCP spec an execution error belongs in the tool RESULT (`isError:
 * true`), not in a protocol error, so the model can read it and self-correct.
 * Every message here therefore names the next step: a tool to call, a screen to
 * open, a command to run — or an explicit "do not retry" when nothing will help.
 *
 * There is no `list_repos` tool and no `list_pulls` tool, so `repoNotImported`
 * and `prNotFound` are the ONLY thing that can tell the model what does exist.
 * They enumerate rather than merely reporting a miss.
 *
 * Pure: no I/O, no imports. Everything else in `mcp/` may depend on this file.
 */

export type ToolErrorKind =
  | 'repo_not_imported'
  | 'pr_not_found'
  | 'pr_not_imported'
  | 'agent_not_found'
  | 'agent_ambiguous'
  | 'api_unreachable'
  | 'api_timeout'
  | 'api_error'
  | 'contract_mismatch'
  | 'run_failed'
  | 'invalid_argument';

/**
 * The MCP `CallToolResult` subset we produce. Declared structurally rather than
 * imported from an SDK: which SDK line this server speaks is settled separately
 * (spec 06 step 1), and nothing in this file needs to know.
 */
/**
 * A `type` and not an `interface` on purpose: the SDK's `CallToolResult` carries
 * an index signature, and TypeScript gives a type alias an implicit one while an
 * interface gets none — so `interface` here fails to assign at every
 * `registerTool` call site in `index.ts`.
 */
export type ToolTextResult = {
  content: { type: 'text'; text: string }[];
  isError: boolean;
};

/**
 * The success half of `ToolTextResult`. Every tool answers with one JSON object
 * as text — compact, not pretty-printed: indentation is tokens the model pays
 * for and gains nothing from.
 */
export function okResult(payload: unknown): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
}

export class ToolError extends Error {
  readonly kind: ToolErrorKind;

  constructor(kind: ToolErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ToolError';
    this.kind = kind;
  }

  toResult(): ToolTextResult {
    return { content: [{ type: 'text', text: this.message }], isError: true };
  }
}

/** How many candidates an enumerating error lists before it summarises the rest. */
export const MAX_LISTED_CANDIDATES = 20;

function enumerate(values: readonly (string | number)[]): string {
  if (values.length === 0) return 'none';
  const shown = values.slice(0, MAX_LISTED_CANDIDATES).join(', ');
  const rest = values.length - MAX_LISTED_CANDIDATES;
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

export function repoNotImported(repo: string, importedFullNames: readonly string[]): ToolError {
  return new ToolError(
    'repo_not_imported',
    `Repo "${repo}" is not imported into DevDigest. ` +
      `Imported repos: ${enumerate(importedFullNames)}. ` +
      `Ask the user to add it in the DevDigest UI — this server cannot import repos.`,
  );
}

export function prNotFound(repo: string, pr: number, knownNumbers: readonly number[]): ToolError {
  return new ToolError(
    'pr_not_found',
    `PR #${pr} not found in ${repo}. Known PR numbers: ${enumerate(knownNumbers)}. ` +
      `If the PR is new, open the repo in DevDigest to sync it.`,
  );
}

/**
 * `PrMeta.id` is nullish for a pull request the API can see upstream but has not
 * persisted, so there is no id to review against.
 */
export function prNotImported(repo: string, pr: number): ToolError {
  return new ToolError(
    'pr_not_imported',
    `PR #${pr} in ${repo} is listed but has no DevDigest id yet, so it cannot be reviewed. ` +
      `Open the repo in the DevDigest UI to sync it, then retry.`,
  );
}

export function agentNotFound(name: string): ToolError {
  return new ToolError(
    'agent_not_found',
    `Agent "${name}" not found. Call list_agents for the valid names.`,
  );
}

export function agentAmbiguous(
  name: string,
  candidates: readonly { name: string; model: string }[],
): ToolError {
  const listed = candidates
    .slice(0, MAX_LISTED_CANDIDATES)
    .map((c) => `"${c.name}" (${c.model})`)
    .join(', ');
  return new ToolError(
    'agent_ambiguous',
    `Agent "${name}" is ambiguous — ${candidates.length} agents match that name: ${listed}. ` +
      `Call list_agents and use the exact name, or ask the user to rename one in the DevDigest UI.`,
  );
}

export function apiUnreachable(url: string, cause?: unknown): ToolError {
  return new ToolError(
    'api_unreachable',
    `Cannot reach the DevDigest API at ${url}. ` +
      `Start it with ./scripts/dev.sh (API on :3001), then retry.`,
    { cause },
  );
}

/**
 * A timeout is NOT unreachability, and saying so cost real time: a review of a
 * 728-character diff across five enabled agents runs 73-125s, so it straddles
 * the ceiling — and every time it lost, the answer read "Cannot reach the
 * DevDigest API", sending the reader to restart a server that was serving the
 * whole time. The server keeps working after this fires; only the wait stopped.
 */
export function apiTimeout(url: string, ms: number, cause?: unknown): ToolError {
  return new ToolError(
    'api_timeout',
    `The DevDigest API at ${url} did not answer within ${Math.round(ms / 1000)}s. ` +
      `It is running — this is the client giving up, and the work may still finish ` +
      `on the server. A review across every enabled agent is what usually takes this ` +
      `long; enable fewer of them, or raise DEVDIGEST_CLI_TIMEOUT_MS.`,
    { cause },
  );
}

/** A structured `{error:{code,message}}` envelope came back on a non-2xx response. */
export function apiError(status: number, code: string, message: string): ToolError {
  return new ToolError(
    'api_error',
    `The DevDigest API rejected the request: ${status} ${code} — ${message}. ` +
      `Check the API log where ./scripts/dev.sh is running.`,
  );
}

export function contractMismatch(path: string): ToolError {
  return new ToolError(
    'contract_mismatch',
    `The DevDigest API returned a shape this MCP server does not recognise (${path}). ` +
      `The API contract moved; mcp/ needs updating. Do not retry.`,
  );
}

export function runFailed(status: string, error: string | null | undefined): ToolError {
  const head = error?.trim()
    ? error.trim()
    : `The review run ${status} without recording an error message.`;
  return new ToolError('run_failed', `${head} Check the run trace in the DevDigest UI.`);
}

export function invalidArgument(message: string): ToolError {
  return new ToolError('invalid_argument', message);
}

/**
 * Last line of defence for a tool handler: nothing should escape a tool call as
 * a protocol error, and no stack trace should reach the transport.
 */
export function toErrorResult(err: unknown): ToolTextResult {
  if (err instanceof ToolError) return err.toResult();
  const detail = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: 'text',
        text:
          `Unexpected error in the DevDigest MCP server: ${detail}. ` +
          `This is a bug in mcp/ — different arguments will not help.`,
      },
    ],
    isError: true,
  };
}

/**
 * Process configuration (spec 06 Constraint 7).
 *
 * Two environment variables, NEITHER of which may carry a secret. The local API
 * runs `LocalNoAuthProvider` and takes no credential, so there is nothing here
 * to protect — and nothing that would justify adding a key to this schema. A
 * provider key belongs to the server's `SecretsProvider`, never to this process
 * (root AGENTS.md §Non-default conventions).
 *
 *   DEVDIGEST_API_URL              default http://localhost:3001, loopback only
 *   DEVDIGEST_MCP_RUN_TIMEOUT_MS   default 120000 (spec 06 step 8)
 *   DEVDIGEST_CLI_TIMEOUT_MS       default 600000 — the CLI waits in a terminal,
 *                                  not inside an MCP client, so it gets its own
 */

export const DEFAULT_API_URL = 'http://localhost:3001';
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;
/** Per-HTTP-request ceiling. Not an env var: the run ceiling is the tunable one. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/**
 * The CLI's own ceiling, and deliberately far above the MCP one. 120000 exists
 * because an MCP client is holding a tool call open; `devdigest review` is a
 * foreground command with a human watching, bound only by how long the work
 * takes. Measured: five enabled agents over a 728-character diff run 73-125s,
 * so the MCP ceiling cut it off about half the time. 600000 matches
 * reviewer-core's own wall-clock deadline, past which the server gives up too.
 */
export const DEFAULT_CLI_TIMEOUT_MS = 600_000;

export interface McpConfig {
  /** Base URL with no trailing slash, e.g. `http://localhost:3001`. */
  readonly apiUrl: string;
  readonly requestTimeoutMs: number;
  readonly runTimeoutMs: number;
  /** The CLI's ceiling. Separate from `runTimeoutMs`: no MCP client is waiting. */
  readonly cliTimeoutMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isLoopbackHost(hostname: string): boolean {
  // `new URL('http://[::1]:3001').hostname` keeps the brackets.
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  return octets[0] === 127 && octets.every((o) => o >= 0 && o <= 255);
}

/**
 * The API has no authentication, so a non-loopback URL is an exfiltration path
 * with no compensating control: every repo name, PR title, diff-derived finding
 * and convention this server reads would go to a host nobody authenticated.
 */
export function parseApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(
      `DEVDIGEST_API_URL is not a valid URL: ${JSON.stringify(raw)}. ` +
        `Expected something like ${DEFAULT_API_URL}.`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(
      `DEVDIGEST_API_URL must be an http(s) URL, got ${JSON.stringify(url.protocol)}.`,
    );
  }
  if (url.username || url.password) {
    throw new ConfigError(
      'DEVDIGEST_API_URL must not carry credentials — the DevDigest API takes none.',
    );
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new ConfigError(
      `DEVDIGEST_API_URL must point at a loopback address (localhost, 127.0.0.0/8 or ::1), ` +
        `got ${JSON.stringify(url.hostname)}. The DevDigest API has no authentication, so a ` +
        `remote URL would send this workspace's code review data to an unauthenticated host.`,
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function parsePositiveInt(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer number of milliseconds, got ${raw}.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const rawUrl = env.DEVDIGEST_API_URL?.trim();
  const rawRunTimeout = env.DEVDIGEST_MCP_RUN_TIMEOUT_MS?.trim();
  const rawCliTimeout = env.DEVDIGEST_CLI_TIMEOUT_MS?.trim();
  return {
    apiUrl: parseApiUrl(rawUrl && rawUrl.length > 0 ? rawUrl : DEFAULT_API_URL),
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    runTimeoutMs:
      rawRunTimeout && rawRunTimeout.length > 0
        ? parsePositiveInt(rawRunTimeout, 'DEVDIGEST_MCP_RUN_TIMEOUT_MS')
        : DEFAULT_RUN_TIMEOUT_MS,
    cliTimeoutMs:
      rawCliTimeout && rawCliTimeout.length > 0
        ? parsePositiveInt(rawCliTimeout, 'DEVDIGEST_CLI_TIMEOUT_MS')
        : DEFAULT_CLI_TIMEOUT_MS,
  };
}

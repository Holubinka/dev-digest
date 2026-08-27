export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Rate limit, server error, or a network-ish failure.
 *
 * All THREE shapes an error spells a status in, matching
 * `server/src/platform/resilience.ts` `httpStatusOf`. This copy read only the
 * first two, so an Octokit failure carrying `response.status` looked like no
 * status at all and was never retried. The duplication is deliberate — this
 * package is bundled into someone else's repository and takes no dependency on
 * `server/` for twenty lines of backoff — the divergence was not.
 */
export function defaultIsRetryable(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  const code = (err as { code?: string })?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND';
}

/**
 * Retry with exponential backoff and jitter.
 *
 * The defaults mirror `server/src/platform/resilience.ts` `withRetry` — 3
 * retries, 250 ms base, 8 s ceiling — which is what the spec's
 * `## Non-functional requirements` names for the runner's GitHub calls.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 8000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      opts.onRetry?.(attempt + 1, err);
      await sleep(Math.min(max, base * 2 ** attempt) + Math.random() * base);
    }
  }
  throw lastErr;
}

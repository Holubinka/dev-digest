/**
 * The one way this server talks to the DevDigest API (spec 06 step 3).
 *
 * The HTTP API is the single external dependency, so it sits behind this one
 * module and takes its `fetch` by injection — that injected `fetch` is the fake
 * the port needs (`onion-architecture` §3.4), and it is what keeps every test
 * in this package hermetic: no API, no Docker, no network, no key.
 *
 * Three failures are decoded here so no caller has to:
 *   - transport dead or timed out  → `api_unreachable`
 *   - `{error:{code,message}}`     → `api_error`   (server/src/app.ts:126-170)
 *   - response fails `safeParse`   → `contract_mismatch`
 */

import type { z } from 'zod';
import { type ToolError, apiError, apiUnreachable, contractMismatch } from '../errors.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../config.js';
import { truncate } from '../project.js';

/**
 * Narrower than `typeof fetch` on purpose — the client only ever passes a string
 * URL, so a test stub only has to handle one input shape. The global `fetch` is
 * assignable to this.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Base URL with no trailing slash; `config.parseApiUrl` produces one. */
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** How much of a non-JSON error body is quoted back in an error message. */
const ERROR_BODY_CHARS = 200;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request('GET', path, schema);
  }

  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request('POST', path, schema, body);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const label = `${method} ${path}`;
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }

    const { status, ok, text } = await this.send(`${this.baseUrl}${path}`, init);
    if (!ok) throw this.decodeFailure(status, text);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw contractMismatch(`${label} → the response body is not JSON`);
    }

    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;

    const issue = parsed.error.issues[0];
    const where = issue
      ? `${label} → ${issue.path.join('.') || '(root)'}: ${issue.message}`
      : label;
    throw contractMismatch(where);
  }

  private async send(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        ...init,
        // The DevDigest API never redirects. Following one would send this
        // request — and the ids in its path — somewhere the loopback check in
        // `config.parseApiUrl` never approved.
        redirect: 'error',
        signal: controller.signal,
        headers: { accept: 'application/json', ...(init.headers as Record<string, string>) },
      });
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (err) {
      throw apiUnreachable(this.baseUrl, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private decodeFailure(status: number, text: string): ToolError {
    try {
      const envelope = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
      const code = envelope?.error?.code;
      const message = envelope?.error?.message;
      if (typeof code === 'string' && typeof message === 'string') {
        return apiError(status, code, message);
      }
    } catch {
      // Not JSON — fall through to the raw-body form below.
    }
    return apiError(status, `http_${status}`, truncate(text.trim() || 'empty body', ERROR_BODY_CHARS));
  }
}

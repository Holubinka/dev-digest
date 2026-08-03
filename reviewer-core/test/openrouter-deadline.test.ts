import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { DeadlineExceededError, OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * The ceiling on one structured completion.
 *
 * `timeoutMs` bounds a single HTTP request, and two retry loops sit above it —
 * the SDK's own and the schema-repair loop here — so the call itself had no
 * bound at all. On 2026-08-03 five review runs sat in `running` for over half
 * an hour with no token count and no error, grinding through the product of
 * those retries. A caller that shows a status needs the operation to end and
 * say why.
 */

const Schema = z.object({ ok: z.boolean() });

/** Swap in a fake SDK client; the provider only ever calls this one method. */
function withClient(
  provider: OpenRouterProvider,
  create: (body: unknown, opts: { signal: AbortSignal }) => Promise<unknown>,
) {
  (provider as unknown as { client: unknown }).client = {
    chat: { completions: { create } },
  };
  return provider;
}

const request = () => ({
  model: 'deepseek/deepseek-v4-flash',
  schema: Schema,
  schemaName: 'Answer',
  messages: [{ role: 'user' as const, content: 'hi' }],
});

/** A call that never answers on its own — only the signal ends it. */
const hangs = (_body: unknown, { signal }: { signal: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const err = new Error('Request was aborted.');
      err.name = 'AbortError';
      reject(err);
    });
  });

const answers = (content: string) => async () => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
});

describe('completeStructured deadline', () => {
  it('ends a hanging call instead of waiting on it forever', async () => {
    const provider = withClient(
      new OpenRouterProvider('k', { deadlineMs: 60 }),
      hangs as never,
    );

    await expect(provider.completeStructured(request())).rejects.toThrow(DeadlineExceededError);
  });

  it('names the budget and the attempt count, so a failed run says why', async () => {
    const provider = withClient(
      new OpenRouterProvider('k', { deadlineMs: 60 }),
      hangs as never,
    );

    await expect(provider.completeStructured(request())).rejects.toThrow(
      /gave up on Answer after 0s \(1 attempt\(s\)\) — the model did not answer in time/,
    );
  });

  it('aborts the in-flight request rather than abandoning the socket', async () => {
    let seen: AbortSignal | undefined;
    const provider = withClient(new OpenRouterProvider('k', { deadlineMs: 60 }), ((
      _body: unknown,
      opts: { signal: AbortSignal },
    ) => {
      seen = opts.signal;
      return hangs(_body, opts);
    }) as never);

    await expect(provider.completeStructured(request())).rejects.toThrow(DeadlineExceededError);
    expect(seen?.aborted).toBe(true);
  });

  /**
   * The budget covers the whole call, not each attempt. A per-attempt bound is
   * what multiplied into half an hour in the first place.
   */
  it('does not start another attempt once the budget is gone', async () => {
    const create = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      // Valid JSON, wrong shape: the repair loop would otherwise try again.
      return { choices: [{ message: { content: '{"nope":1}' } }], usage: {} };
    });
    const provider = withClient(new OpenRouterProvider('k', { deadlineMs: 60 }), create as never);

    await expect(provider.completeStructured(request())).rejects.toThrow(DeadlineExceededError);
    // Two attempts fit inside 60ms; a third would have exceeded it.
    expect(create.mock.calls.length).toBeLessThan(3);
  });

  it('leaves a call that answers in time completely alone', async () => {
    const provider = withClient(
      new OpenRouterProvider('k', { deadlineMs: 5_000 }),
      answers('{"ok":true}') as never,
    );

    const out = await provider.completeStructured(request());
    expect(out.data).toEqual({ ok: true });
    expect(out.attempts).toBe(1);
  });

  it('still repairs a bad shape when there is budget left', async () => {
    let call = 0;
    const create = async () => {
      call += 1;
      return {
        choices: [{ message: { content: call === 1 ? '{"nope":1}' : '{"ok":false}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      };
    };
    const provider = withClient(
      new OpenRouterProvider('k', { deadlineMs: 5_000 }),
      create as never,
    );

    const out = await provider.completeStructured(request());
    expect(out.data).toEqual({ ok: false });
    expect(out.attempts).toBe(2);
  });

  it('re-throws a real provider error unchanged, rather than blaming the clock', async () => {
    const provider = withClient(new OpenRouterProvider('k', { deadlineMs: 5_000 }), (async () => {
      throw new Error('invalid json response body');
    }) as never);

    await expect(provider.completeStructured(request())).rejects.toThrow(
      /invalid json response body/,
    );
  });
});

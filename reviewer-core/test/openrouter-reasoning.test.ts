import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * Reasoning tokens, and where the answer actually turns up.
 *
 * Reproduced against OpenRouter on 2026-08-05 with the real intent classifier:
 * the same request routed to Cloudflare answered in `message.content` and cost
 * 1078 completion tokens, while routed to DeepInfra under a `max_tokens` cap it
 * answered with `content: null` and put the complete, valid JSON in
 * `message.reasoning`. The repair loop parsed an empty string, retried, failed
 * again, and the call died reporting that the schema had failed validation —
 * which was never true. Two defences: ask for no reasoning at all on a short
 * extraction, and read `reasoning` when `content` is empty.
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
  model: 'z-ai/glm-4.7-flash',
  schema: Schema,
  schemaName: 'Intent',
  messages: [{ role: 'user' as const, content: 'hi' }],
});

const answers = async () => ({
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
});

/** Capture the outgoing request body. */
function capture(provider: OpenRouterProvider) {
  const bodies: Record<string, unknown>[] = [];
  withClient(provider, ((body: Record<string, unknown>) => {
    bodies.push(body);
    return answers();
  }) as never);
  return bodies;
}

/** One choice with whatever the backend chose to fill in. */
const replies = (message: Record<string, unknown>) => async () => ({
  choices: [{ message }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
});

describe('OpenRouter reasoning switch', () => {
  it('sends reasoning: { enabled: false } when the caller asks for it off', async () => {
    const provider = new OpenRouterProvider('k');
    const bodies = capture(provider);

    await provider.completeStructured({ ...request(), reasoning: false });

    expect(bodies[0]?.reasoning).toEqual({ enabled: false });
  });

  /**
   * The field is absent by default, which is what keeps every existing call —
   * the reviews above all — byte-identical to what it sent before.
   */
  it('sends nothing about reasoning when the caller does not ask', async () => {
    const provider = new OpenRouterProvider('k');
    const bodies = capture(provider);

    await provider.completeStructured(request());

    expect(bodies[0]).not.toHaveProperty('reasoning');
  });

  it('sends nothing about reasoning when the caller asks for it ON', async () => {
    const provider = new OpenRouterProvider('k');
    const bodies = capture(provider);

    await provider.completeStructured({ ...request(), reasoning: true });

    // `true` means "leave the model's own default alone", not "send a flag".
    expect(bodies[0]).not.toHaveProperty('reasoning');
  });

  /** An OpenRouter extension: OpenAI rejects unknown body fields. */
  it('does NOT send it when the provider is not OpenRouter', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openai' });
    const bodies = capture(provider);

    await provider.completeStructured({ ...request(), reasoning: false });

    expect(bodies[0]).not.toHaveProperty('reasoning');
  });

  it('keeps it on every repair attempt, not just the first', async () => {
    const provider = new OpenRouterProvider('k');
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    withClient(provider, ((body: Record<string, unknown>) => {
      bodies.push(body);
      call += 1;
      return Promise.resolve({
        choices: [{ message: { content: call === 1 ? '{"nope":1}' : '{"ok":false}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    }) as never);

    await provider.completeStructured({ ...request(), reasoning: false });

    expect(bodies).toHaveLength(2);
    for (const body of bodies) expect(body.reasoning).toEqual({ enabled: false });
  });
});

describe('OpenRouter answer arriving in the wrong field', () => {
  it('parses the answer out of message.reasoning when content is null', async () => {
    const provider = withClient(
      new OpenRouterProvider('k'),
      replies({ content: null, reasoning: '{"ok":true}' }) as never,
    );

    const out = await provider.completeStructured(request());

    expect(out.data).toEqual({ ok: true });
    expect(out.attempts).toBe(1);
  });

  it('does the same for a whitespace-only content', async () => {
    const provider = withClient(
      new OpenRouterProvider('k'),
      replies({ content: '  \n ', reasoning: '{"ok":false}' }) as never,
    );

    expect((await provider.completeStructured(request())).data).toEqual({ ok: false });
  });

  /**
   * The narrowing that makes this safe: `reasoning` is a fallback, never a
   * preference. A backend that answers properly AND thinks out loud must have
   * its answer read, not its thinking.
   */
  it('lets content win whenever content holds anything at all', async () => {
    const provider = withClient(
      new OpenRouterProvider('k'),
      replies({ content: '{"ok":true}', reasoning: '{"ok":false}' }) as never,
    );

    expect((await provider.completeStructured(request())).data).toEqual({ ok: true });
  });

  it('reports the raw text it actually parsed, so a trace shows the answer', async () => {
    const provider = withClient(
      new OpenRouterProvider('k'),
      replies({ content: null, reasoning: '{"ok":true}' }) as never,
    );

    expect((await provider.completeStructured(request())).raw).toBe('{"ok":true}');
  });

  /** Nothing anywhere is still nothing: the existing failure is unchanged. */
  it('still fails when neither field carries an answer', async () => {
    const provider = withClient(
      new OpenRouterProvider('k'),
      replies({ content: null, reasoning: '   ' }) as never,
    );

    await expect(provider.completeStructured(request())).rejects.toThrow(
      /failed schema validation for Intent/,
    );
  });
});

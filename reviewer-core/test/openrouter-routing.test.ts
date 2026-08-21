import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * Which backend OpenRouter is allowed to route to.
 *
 * One slug is served by several providers with different feature sets —
 * `z-ai/glm-4.7-flash` is currently on four, and one of them advertises
 * `structured_outputs: false`. A request that lands there fails outright, at a
 * frequency set by OpenRouter's load balancing rather than by anything in this
 * repo, which is the worst possible shape for a bug. `require_parameters` tells
 * OpenRouter to consider only endpoints supporting every parameter sent, which
 * is exactly what `response_format: json_schema, strict: true` needs.
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

describe('OpenRouter provider routing constraint', () => {
  it('asks for the fastest surviving endpoint, not the cheapest', async () => {
    // `require_parameters` narrows the set; nothing ordered it. Measured
    // 2026-08-20 on `deepseek/deepseek-v4-flash`, which OpenRouter serves from
    // eighteen backends: two same-shaped calls landed on two of them and ran at
    // 5 tokens in 0.78s and 93 tokens in 16.3s — about 5.7 tok/s on the second.
    // The brief's 45s clock does not fit a real answer at that rate, and the
    // onboarding tour missed a 219s clock three times running for the same
    // reason. `sort: 'throughput'` orders what survives the filter.
    const provider = new OpenRouterProvider('k');
    const bodies = capture(provider);

    await provider.completeStructured(request());

    expect(bodies[0]?.provider).toMatchObject({ sort: 'throughput' });
  });

  it('sends provider.require_parameters on every OpenRouter request', async () => {
    const provider = new OpenRouterProvider('k');
    const bodies = capture(provider);

    await provider.completeStructured(request());

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.provider).toEqual({ require_parameters: true, sort: 'throughput' });
  });

  it('sends it alongside the strict json_schema it exists to protect', async () => {
    const provider = new OpenRouterProvider('k');
    const bodies = capture(provider);

    await provider.completeStructured(request());

    expect(bodies[0]?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'Intent', strict: true },
    });
    expect(bodies[0]?.provider).toEqual({ require_parameters: true, sort: 'throughput' });
  });

  /**
   * The same class drives a plain OpenAI-compatible baseURL under `id: 'openai'`
   * (the CI runner's path). `provider` is an OpenRouter extension and OpenAI
   * rejects unknown body fields, so it must not leak there — the same guard the
   * neighbouring `session_id` and `usage` fields already carry.
   */
  it('does NOT send it when the provider is not OpenRouter', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openai' });
    const bodies = capture(provider);

    await provider.completeStructured(request());

    expect(bodies[0]).not.toHaveProperty('provider');
    expect(bodies[0]).not.toHaveProperty('usage');
  });

  it('keeps the constraint on every repair attempt, not just the first', async () => {
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

    await provider.completeStructured(request());

    expect(bodies).toHaveLength(2);
    for (const body of bodies)
      expect(body.provider).toEqual({ require_parameters: true, sort: 'throughput' });
  });
});

import { describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import type { ToolTextResult } from '../src/errors.js';
import { listAgents } from '../src/tools/list-agents.js';

const BASE = 'http://127.0.0.1:3001';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const client = (body: unknown) =>
  new ApiClient({
    baseUrl: BASE,
    fetchImpl: (async (input) => {
      if (new URL(String(input)).pathname !== '/agents') throw new Error('unexpected request');
      return json(body);
    }) as FetchLike,
  });

const payload = (result: ToolTextResult) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>;

describe('list_agents', () => {
  it('returns every agent, disabled included, without the system prompt', async () => {
    const body = payload(
      await listAgents(
        client([
          {
            id: 'a1',
            name: 'Security Reviewer',
            description: 'Finds security problems',
            provider: 'openai',
            model: 'gpt-4o',
            system_prompt: 'THOUSANDS-OF-TOKENS',
            enabled: true,
            version: 2,
          },
          {
            id: 'a2',
            name: 'Perf',
            description: 'Finds slow code',
            provider: 'openai',
            model: 'gpt-4o-mini',
            system_prompt: 'MORE-THOUSANDS',
            enabled: false,
          },
        ]),
      ),
    );

    expect(body.agents).toEqual([
      {
        name: 'Security Reviewer',
        description: 'Finds security problems',
        model: 'gpt-4o',
        enabled: true,
      },
      { name: 'Perf', description: 'Finds slow code', model: 'gpt-4o-mini', enabled: false },
    ]);
    // The single largest field on the contract must never reach a tool result.
    expect(JSON.stringify(body)).not.toContain('THOUSANDS');
    expect(body).not.toHaveProperty('note');
  });

  it('explains an empty list instead of returning a bare []', async () => {
    const result = await listAgents(client([]));
    expect(result.isError).toBe(false);
    const body = payload(result);
    expect(body.agents).toEqual([]);
    expect(body.note).toContain('Ask the user to create one');
  });
});

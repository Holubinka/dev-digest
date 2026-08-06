/**
 * `IntentService` reaching its ports — no Postgres, no clone, no `src/prompts`.
 *
 * This file is the point of the `PromptTemplates` port. The service used to
 * call `platform/prompts.ts`, which reads `node:fs`, so the only way to change
 * the instructions a test ran against was to change a file on disk.
 * `no-fs-in-service` did not object: it matches a direct `node:fs` edge from a
 * `service.ts`, and the hop through a loader module satisfies the rule while
 * breaking what it stands for. A test that swaps the template is the proof the
 * hop is gone.
 */
import { describe, it, expect } from 'vitest';
import type { StructuredRequest, StructuredResult } from '@devdigest/shared';
import { MockGitClient, MockPromptTemplates } from '../src/adapters/mocks.js';
import { IntentService } from '../src/modules/intent/service.js';
import { INTENT_SYSTEM_PROMPT } from '../src/modules/intent/constants.js';
import type { IntentContainer } from '../src/modules/intent/types.js';
import type { IntentRepository } from '../src/modules/intent/repository.js';

const PULL = {
  id: 'pr-1',
  repoId: 'repo-1',
  title: 'Rate-limit the public pricing API',
  body: 'Adds a per-token limiter.',
  linkedIssue: null,
};

const ANSWER = {
  intent: 'Rate-limit the public pricing API',
  in_scope: ['Add a per-token limiter'],
  out_of_scope: [],
  risk_areas: ['performance'],
};

/** Enough of `IntentRepository` for one derivation, and nothing else. */
const repo = (): IntentRepository =>
  ({
    getPull: async () => PULL,
    getRepo: async () => ({ id: 'repo-1', owner: 'acme', name: 'payments-api' }),
    getCommitMessages: async () => ['feat: limiter'],
    getFilePaths: async () => ['src/limiter.ts'],
    getIntent: async () => null,
    upsertIntent: async (prId: string, row: Record<string, unknown>) => ({
      prId,
      ...row,
      computedAt: new Date('2026-08-06T00:00:00.000Z'),
    }),
  }) as unknown as IntentRepository;

/** Captures the request instead of calling anything. */
function container(prompts: MockPromptTemplates) {
  const seen: StructuredRequest<unknown>[] = [];
  const c = {
    git: new MockGitClient(),
    prompts,
    settingsRepo: { value: async () => undefined },
    llm: async () => ({
      completeStructured: async <T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
        seen.push(req as StructuredRequest<unknown>);
        return { data: ANSWER as T, tokensIn: 10, tokensOut: 20, costUsd: 0.001 };
      },
    }),
  } as unknown as IntentContainer;
  return { container: c, seen };
}

describe('IntentService — the system prompt arrives through the port', () => {
  it('sends whatever the PromptTemplates port returns, having touched no file', async () => {
    const { container: c, seen } = container(
      new MockPromptTemplates({ [INTENT_SYSTEM_PROMPT]: 'You classify intent. {{unused}}' }),
    );

    const result = await new IntentService(c, repo()).derive({
      workspaceId: 'ws-1',
      prId: 'pr-1',
    });

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.messages[0]).toEqual({
      role: 'system',
      content: 'You classify intent. {{unused}}',
    });
  });

  /**
   * The template name is a constant in the service, so pinning it here is what
   * turns a rename of `src/prompts/*.md` into a failing test rather than a
   * `[mock prompt: …]` string reaching a real provider.
   */
  it('asks for the template the constant names', async () => {
    const asked: string[] = [];
    const prompts = new MockPromptTemplates({});
    const render = prompts.render.bind(prompts);
    prompts.render = async (name, vars) => {
      asked.push(name);
      return render(name, vars);
    };

    const { container: c } = container(prompts);
    await new IntentService(c, repo()).derive({ workspaceId: 'ws-1', prId: 'pr-1' });

    expect(asked).toEqual([INTENT_SYSTEM_PROMPT]);
  });
});

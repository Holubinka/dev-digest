import { describe, it, expect } from 'vitest';
import { AgentListItem } from '@devdigest/shared';
import { toAgentListItemDto } from '../src/modules/agents/helpers.js';
import type { AgentRow } from '../src/db/rows.js';

/**
 * The mapper behind the Agents list badge. Expected shape comes from the
 * `AgentListItem` contract in `vendor/shared/contracts/knowledge.ts`, not from
 * what the mapper happens to return. The query that produces the count is
 * covered by `agents-skill-count.it.test.ts` — it needs a real Postgres.
 */

const ROW: AgentRow = {
  id: '3f0c9a2e-1b44-4d21-9f0a-6c2f8b7d1e55',
  workspaceId: '9d1e7b30-55aa-4c60-8f2b-0e4a13c7f902',
  name: 'Security Reviewer',
  description: 'Flags secrets and injection paths.',
  // Deliberately none of the contract defaults (single-pass / critical / true):
  // a mapper that dropped the row value and let Zod fill in the default would
  // still look right against a default-shaped fixture.
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  systemPrompt: 'Review the diff for security defects.',
  outputSchema: null,
  strategy: 'map-reduce',
  ciFailOn: 'warning',
  repoIntel: false,
  enabled: false,
  version: 4,
  createdBy: '41c8b6a5-9f2d-4e18-b70c-2a5d9e3f8114',
  createdAt: new Date('2026-08-03T10:00:00.000Z'),
};

describe('toAgentListItemDto', () => {
  it('maps the counted row onto the AgentListItem shape the contract declares', () => {
    expect(toAgentListItemDto({ agent: ROW, skillCount: 3 })).toEqual({
      id: '3f0c9a2e-1b44-4d21-9f0a-6c2f8b7d1e55',
      name: 'Security Reviewer',
      description: 'Flags secrets and injection paths.',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      system_prompt: 'Review the diff for security defects.',
      output_schema: null,
      enabled: false,
      version: 4,
      strategy: 'map-reduce',
      ci_fail_on: 'warning',
      repo_intel: false,
      skill_count: 3,
    });
  });

  it('returns a row the contract accepts, carrying nothing the contract omits', () => {
    // AgentListItem is a stripping z.object: anything outside it disappears on
    // parse, so an equal round-trip proves both validity and no extra keys.
    const dto = toAgentListItemDto({ agent: ROW, skillCount: 3 });
    expect(AgentListItem.parse(dto)).toEqual(dto);
  });

  it('reports an agent that binds nothing as 0 rather than omitting the key', () => {
    // The card renders the badge unconditionally, so an absent key would read
    // as "undefined skills" instead of "No skills".
    expect(toAgentListItemDto({ agent: ROW, skillCount: 0 })).toHaveProperty('skill_count', 0);
  });

  it('keeps tenancy and audit columns out — the list route re-serialises nothing', () => {
    const dto: Record<string, unknown> = toAgentListItemDto({ agent: ROW, skillCount: 1 });
    expect(dto).not.toHaveProperty('workspaceId');
    expect(dto).not.toHaveProperty('createdBy');
    expect(dto).not.toHaveProperty('createdAt');
  });
});

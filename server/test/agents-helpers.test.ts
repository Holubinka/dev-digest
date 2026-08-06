import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { Agent, AgentVersion } from '@devdigest/shared';
import {
  isConfigChange,
  toAgentDto,
  toAgentVersionDto,
  type ConfigChangePatch,
} from '../src/modules/agents/helpers.js';
import type { UpdateAgent } from '../src/modules/agents/repository.js';
import type { AgentRow, AgentVersionRow } from '../src/db/rows.js';

/**
 * Core-ring helpers of the agents module: row → DTO mapping and the
 * config-version-bump rule. Expected shapes come from the Zod contracts in
 * `vendor/shared/contracts/knowledge.ts` (`Agent`, `AgentVersion`,
 * `AgentVersionConfig`), not from what the mappers happen to return.
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

describe('toAgentDto', () => {
  it('maps the camelCase row onto the snake_case shape the Agent contract declares', () => {
    expect(toAgentDto(ROW)).toEqual({
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
    });
  });

  it('returns a DTO the contract accepts, carrying nothing the contract omits', () => {
    const dto = toAgentDto(ROW);
    // Agent is a stripping z.object: anything outside the contract disappears
    // on parse, so an equal round-trip proves both validity and no extra keys.
    expect(Agent.parse(dto)).toEqual(dto);
  });

  it('keeps tenancy and audit columns out — no route re-serialises this DTO', () => {
    // `GET /agents/:id` declares no `schema.response` (agents/routes.ts:79-84),
    // so whatever this mapper returns is what the client receives verbatim.
    const dto: Record<string, unknown> = toAgentDto(ROW);
    expect(dto).not.toHaveProperty('workspaceId');
    expect(dto).not.toHaveProperty('createdBy');
    expect(dto).not.toHaveProperty('createdAt');
  });

  it('reports an absent output_schema as null rather than dropping the key', () => {
    expect(toAgentDto(ROW)).toHaveProperty('output_schema', null);
  });

  it('passes a stored output_schema through untouched', () => {
    const schema = { type: 'object', properties: { verdict: { type: 'string' } } };
    expect(toAgentDto({ ...ROW, outputSchema: schema }).output_schema).toEqual(schema);
  });

  it('carries the row own strategy, gate and toggles instead of the contract defaults', () => {
    expect(toAgentDto({ ...ROW, strategy: 'auto', ciFailOn: 'never' })).toMatchObject({
      strategy: 'auto',
      ci_fail_on: 'never',
      repo_intel: false,
      enabled: false,
    });
    expect(toAgentDto({ ...ROW, repoIntel: true, enabled: true })).toMatchObject({
      repo_intel: true,
      enabled: true,
    });
  });
});

const CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  system_prompt: 'Review the diff.',
  output_schema: null,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
  skills: ['0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d'],
};

const VERSION_ROW: AgentVersionRow = {
  agentId: '3f0c9a2e-1b44-4d21-9f0a-6c2f8b7d1e55',
  version: 2,
  configJson: CONFIG,
  createdAt: new Date('2026-08-03T10:00:00.000Z'),
};

describe('toAgentVersionDto', () => {
  it('maps the snapshot row onto the AgentVersion contract, timestamp as an ISO string', () => {
    const dto = toAgentVersionDto(VERSION_ROW);
    expect(dto).toEqual({
      agent_id: '3f0c9a2e-1b44-4d21-9f0a-6c2f8b7d1e55',
      version: 2,
      config: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
        output_schema: null,
        strategy: 'single-pass',
        ci_fail_on: 'critical',
        repo_intel: true,
        skills: ['0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d'],
      },
      created_at: '2026-08-03T10:00:00.000Z',
    });
    // The contract types created_at as z.string(); a Date would parse-fail here.
    expect(AgentVersion.parse(dto)).toEqual(dto);
  });

  it('drops a key AgentVersionConfig does not declare instead of forwarding the blob', () => {
    const dto = toAgentVersionDto({
      ...VERSION_ROW,
      configJson: { ...CONFIG, api_key: 'sk-live-should-never-reach-a-client' },
    });
    expect(dto.config).not.toHaveProperty('api_key');
  });

  it.each<[string, unknown]>([
    ['a provider outside the enum', { ...CONFIG, provider: 'gemini' }],
    ['a strategy outside the enum', { ...CONFIG, strategy: 'streaming' }],
    ['a gate policy outside the enum', { ...CONFIG, ci_fail_on: 'always' }],
    ['a snapshot with no skills list', { ...CONFIG, skills: undefined }],
    ['a non-object blob', 'single-pass'],
  ])('throws on %s rather than serving an unvalidated snapshot', (_label, configJson) => {
    expect(() => toAgentVersionDto({ ...VERSION_ROW, configJson })).toThrow(ZodError);
  });
});

const EXISTING: Parameters<typeof isConfigChange>[0] = {
  name: 'Security Reviewer',
  description: 'Flags secrets and injection paths.',
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  systemPrompt: 'Review the diff for security defects.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
};

const CHANGED: Array<[string, ConfigChangePatch]> = [
  ['name', { name: 'Renamed Reviewer' }],
  ['description', { description: 'Something else entirely.' }],
  ['provider', { provider: 'openai' }],
  ['model', { model: 'gpt-4o' }],
  ['systemPrompt', { systemPrompt: 'Review only the tests.' }],
  ['strategy', { strategy: 'map-reduce' }],
  ['ciFailOn', { ciFailOn: 'any' }],
  ['repoIntel', { repoIntel: false }],
];

const UNCHANGED: Array<[string, ConfigChangePatch]> = [
  ['name', { name: EXISTING.name }],
  ['description', { description: EXISTING.description }],
  ['provider', { provider: EXISTING.provider }],
  ['model', { model: EXISTING.model }],
  ['systemPrompt', { systemPrompt: EXISTING.systemPrompt }],
  ['strategy', { strategy: EXISTING.strategy }],
  ['ciFailOn', { ciFailOn: EXISTING.ciFailOn }],
  ['repoIntel', { repoIntel: EXISTING.repoIntel }],
];

describe('isConfigChange', () => {
  it.each(CHANGED)('a different %s is a config change — version bumps, snapshot written', (
    _field,
    patch,
  ) => {
    expect(isConfigChange(EXISTING, patch)).toBe(true);
  });

  it.each(UNCHANGED)('re-sending the current %s is not a config change', (_field, patch) => {
    expect(isConfigChange(EXISTING, patch)).toBe(false);
  });

  it('the whole editor form re-sent unchanged leaves the version alone', () => {
    // The Agent Editor PUTs every field, not just the dirty ones. Bumping on
    // that would add an identical agent_versions row on every save.
    expect(
      isConfigChange(EXISTING, {
        name: EXISTING.name,
        description: EXISTING.description,
        provider: EXISTING.provider,
        model: EXISTING.model,
        systemPrompt: EXISTING.systemPrompt,
        strategy: EXISTING.strategy,
        ciFailOn: EXISTING.ciFailOn,
        repoIntel: EXISTING.repoIntel,
      }),
    ).toBe(false);
  });

  it('an empty patch is not a config change', () => {
    expect(isConfigChange(EXISTING, {})).toBe(false);
  });

  it('toggling enabled alone is not a config change', () => {
    // The repository hands its whole UpdateAgent patch to this helper
    // (agents/repository.ts:121), `enabled` included.
    const enabledOnly: UpdateAgent = { enabled: false };
    expect(isConfigChange(EXISTING, enabledOnly)).toBe(false);
  });

  it('one changed field alongside an enabled toggle still counts', () => {
    const patch: UpdateAgent = { enabled: false, model: 'gpt-4o' };
    expect(isConfigChange(EXISTING, patch)).toBe(true);
  });

  it('setting or clearing output_schema is a config change', () => {
    expect(isConfigChange(EXISTING, { outputSchema: { type: 'object' } })).toBe(true);
    expect(isConfigChange(EXISTING, { outputSchema: null })).toBe(true);
  });
});

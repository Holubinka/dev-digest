import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentListItem } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-skill-count] Docker not available — skipping integration tests.');
}

/**
 * `GET /agents` carries how many skills each agent binds — the number the Agents
 * list badge renders. Covers: an agent that binds nothing reports 0 and still
 * appears, binding and unbinding move the count, and a link to a skill from
 * another workspace is not counted.
 */
d('GET /agents — skill_count', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function createAgent(app: App): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Counted Agent ${++seq}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function createSkill(app: App): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `Counted Skill ${++seq}`,
        type: 'rubric',
        body: '# Rubric\nList every branch the diff adds.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  /**
   * The list row for one agent, parsed through the contract — so a response
   * missing `skill_count` fails here rather than reaching a card as `undefined`.
   */
  async function listRow(app: App, agentId: string) {
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    const rows = AgentListItem.array().parse(res.json());
    const row = rows.find((a) => a.id === agentId);
    expect(row, `agent ${agentId} missing from GET /agents`).toBeDefined();
    return row!;
  }

  it('an agent that binds nothing reports 0 and still appears in the list', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    expect((await listRow(app, agentId)).skill_count).toBe(0);
  });

  it('counts the skills bound to that agent and nobody else', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const otherAgentId = await createAgent(app);
    const skillIds = [await createSkill(app), await createSkill(app)];

    const bound = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: skillIds },
    });
    expect(bound.statusCode).toBe(200);

    expect((await listRow(app, agentId)).skill_count).toBe(2);
    expect((await listRow(app, otherAgentId)).skill_count).toBe(0);
  });

  it('follows an unbind back down — the set POST is the only writer', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const keep = await createSkill(app);
    const drop = await createSkill(app);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [keep, drop] },
    });
    expect((await listRow(app, agentId)).skill_count).toBe(2);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [keep] },
    });
    expect((await listRow(app, agentId)).skill_count).toBe(1);
  });

  it('does not count a link to a skill from another workspace', async () => {
    // `AgentsService` refuses to create such a link, so this one is written
    // straight to the table: `agent_skills`'s foreign key proves the skill id
    // exists, not that this workspace can see it, and `linkedSkills` already
    // re-checks tenancy before a body becomes a prompt block. The count has to
    // agree with it, or the badge promises a skill the Skills tab never lists.
    const app = await makeApp();
    const agentId = await createAgent(app);
    const ownSkillId = await createSkill(app);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [ownSkillId] },
    });

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'Other Workspace' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Skill',
        description: 'Belongs to another tenant.',
        type: 'rubric',
        source: 'manual',
        body: '# Not ours',
      })
      .returning();
    await pg.handle.db
      .insert(t.agentSkills)
      .values({ agentId, skillId: foreign!.id, order: 1 });

    expect(otherWs!.id).not.toBe(workspaceId);
    expect((await listRow(app, agentId)).skill_count).toBe(1);
  });
});

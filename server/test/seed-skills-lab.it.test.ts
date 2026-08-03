import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[seed-skills-lab] Docker not available — skipping integration tests.');
}

/**
 * The seeded half of the control experiment: two agents that carry no checklist,
 * the four skills that supply one, their bindings, and two fixture PRs whose
 * diffs are reconstructed from stored patches with no network involved.
 *
 * The grounding assertion is the load-bearing one. A finding about an untested
 * branch has to cite the branch, and `groundFindings` deletes any finding whose
 * range misses a hunk — so if these fixtures ever stop putting every interesting
 * line inside a hunk, the experiment silently stops working.
 */
d('skills-lab seed fixtures', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const agentNamed = async (name: string) => {
    const [row] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, name)));
    return row;
  };

  it('seeds both reviewers with repo-intel off, so skills are the only variable', async () => {
    for (const name of ['Test Quality Reviewer', 'API Contract Reviewer']) {
      const agent = await agentNamed(name);
      expect(agent, `${name} should be seeded`).toBeDefined();
      expect(agent!.repoIntel).toBe(false);
      expect(agent!.systemPrompt).toContain('# Citation rule');
    }
  });

  it('keeps the enumerable checklist OUT of the prompts and IN the skills', async () => {
    // If this ever fails, the baseline run will find the defect on its own and
    // the before/after shows nothing. See docs/agent-prompts/README.md.
    const testQuality = await agentNamed('Test Quality Reviewer');
    expect(testQuality!.systemPrompt).not.toContain('List every branch');

    const [rubric] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(
        and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'Uncovered branch rubric')),
      );
    expect(rubric!.body).toContain('List every branch');
  });

  it('binds two skills to each reviewer, in prompt order', async () => {
    const expected: Record<string, string[]> = {
      'Test Quality Reviewer': ['Uncovered branch rubric', 'Test smell catalogue'],
      'API Contract Reviewer': ['Breaking change taxonomy', 'Route signature checklist'],
    };
    for (const [agentName, skillNames] of Object.entries(expected)) {
      const agent = await agentNamed(agentName);
      const rows = await pg.handle.db
        .select({ name: t.skills.name, order: t.agentSkills.order })
        .from(t.agentSkills)
        .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
        .where(eq(t.agentSkills.agentId, agent!.id))
        .orderBy(t.agentSkills.order);
      expect(rows.map((r) => r.name)).toEqual(skillNames);
      expect(rows.map((r) => r.order)).toEqual([0, 1]);
    }
  });

  it('records version 1 of every seeded skill body', async () => {
    const skills = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));
    expect(skills).toHaveLength(4);
    for (const skill of skills) {
      const versions = await pg.handle.db
        .select()
        .from(t.skillVersions)
        .where(eq(t.skillVersions.skillId, skill.id));
      expect(versions).toHaveLength(1);
      expect(versions[0]!.body).toBe(skill.body);
    }
  });

  it('rebuilds PR #101 offline, with every untested branch inside a hunk', async () => {
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 101)));

    const diff = await diffFromPrFiles(new ReviewRepository(pg.handle.db), pr!.id);
    const pricing = diff.files.find((f) => f.path === 'src/pricing.ts');
    expect(pricing, 'the fixture must reconstruct without a clone or a network').toBeDefined();

    // Every line of an added file is inside a hunk, so a finding citing the
    // uncovered `TENTH` branch survives grounding.
    const covered = new Set(pricing!.hunks.flatMap((h) => h.newLineNumbers));
    for (const line of [7, 10, 13, 16]) expect(covered.has(line)).toBe(true);

    expect(diff.raw).toContain("if (code === 'TENTH')");
    expect(diff.raw).toContain('throw new Error');

    // The single test that ships exercises HALF and nothing else — which is the
    // whole point of the fixture, so assert it on the test file rather than on
    // the diff as a whole (the source file naturally mentions every branch).
    const files = await new ReviewRepository(pg.handle.db).getPrFiles(pr!.id);
    const testPatch = files.find((f) => f.path === 'test/pricing.test.ts')?.patch ?? '';
    expect(testPatch).toContain('halves the total for HALF');
    expect(testPatch).not.toContain('TENTH');
    expect(testPatch).not.toContain('throw');
  });

  it('rebuilds PR #103, where every branch is tested and nothing is asserted', async () => {
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 103)));

    const diff = await diffFromPrFiles(new ReviewRepository(pg.handle.db), pr!.id);
    const files = await new ReviewRepository(pg.handle.db).getPrFiles(pr!.id);
    const testPatch = files.find((f) => f.path === 'test/invoice.test.ts')?.patch ?? '';

    // Both branches ARE exercised — a rubric that only enumerates branches finds
    // nothing here, which is the whole point of this fixture.
    expect(testPatch).toContain('rejects a negative subtotal');
    expect(testPatch).toContain("totalWithTax(100, 'EU')");

    // And yet no test asserts the value the function returns.
    expect(testPatch).toContain('toHaveBeenCalledWith');
    expect(testPatch).toContain("expect(typeof total).toBe('number')");
    expect(testPatch).not.toMatch(/toBe\(\s*\d/);

    // The rounding really is wrong, so the smells are load-bearing rather than
    // stylistic: 100 at 20% returns 1.2, and the suite stays green.
    expect(diff.raw).toContain('Math.round(subtotal * (1 + rate)) / 100');
  });

  it('rebuilds PR #102 with the rename and the response change on changed lines', async () => {
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 102)));

    const diff = await diffFromPrFiles(new ReviewRepository(pg.handle.db), pr!.id);
    expect(diff.files.map((f) => f.path).sort()).toEqual([
      'docs/api.md',
      'src/modules/search/routes.ts',
    ]);
    expect(diff.raw).toContain('-const Query = z.object({ q: z.string() });');
    expect(diff.raw).toContain('-    return { results, total: results.length };');
    expect(diff.raw).toContain('+    return { items };');
    // The docs gained `limit` but still describe `q` and `results` — the second,
    // weaker finding the API Contract skills should surface.
    expect(diff.raw).toContain('+| limit | number | page size, defaults to 20 |');
    expect(diff.raw).toContain('Returns { results, total }.');
  });

  it('is idempotent: seeding twice changes nothing', async () => {
    const before = {
      agents: (await pg.handle.db.select().from(t.agents)).length,
      skills: (await pg.handle.db.select().from(t.skills)).length,
      links: (await pg.handle.db.select().from(t.agentSkills)).length,
      prs: (await pg.handle.db.select().from(t.pullRequests)).length,
      files: (await pg.handle.db.select().from(t.prFiles)).length,
    };
    await seed(pg.handle.db);
    const after = {
      agents: (await pg.handle.db.select().from(t.agents)).length,
      skills: (await pg.handle.db.select().from(t.skills)).length,
      links: (await pg.handle.db.select().from(t.agentSkills)).length,
      prs: (await pg.handle.db.select().from(t.pullRequests)).length,
      files: (await pg.handle.db.select().from(t.prFiles)).length,
    };
    expect(after).toEqual(before);
  });

  it('seeds no findings on the fixtures — every one shown comes from a real run', async () => {
    const prs = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.branch, 'feat/discounts'));
    const reviews = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.prId, prs[0]!.id));
    expect(reviews).toHaveLength(0);
  });
});

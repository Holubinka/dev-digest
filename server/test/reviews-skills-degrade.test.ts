import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';

/**
 * Skills are best-effort in the prompt: if the binding lookup fails, the review
 * degrades to the pre-skills prompt rather than failing the run. That is a
 * deliberate choice someone will rely on, and nothing exercised it — a lookup
 * that started throwing would have taken every review down with it.
 *
 * Reached through a cast because it is private, and private is right: no other
 * module should be assembling this slot. The alternative is exporting a seam
 * that exists only for the test.
 */

type SkillBuilder = {
  buildSkillBodies(agentId: string, log: { info(msg: string): void }): Promise<string[]>;
};

function executorWith(linkedSkills: () => Promise<unknown>) {
  const container = { tokenizer: { count: (s: string) => s.length } } as unknown as Container;
  const agents = { linkedSkills } as unknown as Container['agentsRepo'];
  const executor = new ReviewRunExecutor(container, {} as ReviewRepository, agents);
  return executor as unknown as SkillBuilder;
}

const logger = () => {
  const lines: string[] = [];
  return { lines, info: (msg: string) => lines.push(msg) };
};

describe('buildSkillBodies when the binding lookup fails', () => {
  it('returns no bodies instead of throwing', async () => {
    const executor = executorWith(() => Promise.reject(new Error('connection terminated')));
    await expect(executor.buildSkillBodies('ag-1', logger())).resolves.toEqual([]);
  });

  it('says in the run log why the prompt has no skills', async () => {
    const log = logger();
    const executor = executorWith(() => Promise.reject(new Error('connection terminated')));

    await executor.buildSkillBodies('ag-1', log);

    expect(log.lines).toContainEqual('skills: lookup failed — connection terminated');
    // Not the attached line: nothing was attached.
    expect(log.lines.some((l) => l.startsWith('skills: 1 skill'))).toBe(false);
  });

  it('still attaches what it found when the lookup works', async () => {
    const executor = executorWith(() =>
      Promise.resolve([
        { order: 0, skill: { id: 's1', name: 'Rubric', body: '# Rubric', enabled: true } },
      ]),
    );
    const log = logger();

    await expect(executor.buildSkillBodies('ag-1', log)).resolves.toEqual(['# Rubric']);
    expect(log.lines).toContainEqual(
      expect.stringMatching(/^skills: 1 skill\(s\), \d+ token\(s\) attached — Rubric$/),
    );
  });

  it('logs nothing at all when the agent simply binds none', async () => {
    const log = logger();
    const executor = executorWith(() => Promise.resolve([]));

    await expect(executor.buildSkillBodies('ag-1', log)).resolves.toEqual([]);
    expect(log.lines).toEqual([]);
  });

  it('does not count a disabled binding as a failure', async () => {
    const log = logger();
    const executor = executorWith(() =>
      Promise.resolve([
        { order: 0, skill: { id: 's1', name: 'Off', body: '# Off', enabled: false } },
      ]),
    );

    await expect(executor.buildSkillBodies('ag-1', log)).resolves.toEqual([]);
    expect(log.lines.some((l) => l.includes('lookup failed'))).toBe(false);
  });

  it('asks the tokenizer for the real count rather than estimating', async () => {
    const count = vi.fn((s: string) => s.length);
    const container = { tokenizer: { count } } as unknown as Container;
    const agents = {
      linkedSkills: () =>
        Promise.resolve([
          { order: 0, skill: { id: 's1', name: 'Rubric', body: '# Rubric', enabled: true } },
        ]),
    } as unknown as Container['agentsRepo'];
    const executor = new ReviewRunExecutor(
      container,
      {} as ReviewRepository,
      agents,
    ) as unknown as SkillBuilder;

    await executor.buildSkillBodies('ag-1', logger());
    expect(count).toHaveBeenCalledWith('# Rubric');
  });
});

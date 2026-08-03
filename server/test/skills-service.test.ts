import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import type { InsertSkill, SkillsRepository } from '../src/modules/skills/repository.js';
import type { SkillRow } from '../src/db/rows.js';
import { SkillsService } from '../src/modules/skills/service.js';

/**
 * The create invariant, exercised through the constructor seam rather than a
 * database. A skill body is spliced into an agent's prompt as an instruction,
 * so a body that did not originate in this workspace has to land disabled — and
 * that decision must not be delegated to whatever the request asked for.
 */

/** A repository that records every insert and echoes it back as a row. */
function recordingRepo() {
  const inserted: InsertSkill[] = [];
  const repo = {
    async insert(values: InsertSkill): Promise<SkillRow> {
      inserted.push(values);
      return {
        id: 'skill-1',
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? '',
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled,
        version: 1,
        evidenceFiles: values.evidenceFiles ?? null,
        createdAt: new Date(0),
      };
    },
  } as unknown as SkillsRepository;
  return { repo, inserted };
}

const serviceWith = (repo: SkillsRepository) => new SkillsService({} as Container, repo);

const BASE = { name: 'Flakiness patterns', type: 'convention' as const, body: '# Rules' };

describe('SkillsService.create', () => {
  it('defaults an unlabelled skill to manual, and manual to enabled', async () => {
    const { repo, inserted } = recordingRepo();
    const skill = await serviceWith(repo).create('ws-1', BASE);
    expect(inserted[0]?.source).toBe('manual');
    expect(skill.enabled).toBe(true);
  });

  it('lets a manual skill be created disabled', async () => {
    const { repo } = recordingRepo();
    const skill = await serviceWith(repo).create('ws-1', { ...BASE, enabled: false });
    expect(skill.enabled).toBe(false);
  });

  it.each(['imported_file', 'imported_url', 'community', 'extracted'] as const)(
    'stores a %s skill disabled even when the request asks for enabled',
    async (source) => {
      const { repo, inserted } = recordingRepo();
      const skill = await serviceWith(repo).create('ws-1', { ...BASE, source, enabled: true });
      expect(inserted[0]?.enabled).toBe(false);
      expect(skill.enabled).toBe(false);
    },
  );
});

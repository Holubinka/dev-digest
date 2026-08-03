import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillListItem,
  SkillSource,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillListItemDto, toSkillVersionDto } from './helpers.js';
import {
  filenameFromUrl,
  isMarkdownFilename,
  looksLikeArchive,
  previewFromArchive,
  previewFromDocument,
} from './import.js';

/**
 * Skills service. A skill is a named markdown block that agents bind, order and
 * toggle; its body is spliced into the assembled prompt. Body edits are
 * versioned via `skill_versions` (repository).
 *
 * The repository arrives as a parameter with a default, so a unit test can pass
 * a fake without a database.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsService {
  constructor(
    private container: Container,
    private repo: SkillsRepository = new SkillsRepository(container.db),
  ) {}

  async list(workspaceId: string): Promise<SkillListItem[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillListItemDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Create a skill.
   *
   * A body reaches the model as INSTRUCTIONS — `assemblePrompt` joins skill
   * bodies raw, with no `<untrusted>` wrapper — so nothing but a human reading
   * it stands between an upload and the prompt. Anything that did not originate
   * in this workspace therefore lands disabled whatever the client asked for.
   * `source` is a provenance label, never a security control, which is why the
   * decision is made here and not trusted from the request.
   */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const source = input.source ?? 'manual';
    const enabled = source === 'manual' ? (input.enabled ?? true) : false;
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      type: input.type,
      source,
      body: input.body,
      enabled,
      ...(input.evidence_files !== undefined ? { evidenceFiles: input.evidence_files } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Delete a skill (and its versions and agent bindings, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Body history, newest first. `undefined` when the skill is not in the
   *  workspace — the caller turns that into a 404. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(id, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /**
   * Parse an upload into a draft. **Writes nothing** — the client shows the
   * result, lets the user edit it, and only then posts to `POST /skills`. That
   * split is the product requirement (save only after confirmation) and it also
   * means an import that is never confirmed leaves no trace to clean up.
   */
  previewImportFile(file: { filename: string; bytes: Uint8Array }): SkillImportPreview {
    if (looksLikeArchive(file.filename, file.bytes)) return previewFromArchive(file.bytes);
    if (!isMarkdownFilename(file.filename)) {
      throw new ValidationError('Upload a .md, .markdown or .zip file');
    }
    return previewFromDocument({
      filename: file.filename,
      text: new TextDecoder().decode(file.bytes),
      bytes: file.bytes.byteLength,
      source: 'imported_file',
    });
  }

  /** The same draft, from a URL. The fetcher owns refusing an unsafe address. */
  async previewImportUrl(url: string): Promise<SkillImportPreview> {
    const fetched = await this.container.skillFetcher.fetchMarkdown(url);
    return previewFromDocument({
      filename: filenameFromUrl(fetched.finalUrl),
      text: fetched.text,
      bytes: fetched.bytes,
      source: 'imported_url',
    });
  }
}

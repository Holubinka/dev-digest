import { z } from 'zod';
import { Skill, SkillType, SkillSource } from './knowledge.js';

/**
 * Skills API — the shapes the `/skills` routes exchange that the stored `Skill`
 * itself does not cover: an import preview, a list row, and a body snapshot.
 */

/**
 * Why an archive entry did not become part of the skill. An `executable` entry
 * is never inflated: the reason is decided from the name and the declared size
 * in the zip's central directory, before any decompression happens.
 */
export const SkillSkipReason = z.enum([
  'executable',
  'not_markdown',
  'unsafe_path',
  'too_large',
]);
export type SkillSkipReason = z.infer<typeof SkillSkipReason>;

export const SkillSkippedEntry = z.object({
  path: z.string(),
  reason: SkillSkipReason,
});
export type SkillSkippedEntry = z.infer<typeof SkillSkippedEntry>;

/**
 * A parsed but UNSAVED skill. `POST /skills/import/preview` and
 * `POST /skills/import/url` return this and write nothing; the client posts the
 * (possibly edited) fields to `POST /skills` once the user has confirmed them.
 *
 * `enabled` is pinned false here and pinned again server-side on create. A skill
 * body reaches the model as instructions, not as delimiter-wrapped data, so
 * nothing but a human reading it stands between an upload and the prompt.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.literal(false),
  /** Every readable markdown path found, whether or not it became the body. */
  evidence_files: z.array(z.string()),
  /** The entry the body came from. For a bare `.md` upload, its filename. */
  core_path: z.string(),
  skipped: z.array(SkillSkippedEntry),
  bytes: z.number().int(),
  warnings: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

/**
 * A row of `GET /skills`. `agent_count` is a join rather than a column, so it
 * lives here instead of on `Skill` — the single-skill routes stay a plain read.
 */
export const SkillListItem = Skill.extend({
  agent_count: z.number().int(),
});
export type SkillListItem = z.infer<typeof SkillListItem>;

/** One immutable body snapshot from `skill_versions`. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

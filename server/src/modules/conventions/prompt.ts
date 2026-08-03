import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';
import { MAX_CANDIDATES, MIN_VERIFIED_EVIDENCE } from './constants.js';

/**
 * The one model call this feature makes, and the shape it must answer in.
 *
 * The prompt is written the way `docs/skills/README.md` says a skill body is:
 * an enumeration that produces a list, not a description of a quality. Models
 * comply with procedures and ignore adjectives, and "find the important
 * conventions" is an adjective wearing a verb's clothes.
 */

/** What the model returns. Grounding re-checks every claim in it. */
export const ExtractionResponse = z.object({
  candidates: z
    .array(
      z.object({
        category: ConventionCategory,
        rule: z
          .string()
          .describe('One imperative sentence a reviewer could apply to a diff.'),
        evidence: z
          .array(
            z.object({
              path: z.string().describe('Repo-relative path, copied exactly from the sample header.'),
              line: z.number().int().describe('Line the snippet starts on.'),
              snippet: z.string().describe('The code itself, copied verbatim from the sample.'),
            }),
          )
          .describe('Every place in the samples that follows the rule.'),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(MAX_CANDIDATES),
});
export type ExtractionResponse = z.infer<typeof ExtractionResponse>;

export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

export const SYSTEM_PROMPT = `# Role
You read a sample of one repository and report the house conventions it already
follows — the rules a reviewer would cite when a new pull request breaks them.

You are not proposing improvements. A rule this codebase does not follow is not a
convention, however good an idea it is.

# Procedure
Work through the samples once and produce a list. For each rule you report:

1. State it as ONE imperative sentence about a diff: "Route handlers throw
   AppError subclasses instead of returning an error object."
2. Quote every place in the samples that follows it. Copy the code VERBATIM out
   of the sample block — the same characters, including indentation. Give the
   path exactly as it appears in the sample header, and the line the quote
   starts on.
3. Assign a confidence: how consistently the samples follow the rule.

# What counts as a convention
- A choice repeated across files that a newcomer would get wrong: layering,
  error shape, naming, module structure, how async is written, what gets
  exported, how tests are arranged.
- It must be visible in the code you were given.

# What does NOT count
- Anything the repo's own config already enforces. The config files are in the
  samples: if ESLint, Prettier or tsconfig fails the build over it, skip it.
  Formatting is almost always this.
- A rule you can only support from ONE place. At least ${MIN_VERIFIED_EVIDENCE}
  quotes, from different lines, or do not report it.
- Language or framework defaults that any project would share.
- Anything you cannot quote. A rule without code is a guess, and every quote is
  checked against the real file afterwards — one that is not there is discarded
  along with the rule that leaned on it.

# Output
At most ${MAX_CANDIDATES} rules, strongest evidence first. An honest short list
beats a padded one: a reader who rejects five of your rules stops reading the
sixth.`;

/** Render the sampled files into the one user message. */
export function buildUserMessage(
  repoFullName: string,
  configs: { path: string; content: string }[],
  sources: { path: string; content: string }[],
): string {
  const block = (files: { path: string; content: string }[]) =>
    files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');

  return [
    `Repository: ${repoFullName}`,
    '',
    '# Config files (what is already machine-enforced)',
    configs.length > 0 ? block(configs) : '(none found)',
    '',
    '# Source samples (the most depended-on files in the repo)',
    block(sources),
  ].join('\n');
}

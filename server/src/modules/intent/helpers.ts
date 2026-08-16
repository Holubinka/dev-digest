import {
  IntentEvidenceSource,
  type IntentConfidence,
  type IntentRecord,
} from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { truncateCodePoints } from '../_shared/repo-paths.js';
import {
  parsePlanRefs as parseSharedPlanRefs,
  sanitizeMarkdownRepoPath,
} from '../_shared/plan-refs.js';

/* Re-exported so the rest of this slice keeps importing from its own helpers:
   where the rule lives is `_shared/`'s business, not every call site's. */
export { truncateCodePoints };
import type { PrIntentRow } from '../../db/rows.js';
import type { IntentSources } from './types.js';
import {
  MAX_COMMIT_SUBJECT_CHARS,
  MAX_FILE_PATH_CHARS,
  MAX_ISSUE_BODY_CHARS,
  MAX_ISSUE_TITLE_CHARS,
  MAX_PATH_LENGTH,
  MAX_PLAN_FILES,
  MAX_PR_BODY_CHARS,
  MAX_PR_TITLE_CHARS,
} from './constants.js';

/**
 * intent — pure transforms. Core ring: nothing here calls anything, so the
 * security gate below is unit-testable with no filesystem and no database.
 */

/**
 * The path gate and the body scan moved to `_shared/plan-refs.ts` on 2026-08-16,
 * when `modules/brief` needed the same two for the spec files it puts in front of
 * the model and `no-cross-module` forbade it importing this file. Both are
 * re-exported bound to THIS slice's caps, so every call site here and in
 * `test/intent-helpers.test.ts` is unchanged — which is the proof the move was
 * behaviour-preserving.
 */
export function sanitizeRepoPath(raw: string): string | null {
  return sanitizeMarkdownRepoPath(raw, MAX_PATH_LENGTH);
}

export function parsePlanRefs(body: string, repo: { owner: string; name: string }): string[] {
  return parseSharedPlanRefs(body, repo, {
    maxFiles: MAX_PLAN_FILES,
    maxPathLength: MAX_PATH_LENGTH,
  });
}

/** The three documentary sources. `title` and `commits_files` always exist, so neither can raise the band. */
const DOCUMENTARY: IntentEvidenceSource[] = ['body', 'linked_issue', 'plan_spec'];

/**
 * Confidence from evidence, deterministically — the model is never asked for a
 * number. Total over all eight combinations: three documents → `high`, one or
 * two → `medium`, none → `low`.
 *
 * `linked_issue` and `plan_spec` are both parsed OUT of the body, so `low` is
 * exactly "this PR has no description".
 */
export function bandConfidence(evidence: IntentEvidenceSource[]): IntentConfidence {
  const docs = DOCUMENTARY.filter((source) => evidence.includes(source)).length;
  if (docs === 3) return 'high';
  if (docs === 0) return 'low';
  return 'medium';
}

/** Which of the five sources were actually non-empty. */
export function collectEvidence(sources: IntentSources): IntentEvidenceSource[] {
  const out: IntentEvidenceSource[] = [];
  if (sources.title.trim().length > 0) out.push('title');
  if (sources.body && sources.body.trim().length > 0) out.push('body');
  if (sources.linkedIssue) out.push('linked_issue');
  if (sources.planFiles.length > 0) out.push('plan_spec');
  if (sources.commitMessages.length > 0 || sources.filePaths.length > 0) out.push('commits_files');
  return out;
}

/**
 * The classifier's user message: one `<untrusted>` block per PRESENT source,
 * labelled so the block count matches `collectEvidence` exactly.
 *
 * Delimiter-wrapping, never keyword scanning — a denylist only ever catches one
 * phrasing (`reviewer-core/src/prompt.ts:10-14`). `wrapUntrusted` also escapes a
 * `</untrusted>` planted in the text, so untrusted content cannot close its own
 * fence and speak as the prompt.
 *
 * Every input is capped here, not left to the model's context window: on a
 * public repo all of them are attacker-controlled, and all of them feed a paid
 * call. Every cap is applied BEFORE `wrapUntrusted`, so truncation can never cut
 * off a closing `</untrusted>` fence.
 *
 * "Every" is the load-bearing word. Four rounds of review on this file each
 * closed one input and left the next: the title, the body, the issue, the plan
 * text, the commit subjects, the file paths. A cap missing from one branch of
 * this function is indistinguishable from a cap nobody thought about.
 */
export function renderClassifierInput(sources: IntentSources): string {
  const blocks: string[] = [];
  if (sources.title.trim().length > 0) {
    const title = truncateCodePoints(sources.title, MAX_PR_TITLE_CHARS);
    blocks.push(`## Title\n${wrapUntrusted('pr-title', title)}`);
  }
  if (sources.body && sources.body.trim().length > 0) {
    const body = truncateCodePoints(sources.body, MAX_PR_BODY_CHARS);
    blocks.push(`## Description\n${wrapUntrusted('pr-body', body)}`);
  }
  if (sources.linkedIssue) {
    const issue = sources.linkedIssue;
    const title = truncateCodePoints(issue.title, MAX_ISSUE_TITLE_CHARS);
    const body = truncateCodePoints(issue.body ?? '', MAX_ISSUE_BODY_CHARS);
    const text = `#${issue.number} (${issue.state}) ${title}\n${body}`;
    blocks.push(`## Linked issue\n${wrapUntrusted('linked-issue', text)}`);
  }
  if (sources.planFiles.length > 0) {
    const text = sources.planFiles.map((file) => `### ${file.path}\n${file.text}`).join('\n\n');
    blocks.push(`## Linked plan / spec\n${wrapUntrusted('plan-spec', text)}`);
  }
  if (sources.commitMessages.length > 0 || sources.filePaths.length > 0) {
    const parts: string[] = [];
    // Both lists arrive count-capped (`MAX_COMMIT_MESSAGES`, `MAX_FILE_PATHS`)
    // and neither is length-capped by the query that fetched it: a subject line
    // has no limit in git, and `pr_files.path` is `text`.
    if (sources.commitMessages.length > 0) {
      const subjects = sources.commitMessages
        .map((m) => `- ${truncateCodePoints(m, MAX_COMMIT_SUBJECT_CHARS)}`)
        .join('\n');
      parts.push(`Commits:\n${subjects}`);
    }
    if (sources.filePaths.length > 0) {
      const paths = sources.filePaths
        .map((p) => `- ${truncateCodePoints(p, MAX_FILE_PATH_CHARS)}`)
        .join('\n');
      parts.push(`Changed files:\n${paths}`);
    }
    blocks.push(`## Commits and changed files\n${wrapUntrusted('commits-files', parts.join('\n\n'))}`);
  }
  return blocks.join('\n\n');
}

/**
 * The `## Intent` body handed to `reviewer-core`. Plain text on purpose:
 * `assemblePrompt` is what wraps it in `<untrusted source="derived-intent">`,
 * and wrapping here as well would nest two fences.
 *
 * Only the four schema fields plus the derived band reach the review prompt —
 * never `StructuredResult.raw`.
 */
export function renderIntentSection(record: IntentRecord): string {
  const bullets = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- (none stated)';
  return [
    `Goal: ${record.intent}`,
    `Confidence: ${record.confidence} (derived from: ${record.evidence.join(', ') || 'none'})`,
    `In scope:\n${bullets(record.in_scope)}`,
    `Out of scope:\n${bullets(record.out_of_scope)}`,
    `Risk areas:\n${bullets(record.risk_areas)}`,
  ].join('\n\n');
}

/** Row → DTO. A `*Row` never leaves this module. */
export function toIntentRecord(row: PrIntentRow): IntentRecord {
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    risk_areas: row.riskAreas,
    confidence: row.confidence,
    // The column is plain `jsonb` because no db/schema file imports the
    // contracts; filtering through the enum's own options keeps the DTO honest
    // without an unchecked cast.
    evidence: row.evidence.filter((source): source is IntentEvidenceSource =>
      (IntentEvidenceSource.options as string[]).includes(source),
    ),
    plan_refs: row.planRefs,
    provider: row.provider ?? '',
    model: row.model ?? '',
    computed_at: row.computedAt.toISOString(),
  };
}

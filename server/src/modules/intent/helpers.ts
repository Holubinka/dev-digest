import {
  IntentEvidenceSource,
  type IntentConfidence,
  type IntentRecord,
} from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import type { PrIntentRow } from '../../db/rows.js';
import type { IntentSources } from './types.js';
import {
  MAX_ISSUE_BODY_CHARS,
  MAX_ISSUE_TITLE_CHARS,
  MAX_PATH_LENGTH,
  MAX_PLAN_FILES,
  MAX_PR_BODY_CHARS,
} from './constants.js';

/**
 * intent — pure transforms. Core ring: nothing here calls anything, so the
 * security gate below is unit-testable with no filesystem and no database.
 */

/**
 * Truncate by CODE POINT.
 *
 * `String.slice` counts UTF-16 units and splits a surrogate pair, leaving a
 * replacement character mid-word (`server/INSIGHTS.md:103-114`).
 */
export function truncateCodePoints(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}

/**
 * The path gate between an attacker-supplied PR body and `GitClient.readFile`.
 *
 * `SimpleGitClient.readFile` is `readFile(join(clonePathFor(repo), path))`
 * (`adapters/git/simple-git.ts:129-131`), and `join('/clones/o/r', '../../etc/passwd')`
 * resolves outside the clone. On a public repo the body is attacker-supplied,
 * so this is a real traversal sink, not a theoretical one.
 *
 * Returns the normalised repo-relative path, or `null` when the input is not
 * one. `path.resolve` is deliberately NOT used: it would tie the answer to the
 * process CWD and stop this function being pure. The invariant the caller
 * relies on — "no `..` segment survives" — is decidable on the string alone.
 */
export function sanitizeRepoPath(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null;
  // A NUL truncates the path at the syscall boundary; no other control
  // character belongs in a repo-relative path either.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  // Absolute POSIX, absolute UNC, and Windows drive-letter forms.
  if (raw.startsWith('/') || raw.startsWith('\\')) return null;
  if (/^[A-Za-z]:/.test(raw)) return null;

  const segments = raw
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return null;
  if (segments.includes('..')) return null;

  const normalised = segments.join('/');
  // One extension, one parser, one attack surface.
  if (!normalised.toLowerCase().endsWith('.md')) return null;
  if (normalised.toLowerCase().startsWith('.git/')) return null;
  return normalised;
}

/** Same-repo GitHub blob URLs. `[^\s)"'<>]` stops the match at a markdown-link or HTML boundary. */
const BLOB_URL = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/blob\/([^\s)"'<>]+)/gi;

/**
 * Path-like tokens ending in `.md`. Backticks, parentheses and `:` are outside
 * the class, so a backticked path and a markdown link's target both fall out of
 * the same scan, while any absolute URL leaves a leading `//` that
 * `sanitizeRepoPath` rejects. Bounded repetition keeps it linear on a long body.
 */
const MD_PATH = /[A-Za-z0-9._\-/]{0,200}\.md\b/gi;

/**
 * Repo-relative plan/spec paths referenced by a PR body, at most
 * `MAX_PLAN_FILES` of them, de-duplicated and normalised.
 *
 * SUPPORTED
 *   - a bare repo-relative `.md` path, plain or in backticks;
 *   - a markdown link whose target is such a path;
 *   - a GitHub blob URL for THIS repo — owner/name compared case-insensitively,
 *     the `<ref>` segment discarded (the clone's current checkout is read), and
 *     a `#L12-L40` anchor or `?plain=1` query stripped.
 *
 * NOT SUPPORTED, deliberately
 *   - a blob URL for any other repo, and any gist: there is no clone to read
 *     them from and this function makes no network calls;
 *   - anything that is not `.md` — `.txt`, `.adoc`, `.rst`, source files;
 *   - Notion, Linear, Jira, Confluence and Google Docs URLs: no adapter, no
 *     credential, and no plan to add one;
 *   - issue and PR links beyond the single `#\d+` `resolveLinkedIssue` handles;
 *   - `../` traversal, absolute paths, and anything outside the clone. Those
 *     are not merely unsupported — `sanitizeRepoPath` rejects them.
 *
 * A branch name containing `/` in a blob URL is read as ref + path at the first
 * slash, so `blob/feat/x/specs/p.md` yields `x/specs/p.md` and simply fails to
 * read. GitHub's own URLs give no way to tell the two apart.
 */
export function parsePlanRefs(body: string, repo: { owner: string; name: string }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string): boolean => {
    const path = sanitizeRepoPath(candidate);
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
    return out.length >= MAX_PLAN_FILES;
  };

  for (const [, owner, name, rest] of body.matchAll(BLOB_URL)) {
    if (owner?.toLowerCase() !== repo.owner.toLowerCase()) continue;
    if (name?.toLowerCase() !== repo.name.toLowerCase()) continue;
    const withoutAnchor = (rest ?? '').split('#')[0]?.split('?')[0] ?? '';
    if (push(withoutAnchor.split('/').slice(1).join('/'))) return out;
  }

  for (const [match] of body.matchAll(MD_PATH)) {
    if (push(match)) return out;
  }
  return out;
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
 * The PR body and the linked issue are capped here, not left to the model's
 * context window: both are attacker-controlled on a public repo and both feed a
 * paid call. Every cap is applied BEFORE `wrapUntrusted`, so truncation can
 * never cut off a closing `</untrusted>` fence.
 */
export function renderClassifierInput(sources: IntentSources): string {
  const blocks: string[] = [];
  if (sources.title.trim().length > 0) {
    blocks.push(`## Title\n${wrapUntrusted('pr-title', sources.title)}`);
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
    if (sources.commitMessages.length > 0) {
      parts.push(`Commits:\n${sources.commitMessages.map((m) => `- ${m}`).join('\n')}`);
    }
    if (sources.filePaths.length > 0) {
      parts.push(`Changed files:\n${sources.filePaths.map((p) => `- ${p}`).join('\n')}`);
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

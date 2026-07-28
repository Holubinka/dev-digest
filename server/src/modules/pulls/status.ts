import type { PrStatus } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
}

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.critical += 1;
    else if (r.severity === 'WARNING') c.warning += 1;
    else if (r.severity === 'SUGGESTION') c.suggestion += 1;
  }
  return c;
}

/** Rank per severity for the list's hover card (lower = shown first). */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Longest rationale the list payload carries per finding; the rest is elided. */
export const LIST_RATIONALE_CHARS = 200;

/** One finding as the PR list carries it — enough for a hover card, no more. */
export interface ListFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
  rationale: string;
}

/**
 * The `limit` findings worth previewing on the PR list: worst severity first,
 * then most confident. Severities outside the contract are dropped rather than
 * ranked last — the client maps severity to an icon with no fallback.
 *
 * Rationales are truncated here, not in the browser: the list ships one payload
 * for every PR in the repo, and a few hundred findings' worth of markdown would
 * dwarf everything else on it.
 */
export function topFindings(
  rows: {
    id: string;
    severity: string;
    category: string;
    title: string;
    file: string;
    startLine: number;
    endLine: number;
    confidence: number;
    rationale: string;
  }[],
  limit: number,
): ListFinding[] {
  return rows
    .filter((r) => r.severity in SEVERITY_RANK)
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        b.confidence - a.confidence,
    )
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      severity: r.severity,
      category: r.category,
      title: r.title,
      file: r.file,
      start_line: r.startLine,
      end_line: r.endLine,
      confidence: r.confidence,
      rationale:
        r.rationale.length > LIST_RATIONALE_CHARS
          ? `${r.rationale.slice(0, LIST_RATIONALE_CHARS)}…`
          : r.rationale,
    }));
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}

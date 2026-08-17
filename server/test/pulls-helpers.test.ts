/**
 * F1 — `modules/pulls/helpers.ts`, the row → `PrMeta` DTO map for the PR list.
 *
 * Pure, so it unit-tests without a route or a database. What is worth pinning
 * here is not the field copying but the two places the mapping makes a
 * decision: the derived review `status`, and the null-vs-zero rule that lets
 * the UI tell "reviewed and clean" from "never reviewed".
 */
import { describe, it, expect } from 'vitest';
import {
  toPrDetail,
  toPrMeta,
  type PrDetailRow,
  type PrListRow,
  type PrRollups,
} from '../src/modules/pulls/helpers.js';

const now = Date.UTC(2026, 5, 11);

const row = (over: Partial<PrListRow> = {}): PrListRow => ({
  id: 'pr-1',
  number: 482,
  title: 'Add the severity filter bar',
  author: 'octocat',
  branch: 'feat/findings-severity-filter',
  base: 'main',
  headSha: 'abc123',
  lastReviewedSha: null,
  additions: 120,
  deletions: 8,
  filesCount: 5,
  status: 'open',
  openedAt: new Date(now - 86_400_000),
  updatedAt: new Date(now - 86_400_000),
  ...over,
});

/** A PR nothing has ever run against. */
const noRollups: PrRollups = { review: undefined, costUsd: null, findings: undefined };

describe('toPrMeta', () => {
  it('renames the row columns onto the wire contract', () => {
    const meta = toPrMeta(row(), noRollups, now);
    expect(meta).toMatchObject({
      id: 'pr-1',
      number: 482,
      title: 'Add the severity filter bar',
      author: 'octocat',
      branch: 'feat/findings-severity-filter',
      base: 'main',
      head_sha: 'abc123',
      additions: 120,
      deletions: 8,
      files_count: 5,
    });
  });

  it('derives the review status instead of copying the merge state', () => {
    // The column says 'open'; the DTO must say what the reviewer needs to know.
    expect(toPrMeta(row({ status: 'open' }), noRollups, now).status).toBe('needs_review');
    expect(
      toPrMeta(row({ status: 'open', lastReviewedSha: 'abc123' }), noRollups, now).status,
    ).toBe('reviewed');
    expect(toPrMeta(row({ status: 'merged' }), noRollups, now).status).toBe('merged');
  });

  it('serialises the timestamps as ISO strings, and null when absent', () => {
    const meta = toPrMeta(row({ openedAt: null, updatedAt: null }), noRollups, now);
    expect(meta.opened_at).toBeNull();
    expect(meta.updated_at).toBeNull();
    expect(toPrMeta(row(), noRollups, now).opened_at).toBe('2026-06-10T00:00:00.000Z');
  });

  /**
   * The distinction the whole FINDINGS column rests on. A PR with reviews but no
   * findings is clean and renders `0 · 0 · 0`; a PR nobody has reviewed renders
   * `—`. Both arrive here as "no findings rows", and only the presence of the
   * rollup entry tells them apart — so mapping the absent case to zeros (or the
   * empty case to null) silently merges two states the UI draws differently.
   */
  it('reports null findings for a PR that was never reviewed', () => {
    const meta = toPrMeta(row(), noRollups, now);
    expect(meta.findings_critical).toBeNull();
    expect(meta.findings_warning).toBeNull();
    expect(meta.findings_suggestion).toBeNull();
    expect(meta.findings_top).toBeNull();
  });

  it('reports zero findings — not null — for a PR reviewed and found clean', () => {
    const meta = toPrMeta(
      row(),
      {
        review: { score: 100, headSha: 'abc123' },
        costUsd: 0.42,
        findings: { counts: { critical: 0, warning: 0, suggestion: 0 }, top: [] },
      },
      now,
    );
    expect(meta.findings_critical).toBe(0);
    expect(meta.findings_warning).toBe(0);
    expect(meta.findings_suggestion).toBe(0);
    expect(meta.findings_top).toEqual([]);
  });

  it('carries the counts and the preview through when there are findings', () => {
    const top = [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded key',
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        confidence: 0.9,
        rationale: 'because',
      },
    ];
    const meta = toPrMeta(
      row(),
      {
        review: { score: 62, headSha: 'abc123' },
        costUsd: 1.5,
        findings: { counts: { critical: 1, warning: 2, suggestion: 3 }, top },
      },
      now,
    );
    expect(meta.findings_critical).toBe(1);
    expect(meta.findings_warning).toBe(2);
    expect(meta.findings_suggestion).toBe(3);
    expect(meta.findings_top).toEqual(top);
    expect(meta.score).toBe(62);
    expect(meta.cost_usd).toBe(1.5);
  });

  /**
   * `score` is nullable on the review row itself, so "no review" and "a review
   * that scored null" both end at null — but they must not go through the same
   * branch, or a future default would apply to the wrong one.
   */
  it('keeps a null score from a real review distinct from having no review', () => {
    expect(toPrMeta(row(), noRollups, now).score).toBeNull();
    expect(
      toPrMeta(
        row(),
        { review: { score: null, headSha: 'abc123' }, costUsd: null, findings: undefined },
        now,
      ).score,
    ).toBeNull();
  });

  it('reports a null cost rather than a misleading zero when nothing was priced', () => {
    expect(toPrMeta(row(), noRollups, now).cost_usd).toBeNull();
  });

  /**
   * The list and the PR page used to answer the same question differently: the
   * page shows a verdict and a PR SCORE only for the current `head_sha`
   * (SPEC-02 AC-69), while the list took the newest review's score whatever
   * state it ran on — so PR #21 read `100` in the list and "this state has not
   * been reviewed" on its own page, off the same rows. `score_state` is what the
   * list says the number with; these three cases are the three things it draws.
   */
  describe('score_state', () => {
    const rollups = (review: PrRollups['review']): PrRollups => ({
      review,
      costUsd: null,
      findings: undefined,
    });

    it("says 'none' when no review ever produced a score", () => {
      expect(toPrMeta(row(), noRollups, now).score_state).toBe('none');
    });

    it("says 'current' when the score's review ran on the PR's head", () => {
      const meta = toPrMeta(row({ headSha: 'abc123' }), rollups({ score: 100, headSha: 'abc123' }), now);
      expect(meta.score_state).toBe('current');
      expect(meta.score).toBe(100);
    });

    /**
     * The case that reproduces the defect. The fixture must differ from the two
     * around it in exactly one way — the review's head — or it proves nothing:
     * a fixture whose review sits on the current head cannot fail, whatever the
     * mapping does.
     */
    it("says 'earlier' when the score's review ran on another state, and still ships the score", () => {
      const meta = toPrMeta(row({ headSha: 'abc123' }), rollups({ score: 100, headSha: 'c757be1' }), now);
      expect(meta.score_state).toBe('earlier');
      // Marked, not hidden: the number is real and worth showing (AC-25/26/38
      // doctrine), it just has to say which state it belongs to.
      expect(meta.score).toBe(100);
    });

    /**
     * `reviews.head_sha` is nullable for rows written before the column existed.
     * "Unknown state" must not resolve to "the state you are looking at" — that
     * promotion is the one AC-69 forbids — and it is not hypothetical: every
     * review on PR #19 and #20 in this workspace predates the column.
     */
    it("says 'earlier' for a review row that never recorded which state it read", () => {
      expect(
        toPrMeta(row({ headSha: 'abc123' }), rollups({ score: 100, headSha: null }), now).score_state,
      ).toBe('earlier');
    });

    /**
     * Two blank shas are not a match. Nothing writes an empty `head_sha` today,
     * so this pins the guard rather than a behaviour anyone has seen — string
     * equality would otherwise read `'' === ''` as "reviewed at this head" and
     * hand the number the one claim it must never make by accident.
     */
    it('does not read two empty shas as the same state', () => {
      expect(
        toPrMeta(row({ headSha: '' }), rollups({ score: 100, headSha: '' }), now).score_state,
      ).toBe('earlier');
    });

    /**
     * `status` and `score_state` answer different questions off different
     * columns — `last_reviewed_sha` vs the score's own review — and a PR can
     * carry `reviewed` while its number came from somewhere else. Asserting the
     * pair here stops a later "simplification" from deriving one out of the
     * other.
     */
    it('is independent of the derived review status', () => {
      const meta = toPrMeta(
        row({ status: 'open', headSha: 'abc123', lastReviewedSha: 'abc123' }),
        rollups({ score: 100, headSha: 'c757be1' }),
        now,
      );
      expect(meta.status).toBe('reviewed');
      expect(meta.score_state).toBe('earlier');
    });
  });
});

/**
 * The offline half of `GET /pulls/:id`. This mapping was inline in the route's
 * `catch` block, where the only way to reach it was to make GitHub unreachable
 * — which is why it had no test at all until it moved out here.
 */
describe('toPrDetail', () => {
  const detailRow = (over: Partial<PrDetailRow> = {}): PrDetailRow => ({
    ...row(),
    body: 'Adds a per-token limiter.',
    linkedIssue: null,
    ...over,
  });

  it('renames the row columns onto the wire contract', () => {
    expect(toPrDetail(detailRow(), [], [])).toMatchObject({
      id: 'pr-1',
      number: 482,
      head_sha: 'abc123',
      files_count: 5,
      body: 'Adds a per-token limiter.',
    });
  });

  /** Detail reports GitHub's merge state; only the list derives review freshness. */
  it('passes the merge state through instead of deriving a review status', () => {
    expect(toPrDetail(detailRow({ status: 'open' }), [], []).status).toBe('open');
    expect(toPrMeta(row({ status: 'open' }), noRollups, now).status).toBe('needs_review');
  });

  it('maps files and commits, turning a missing patch and date into null', () => {
    const detail = toPrDetail(
      detailRow(),
      [{ path: 'src/limiter.ts', additions: 40, deletions: 2, patch: null }],
      [{ sha: 'abc123', message: 'feat: limiter', author: 'octocat', committedAt: null }],
    );

    expect(detail.files).toEqual([
      { path: 'src/limiter.ts', additions: 40, deletions: 2, patch: null },
    ]);
    expect(detail.commits).toEqual([
      { sha: 'abc123', message: 'feat: limiter', author: 'octocat', committed_at: null },
    ]);
  });

  /**
   * The cached linked issue is what lets a review run make zero GitHub calls,
   * so the detail response is the only place its absence and its presence are
   * distinguishable from outside.
   */
  it('carries the cached linked issue, and reports null when there is none', () => {
    const issue = { number: 471, title: 'Public API is unmetered', body: null, state: 'open' };
    expect(toPrDetail(detailRow({ linkedIssue: issue }), [], []).linked_issue).toEqual(issue);
    expect(toPrDetail(detailRow(), [], []).linked_issue).toBeNull();
  });
});

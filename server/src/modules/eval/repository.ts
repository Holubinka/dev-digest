import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { EvalExpectation } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * eval — data access for `eval_cases` and `eval_runs`.
 *
 * THE ONE RULE THIS FILE EXISTS TO HOLD: `eval_runs` has no `workspace_id`
 * column. Its only tie to a tenant is `case_id → eval_cases.workspace_id`, so
 * EVERY read and EVERY write below joins `eval_cases` and filters on it.
 * `server/INSIGHTS.md` names this table by name as the next place the
 * "parent scoped, child assumed" bug would appear — `agent_skills` shipped with
 * the parent workspace-checked and the child's rows trusted, and it was
 * unreachable, therefore unreviewable, until the lesson that filled the table.
 *
 * A batch is not a table. One batch is the set of `eval_runs` rows whose
 * envelope carries the same `actual_output->>'batch_id'`, and its aggregate is
 * written into every one of those rows on completion (D1/D3, and no migration —
 * N6). The three batch reads below are therefore `DISTINCT ON (batch_id)` over
 * the join, which is why they are `db.execute` rather than the query builder:
 * the builder cannot express a distinct-on over a jsonb expression without
 * making the tenancy join harder to see, and seeing it is the point.
 */

export type EvalCaseDbRow = typeof t.evalCases.$inferSelect;
export type EvalRunDbRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/**
 * The newest run of one case, flattened for the Evals tab's three-state row.
 *
 * The index signature is `db.execute`'s constraint (`Record<string, unknown>`),
 * not a claim that extra keys arrive — the SELECT lists every column by name.
 */
export interface LatestRunRow {
  [column: string]: unknown;
  case_id: string;
  ran_at: Date;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  findings_count: number;
  /** Raw jsonb `actual_output->'skills'` — `undefined`/`null` on a pre-skills row. */
  skills: unknown;
}

/** One COMPLETED batch: the envelope fields that identify it, plus its aggregate. */
export interface BatchRow {
  [column: string]: unknown;
  batch_id: string;
  owner_id: string;
  agent_version: number;
  ran_at: Date;
  /** Parsed jsonb — the service validates it against `EvalBatchAggregate`. */
  aggregate: unknown;
}

/**
 * One case's latest run, from a SKILL's point of view — `LatestRunRow` plus
 * which case and which agent it belongs to, since a skill's list spans agents.
 */
export interface SkillCaseRow {
  [column: string]: unknown;
  case_id: string;
  case_name: string;
  expected_output: unknown;
  notes: string | null;
  agent_id: string;
  agent_name: string;
  ran_at: Date;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  findings_count: number;
  skills: unknown;
}

/** A run row with its case's name, for `EvalRunRecord`. */
export interface RunWithCaseRow {
  run: EvalRunDbRow;
  caseName: string;
}

export interface BatchRange {
  from?: Date;
  to?: Date;
}

/**
 * The provenance marker written into `notes` when a case is born from a finding.
 *
 * A text marker rather than a foreign key, because D11 forbids one: findings
 * cascade away with their review and their PR, and a dataset that disappears
 * with the PR it came from is not a regression guard. `caseByFindingId` matches
 * on this, which is what makes the second click on the same finding open the
 * existing case (AC-10) rather than create a twin.
 */
export const FINDING_MARKER = 'finding:';

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases ---------------------------------------------------------

  /**
   * One owner's cases, oldest first.
   *
   * `ownerKind` is pinned to `'agent'` rather than inferred from `ownerId`:
   * N1 leaves skill-owned cases out of this lesson entirely, and an id that
   * happened to match a skill row must not surface on an agent's tab.
   */
  async listCases(workspaceId: string, ownerId: string): Promise<EvalCaseDbRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(asc(t.evalCases.name));
  }

  /** Owners in this workspace that have at least one case, with how many. */
  async caseCountsByOwner(workspaceId: string): Promise<{ ownerId: string; total: number }[]> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, total: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return rows.map((r) => ({ ownerId: r.ownerId, total: Number(r.total) }));
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseDbRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row;
  }

  /**
   * The case created from this finding, if one already exists.
   *
   * `findingId` reaches here already parsed as a uuid by the route's schema, so
   * it carries no `%` or `_` for `LIKE` to read as a wildcard. Drizzle
   * parameterises the value either way — this is about the pattern's meaning,
   * not about injection.
   */
  async caseByFindingId(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseDbRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          like(t.evalCases.notes, `%${FINDING_MARKER}${findingId}%`),
        ),
      )
      .orderBy(asc(t.evalCases.name))
      .limit(1);
    return row;
  }

  /**
   * Re-derives a finding-derived case's polarity when its source finding's
   * accept/dismiss decision changes AFTER the case was made (accepted →
   * must_find, dismissed → must_not_flag — the same rule `caseFromFinding`
   * applies at creation). A no-op when no case exists for this finding —
   * nothing to refuse and nothing to fetch, same shape as AC-10's repeat-click
   * handling. Every expectation on the case gets the new polarity: a
   * finding-derived case carries exactly one, but mapping the whole array is
   * no more expensive and stays correct if that ever changes.
   */
  async syncPolarityByFindingId(
    workspaceId: string,
    findingId: string,
    decision: 'accepted' | 'dismissed',
  ): Promise<void> {
    const existing = await this.caseByFindingId(workspaceId, findingId);
    if (!existing) return;
    const expectations = (existing.expectedOutput ?? []) as EvalExpectation[];
    if (expectations.length === 0) return;
    const polarity = decision === 'accepted' ? 'must_find' : 'must_not_flag';
    if (expectations.every((e) => e.polarity === polarity)) return;
    await this.updateCase(workspaceId, existing.id, {
      expectedOutput: expectations.map((e) => ({ ...e, polarity })),
    });
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseDbRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles as object | null,
        inputMeta: values.inputMeta as object | null,
        expectedOutput: values.expectedOutput as object | null,
        notes: values.notes,
      })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseDbRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  /** Deletes the case and, by FK cascade, its `eval_runs` rows (AC-22). */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_runs ----------------------------------------------------------

  async insertRun(values: InsertEvalRun): Promise<EvalRunDbRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        actualOutput: values.actualOutput as object,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      })
      .returning();
    return row!;
  }

  /**
   * Write the completed batch's aggregate into the envelope of EVERY row of
   * that batch, in one statement (AC-31).
   *
   * The join to `eval_cases` is the tenancy check: without it this is an UPDATE
   * addressed by a client-supplied `batch_id` alone, which is the whole shape of
   * the bug C13 exists to prevent.
   */
  async updateRunEnvelopes(
    workspaceId: string,
    batchId: string,
    aggregate: unknown,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE eval_runs r
         SET actual_output = jsonb_set(
               COALESCE(r.actual_output, '{}'::jsonb),
               '{aggregate}',
               ${JSON.stringify(aggregate)}::jsonb,
               true)
        FROM eval_cases c
       WHERE c.id = r.case_id
         AND c.workspace_id = ${workspaceId}
         AND r.actual_output->>'batch_id' = ${batchId}
    `);
  }

  /** Recent runs for the given cases, newest first, with each case's name. */
  async runsForCases(
    workspaceId: string,
    caseIds: string[],
    limit: number,
  ): Promise<RunWithCaseRow[]> {
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          inArray(t.evalRuns.caseId, caseIds),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows;
  }

  /**
   * The newest run of each of an owner's cases — the Evals tab's three-state
   * indicator (passed / failed / never run) and its expected-vs-got counts.
   *
   * `findings_count` is read out of the envelope rather than recomputed:
   * `jsonb_typeof` guards it because `actual_output` is `z.unknown()` in the
   * contract and `jsonb_array_length` raises on a non-array.
   */
  async latestRunPerCase(workspaceId: string, ownerId: string): Promise<LatestRunRow[]> {
    return this.db.execute<LatestRunRow>(sql`
      SELECT DISTINCT ON (r.case_id)
             r.case_id            AS case_id,
             r.ran_at             AS ran_at,
             r.pass               AS pass,
             r.recall             AS recall,
             r.precision          AS precision,
             r.citation_accuracy  AS citation_accuracy,
             CASE WHEN jsonb_typeof(r.actual_output->'findings') = 'array'
                  THEN jsonb_array_length(r.actual_output->'findings')
                  ELSE 0 END::int AS findings_count,
             r.actual_output->'skills' AS skills
        FROM eval_runs r
        JOIN eval_cases c ON c.id = r.case_id
       WHERE c.workspace_id = ${workspaceId}
         AND c.owner_kind = 'agent'
         AND c.owner_id = ${ownerId}
       ORDER BY r.case_id, r.ran_at DESC
    `);
  }

  /**
   * Every agent's case whose LATEST run had this skill active — the
   * skill-centric mirror of `latestRunPerCase` above.
   *
   * The `latest` CTE computes each case's absolute newest run first, UNAFFECTED
   * by the skill filter, then the outer query keeps only the rows whose skills
   * array contains this id. Filtering inside the same DISTINCT ON instead would
   * pick the newest run WHERE THE SKILL FIRED, which can be a stale run for a
   * case re-run since without this skill bound — the wrong pass/fail for "what
   * is true of this case right now". `@>` on a `NULL` (a pre-skills-feature
   * row) evaluates to `NULL`, not an error, so those rows are silently excluded
   * rather than crashing the query.
   */
  async casesForSkill(workspaceId: string, skillId: string): Promise<SkillCaseRow[]> {
    return this.db.execute<SkillCaseRow>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (r.case_id)
               r.case_id            AS case_id,
               r.ran_at             AS ran_at,
               r.pass               AS pass,
               r.recall             AS recall,
               r.precision          AS precision,
               r.citation_accuracy  AS citation_accuracy,
               CASE WHEN jsonb_typeof(r.actual_output->'findings') = 'array'
                    THEN jsonb_array_length(r.actual_output->'findings')
                    ELSE 0 END::int AS findings_count,
               r.actual_output->'skills' AS skills
          FROM eval_runs r
          JOIN eval_cases c ON c.id = r.case_id
         WHERE c.workspace_id = ${workspaceId}
           AND c.owner_kind = 'agent'
         ORDER BY r.case_id, r.ran_at DESC
      )
      SELECT l.case_id            AS case_id,
             c.name                AS case_name,
             c.expected_output     AS expected_output,
             c.notes               AS notes,
             c.owner_id            AS agent_id,
             a.name                AS agent_name,
             l.ran_at              AS ran_at,
             l.pass                AS pass,
             l.recall              AS recall,
             l.precision           AS precision,
             l.citation_accuracy   AS citation_accuracy,
             l.findings_count      AS findings_count,
             l.skills              AS skills
        FROM latest l
        JOIN eval_cases c ON c.id = l.case_id
        JOIN agents a ON a.id = c.owner_id AND a.workspace_id = ${workspaceId}
       WHERE l.skills @> ${JSON.stringify([{ id: skillId }])}::jsonb
       ORDER BY a.name, c.name
    `);
  }

  /**
   * COMPLETED batches, newest first.
   *
   * "Completed" means the envelope carries an aggregate OBJECT. A batch every
   * one of whose cases errored writes no aggregate at all (AC-34), and so does a
   * batch whose process died mid-way — both are therefore absent from the trend
   * and from the comparison list by construction, with no second flag to keep in
   * sync.
   */
  async completedBatches(
    workspaceId: string,
    opts: { ownerId?: string; batchId?: string; range?: BatchRange; limit: number },
  ): Promise<BatchRow[]> {
    const conds = [
      sql`c.workspace_id = ${workspaceId}`,
      sql`c.owner_kind = 'agent'`,
      sql`jsonb_typeof(r.actual_output->'aggregate') = 'object'`,
    ];
    if (opts.ownerId) conds.push(sql`c.owner_id = ${opts.ownerId}`);
    if (opts.batchId) conds.push(sql`r.actual_output->>'batch_id' = ${opts.batchId}`);
    // postgres-js wants a string in a raw `sql` fragment, not a `Date` — the
    // typed query builder coerces this for free, a raw template does not.
    if (opts.range?.from) conds.push(sql`r.ran_at >= ${opts.range.from.toISOString()}`);
    if (opts.range?.to) conds.push(sql`r.ran_at <= ${opts.range.to.toISOString()}`);

    return this.db.execute<BatchRow>(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (r.actual_output->>'batch_id')
               r.actual_output->>'batch_id'              AS batch_id,
               c.owner_id                                AS owner_id,
               (r.actual_output->>'agent_version')::int  AS agent_version,
               r.ran_at                                  AS ran_at,
               r.actual_output->'aggregate'              AS aggregate
          FROM eval_runs r
          JOIN eval_cases c ON c.id = r.case_id
         WHERE ${sql.join(conds, sql` AND `)}
         ORDER BY r.actual_output->>'batch_id', r.ran_at DESC
      ) b
      ORDER BY b.ran_at DESC
      LIMIT ${opts.limit}
    `);
  }

  /** One owner's completed batches, newest first, optionally date-bounded. */
  batchesForOwner(
    workspaceId: string,
    ownerId: string,
    range: BatchRange,
    limit: number,
  ): Promise<BatchRow[]> {
    return this.completedBatches(workspaceId, { ownerId, range, limit });
  }

  /** One completed batch by id, or `undefined` — including for another tenant. */
  async batchById(workspaceId: string, batchId: string): Promise<BatchRow | undefined> {
    const [row] = await this.completedBatches(workspaceId, { batchId, limit: 1 });
    return row;
  }
}

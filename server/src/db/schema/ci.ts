import {
  boolean,
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  /** `agents.version` the deployed bundle was generated from. */
  agentVersion: integer('agent_version'),
  /**
   * When this repository's Actions were last polled SUCCESSFULLY.
   *
   * Only a poll that returned writes here, so the timestamp shown to the user
   * never reports a poll that did not happen, and a failed attempt does not
   * push the "polled less than 5 minutes ago" window forward.
   */
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  /**
   * Whether the LAST successful poll found this installation's workflow file.
   *
   * NULL until a poll returns, and that null is a third state rather than a
   * missing default (AC-148): "never asked" is not "asked and it is gone". A
   * row in this table records that DevDigest published a bundle, which stopped
   * being evidence that the file is still there the moment two agents could
   * write into one repository (D23).
   */
  workflowPresent: boolean('workflow_present'),
  /**
   * The agent a run of this installation's workflow file claimed to be, when it
   * was not this installation's own (AC-143, AC-149).
   *
   * Written from the artifact, which is UNTRUSTED — it is only ever displayed
   * beside "this file runs someone else", never used to attribute a row.
   */
  observedAgent: text('observed_agent'),
});

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    /** "owner/name" — resolved from the workflow-run metadata, never from the artifact body. */
    repo: text('repo'),
    /** GitHub run ids are past 2^31, so `bigint` and not `integer`. */
    workflowRunId: bigint('workflow_run_id', { mode: 'number' }),
    agent: text('agent'),
    durationMs: integer('duration_ms'),
    headSha: text('head_sha'),
    /** Runner bundle version the run executed with. */
    bundleVersion: text('bundle_version'),
    /** The REVIEW verdict, separate from `status`, which is the run's own state. */
    verdict: text('verdict'),
  },
  (t) => ({
    /**
     * One row per ingested workflow run, as a property of the database.
     *
     * A service that SELECTs before it INSERTs does not give this: two ingest
     * passes reading the same artifact concurrently both see no row, both
     * insert, and neither errors. The index is what upsert conflicts on.
     *
     * `(repo, workflow_run_id)` and not the run id alone — the pair also
     * refuses a run id claimed against a repository it does not belong to.
     *
     * NULLS NOT DISTINCT is deliberately absent: `ci_runs` already holds rows
     * that carry neither column, and it would make every one of them collide
     * with every other. Postgres' default keeps them distinct, which is why
     * this index can be added to a populated table without inventing values.
     */
    byRun: uniqueIndex('ci_runs_repo_run_idx').on(t.repo, t.workflowRunId),
  }),
);

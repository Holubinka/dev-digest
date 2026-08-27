import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /**
     * USD cost of this run. The provider's own number when it reports one
     * (OpenRouter `usage.cost`), else estimated from the price book. Null means
     * "unknown" — an unpriced model or a run that never reached the LLM — and the
     * UI renders it as "—", never as $0.00.
     */
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
  },
  (t) => ({
    // The pre-run estimate reads "the last run of THIS agent that reached done",
    // per agent, on every open of Configure run. Postgres indexes neither FK
    // column here, so without this the DISTINCT ON behind it is a sequential
    // scan of every run the workspace ever made. `ran_at desc` is part of the
    // key, not an afterthought: the read wants the newest row per agent, and an
    // index that stops at the equality columns still sorts.
    byAgentTime: index('agent_runs_ws_agent_ran_idx').on(
      t.workspaceId,
      t.agentId,
      t.ranAt.desc(),
    ),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

/** One fan-out of a chosen SET of agents over one pull request (SPEC-05). */
export const multiAgentRuns = pgTable(
  'multi_agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    /**
     * When the last run of this multi-run reached a terminal state, written once
     * by the executor's caller (AC-155). With `ran_at` it IS the multi-run's
     * summary duration — measured, never derived from the runs' `duration_ms`
     * (AC-41), which is also why deleting a run cannot move it (AC-159).
     *
     * Null means one of two live things, told apart by the runs' states: the
     * multi-run is still going, or the process died and the reaper closed its
     * runs long afterwards. In the second case `now - ran_at` would measure the
     * downtime, so no duration is reported at all (AC-158).
     */
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /**
     * How many of this multi-run's runs were allowed to execute at once. Stored
     * rather than read from a constant, because the results page states how the
     * run was executed (AC-40) and a run made under a different ceiling must not
     * be described by today's one.
     */
    concurrency: integer('concurrency').notNull().default(3),
    /**
     * The PR head every run of this multi-run saw. Null for a row written before
     * this column existed; it is NOT the PR's current head, and reading it as
     * such is what would make the line-shift warning (AC-109) silent exactly
     * when it is needed.
     */
    headSha: text('head_sha'),
  },
  (t) => ({
    // The repo-scoped landing reads "the newest multi-run of this workspace"
    // (AC-94), and `ran_at desc` is what lets that be a single index step.
    byWorkspaceTime: index('multi_agent_runs_ws_ran_idx').on(t.workspaceId, t.ranAt.desc()),
    // Both an FK index Postgres will not create and the PR page's read of "does
    // a comparison of this PR exist" (R54).
    byPr: index('multi_agent_runs_pr_idx').on(t.prId),
  }),
);

/**
 * Which agent runs belong to a multi-run, and what the agent was called when it
 * started.
 *
 * A table rather than a `multi_run_id` column on `agent_runs`, because the two
 * facts below live nowhere else and adding three columns to the table every run
 * path writes is a far wider blast radius than a table nothing else touches.
 */
export const multiAgentRunItems = pgTable(
  'multi_agent_run_items',
  {
    /**
     * PRIMARY KEY, and that is the point: "every agent run belongs to at most one
     * multi-run" (AC-25) then holds by construction rather than by a service
     * remembering to check. The cascade is AC-42/AC-99 — deleting a run removes
     * its membership, leaving the multi-run readable without that column.
     */
    runId: uuid('run_id')
      .primaryKey()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    multiRunId: uuid('multi_run_id')
      .notNull()
      .references(() => multiAgentRuns.id, { onDelete: 'cascade' }),
    /**
     * Deliberately NOT a foreign key, and `reviews.agentId` is the precedent.
     * `agent_runs.agent_id` is ON DELETE SET NULL, so a reference here would
     * erase on deletion exactly the fact AC-118 needs preserved: which agent this
     * column was.
     */
    agentId: uuid('agent_id').notNull(),
    /**
     * The agent's name as of the moment the multi-run started. It is stored
     * nowhere else on a run, so without it a permanent link degrades into a
     * column with no name the day the agent is deleted (AC-118).
     */
    agentName: text('agent_name').notNull(),
    /**
     * The order the agents were resolved in, so the column / tab / take order
     * (AC-46) survives an agent being deleted from the workspace afterwards.
     */
    position: integer('position').notNull(),
  },
  (t) => ({
    // Both the FK index for `multi_run_id` and the read path's exact order:
    // every read of a multi-run is "its items, in position order".
    byMultiRunPosition: index('multi_agent_run_items_run_position_idx').on(
      t.multiRunId,
      t.position,
    ),
  }),
);

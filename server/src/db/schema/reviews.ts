import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  riskAreas: jsonb('risk_areas').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // `confidence` gets no CHECK on purpose: `text(name, { enum })` is a
  // TypeScript-level enum that emits plain text, and the whole schema follows
  // that pattern (reviews.kind, findings.severity, pull_requests.status). The
  // vocabulary is enforced by IntentConfidence at the edge.
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull().default('low'),
  evidence: jsonb('evidence').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  planRefs: jsonb('plan_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  provider: text('provider'),
  model: text('model'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: doublePrecision('cost_usd'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One Risk Brief per PR STATE — `(pr_id, head_sha)`, not `pr_id`.
 *
 * The composite key is what makes "a new head computes a new state without
 * overwriting the old one" and "regenerating replaces this state's row" true by
 * construction rather than by a service remembering to check: the first is an
 * insert against a different key, the second is `onConflictDoUpdate` against the
 * same one. It is also the unique index that upsert needs.
 *
 * Every enum column is `text(name, { enum })` with no CHECK — a TypeScript-level
 * enum emitting plain text, which is what `pr_intent.confidence`, `reviews.kind`
 * and `findings.severity` all do. The vocabulary is enforced by the Zod contract
 * at the edge.
 */
export const prBrief = pgTable(
  'pr_brief',
  {
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** The PR state this brief describes. Resolved server-side from `pull_requests`. */
    headSha: text('head_sha').notNull(),
    what: text('what').notNull(),
    why: text('why').notNull(),
    riskLevel: text('risk_level', { enum: ['high', 'medium', 'low'] }).notNull().default('low'),
    risks: jsonb('risks').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    reviewFocus: jsonb('review_focus').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    /** One entry per candidate input with what became of it — the provenance block. */
    inputs: jsonb('inputs').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    droppedRefs: jsonb('dropped_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    droppedRisks: integer('dropped_risks').notNull().default(0),
    intentComputedAt: timestamp('intent_computed_at', { withTimezone: true }),
    intentFreshness: text('intent_freshness', { enum: ['fresh', 'stale', 'unknown'] })
      .notNull()
      .default('unknown'),
    blastStatus: text('blast_status').notNull(),
    linkSha: text('link_sha'),
    indexMatchesHead: boolean('index_matches_head').notNull().default(false),
    budget: integer('budget').notNull(),
    inputTokensCounted: integer('input_tokens_counted').notNull(),
    /** WHICH counter answered — `heuristic` means the encoder had failed. */
    tokenizer: text('tokenizer').notNull(),
    attempts: integer('attempts').notNull().default(1),
    tokensIn: integer('tokens_in').notNull().default(0),
    provider: text('provider'),
    model: text('model'),
    costUsd: doublePrecision('cost_usd'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Running total of states evicted for this PR, as of when THIS row was
     * written. It cannot be inferred from how many rows come back: a PR sitting
     * at exactly the cap has evicted nothing, and telling its reader history was
     * lost is a false disclosure. An evicted row cannot carry the fact of its own
     * eviction, so the surviving newest row carries it.
     */
    evictedCount: integer('evicted_count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prId, t.headSha] }),
    // Postgres does not index a FK column for you, and both the timeline read and
    // the eviction walk go "this PR's rows, ordered by time".
    byPrTime: index('pr_brief_pr_computed_idx').on(t.prId, t.computedAt.desc()),
  }),
);

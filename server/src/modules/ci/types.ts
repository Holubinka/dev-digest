import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallationListItem,
  CiRun,
  CiTarget,
  Verdict,
} from '@devdigest/shared';
import type { GitHubClient, RunnerBundle } from '../../vendor/shared/adapters.js';
import type { Db } from '../../db/client.js';
import type { AgentRow } from '../../db/rows.js';
import type { LinkedSkillLike } from '../_shared/skill-prompt.js';
import type { JobRunner } from '../../platform/jobs.js';
import type { PinoLike } from '../../platform/run-logger.js';

/**
 * Module-local shapes. Rows do not leave `modules/ci/**` — `helpers.ts` maps
 * them to the `@devdigest/shared` contracts before a route sees them.
 */

/** One installation as the ingest needs it: where to poll and when it last worked. */
export interface InstallationTarget {
  id: string;
  agentId: string;
  /**
   * The agent's name, because the slug is derived from it (AC-17) and the slug
   * is what names the workflow file to poll (AC-135). Selected by `listTargets`
   * rather than recomputed elsewhere: the ingest must ask Actions for the file
   * THIS installation's bundle wrote, not for a shared one.
   */
  agentName: string;
  workspaceId: string;
  repo: string;
  agentVersion: number | null;
  lastPolledAt: Date | null;
}

/** What one successful poll of one installation learned about its workflow. */
export interface PollObservation {
  /** Actions answered about this installation's file rather than 404ing (AC-147). */
  workflowPresent: boolean;
  /**
   * The agent a run of this file said it was, when that was not this
   * installation's own (AC-143, AC-149). `null` clears a stale finding: the
   * column describes the LAST poll, not everything ever seen.
   */
  observedAgent: string | null;
}

/** One `ci_installations` row, as the module passes it around. */
export interface InstallationRecord {
  id: string;
  agentId: string;
  repo: string;
  targetType: CiTarget;
  installedAt: Date;
  agentVersion: number | null;
}

/** An installation joined with its last run, for the agent's CI tab (AC-85, AC-86, AC-90). */
export interface InstallationWithLastRun extends InstallationRecord {
  /** The agent's CURRENT version — the staleness comparison's right-hand side. */
  currentAgentVersion: number;
  /** The agent's name, which the workflow path is derived from (AC-147). */
  agentName: string;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
  /** Empty until the first poll that returned (AC-127, AC-148). */
  lastPolledAt: Date | null;
  /** What the last poll saw. `null` on both while no poll has returned. */
  workflowPresent: boolean | null;
  observedAgent: string | null;
}

/** Everything one accepted artifact writes into `ci_runs` (AC-75, AC-112). */
export interface CiRunWrite {
  ciInstallationId: string;
  repo: string;
  workflowRunId: number;
  prNumber: number | null;
  ranAt: Date | null;
  /** Already mapped to the `CiRunStatus` vocabulary, or null when unknown (AC-118, AC-132). */
  status: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  agent: string | null;
  durationMs: number | null;
  headSha: string | null;
  bundleVersion: string | null;
  verdict: Verdict | null;
}

/** The `agent_runs` half of an accepted artifact (AC-76). */
export interface CiAgentRunWrite {
  workspaceId: string;
  agentId: string;
  repo: string;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  durationMs: number | null;
}

/** One repository whose poll failed, as `POST /ci/runs/refresh` reports it (AC-83). */
export interface PollError {
  repo: string;
  reason: string;
}

/** What one ingest pass did. `errors` is the only part the page renders. */
export interface IngestOutcome {
  errors: PollError[];
  /** Installations actually polled — a repo inside the 5-minute window is not one. */
  polled: number;
  accepted: number;
  rejected: number;
}

/** The generated bundle plus the pieces the Install step reports back. */
export interface GeneratedBundle {
  files: CiFile[];
  /** Slug the manifest was written under — the runner's `DEVDIGEST_AGENT`. */
  agentSlug: string;
  /** Paths the publishing commit removes alongside the files it writes (AC-146). */
  removals: string[];
}

/**
 * What the composition root holds, and the routes consume.
 *
 * Structural, like `BriefReader` — the container must not import `CiService`.
 * It exists because `CiService` carries `ingests`, the map that gives
 * `POST /ci/runs/refresh` its `errors[]`: while the routes constructed their own
 * instance, that handoff was held by registration count rather than by
 * construction, and a second `app.register` would have re-registered the ingest
 * job with a new instance's closure while the old one read its own empty map
 * and reported zero poll errors. `server/INSIGHTS.md` records the identical
 * shape for `BriefService.inFlight`.
 */
/** `GET /ci/runs` — the page's rows and the last poll that actually returned. */
export interface CiRunsPage {
  runs: CiRun[];
  last_polled_at: string | null;
}

/** `POST /ci/runs/refresh` — the same, plus the repositories that would not answer. */
export interface CiRefreshPage extends CiRunsPage {
  errors: PollError[];
}

/**
 * Just enough of the container for this slice, declared structurally.
 *
 * The concrete `Container` cannot be named here: the composition root imports
 * `CiService` to memoise it, so a type import back the other way closes a
 * `no-circular` cycle — dependency-cruiser follows type-only imports
 * (`tsPreCompilationDeps`). `BriefContainer` is the same move for the same
 * reason.
 */
export interface CiContainer {
  readonly db: Db;
  readonly jobs: JobRunner;
  /**
   * Only the two reads this slice makes, named structurally: `no-cross-module`
   * forbids `modules/ci` naming `modules/agents`' repository type, and reaching
   * it through the container is the sanctioned escape — but the escape does not
   * extend to importing the class.
   */
  readonly agentsRepo: {
    getById(workspaceId: string, id: string): Promise<AgentRow | undefined>;
    linkedSkills(agentId: string): Promise<LinkedSkillLike[]>;
  };
  readonly runnerBundle: RunnerBundle;
  github(): Promise<GitHubClient>;
}

export interface CiReader {
  registerIngestJobHandler(log: PinoLike): void;
  installations(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationListItem[] | undefined>;
  export(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport | undefined>;
  zip(workspaceId: string, agentId: string, input: CiExportInput): Promise<Uint8Array | undefined>;
  runs(workspaceId: string): Promise<CiRunsPage>;
  refresh(workspaceId: string, force: boolean): Promise<CiRefreshPage>;
}

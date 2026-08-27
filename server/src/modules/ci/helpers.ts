import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';
import type { CiFile, RepoRef } from '@devdigest/shared';
import {
  CiArtifactStatus,
  type CiInstallation,
  type CiInstallationListItem,
  type CiRun,
  type CiRunStatus,
  type CiUnconfirmedReason,
  type Verdict,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { MAX_UNZIPPED_BYTES, workflowPathFor } from './constants.js';
import { agentSlug } from './generate/slug.js';
import type { InstallationRecord, InstallationWithLastRun } from './types.js';

/**
 * Pure transforms for the `ci` module: input shapes, row → DTO mapping, the
 * artifact-state vocabulary and a YAML sanity scan. Nothing here does I/O.
 */

/** `owner/name` as GitHub writes it. Deliberately narrower than a URL. */
const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Parse `owner/name` into a `RepoRef`, refusing anything that could travel
 * further than one path segment (`SPEC-05 § Untrusted inputs`).
 *
 * The value is chosen by a workspace user and is interpolated into a GitHub API
 * path, so the form is checked BEFORE it is substituted: no whitespace, no `..`,
 * exactly one slash, and each side limited to what GitHub itself allows in a
 * name. `..` is refused explicitly and not merely by the character class,
 * because `.` is legal in a repository name and only the pair traverses.
 */
export function parseRepoRef(repo: string): RepoRef {
  const refuse = (why: string): never => {
    throw new ValidationError(`repo must be "owner/name" — ${why}`);
  };
  if (/\s/.test(repo)) refuse('it contains whitespace');
  if (repo.includes('..')) refuse('it contains ".."');
  const parts = repo.split('/');
  if (parts.length !== 2) refuse('it must contain exactly one "/"');
  const [owner, name] = parts as [string, string];
  if (!REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
    refuse('both sides must be letters, digits, ".", "_" or "-"');
  }
  return { owner, name };
}

/**
 * The artifact's run state, translated into the `ci_runs` vocabulary.
 *
 * One-to-one and total over `CiArtifactStatus`, and everything else is
 * `unrecognised`: a value the enum does not carry is dropped and named in the
 * log rather than stored or used to reject the run (AC-132), and a missing one
 * is simply unknown (AC-118). `no_findings` and `running` are never produced
 * here — the first is derived state this ingest does not derive, and the second
 * describes a run that has not finished, which an artifact cannot.
 *
 * A `Map` and not an object literal: `status` reaches this function as a free
 * string, and `{...}['__proto__']` is not undefined.
 */
const ARTIFACT_TO_RUN_STATUS = new Map<CiArtifactStatus, CiRunStatus>([
  ['succeeded', 'succeeded'],
  ['failed', 'failed'],
  ['skipped', 'skipped'],
]);

export interface MappedRunStatus {
  status: CiRunStatus | null;
  /** The value that was dropped, when it was not one this build understands. */
  unrecognised: string | null;
}

export function runStatusFromArtifact(raw: string | null | undefined): MappedRunStatus {
  if (raw === null || raw === undefined) return { status: null, unrecognised: null };
  const parsed = CiArtifactStatus.safeParse(raw);
  if (!parsed.success) return { status: null, unrecognised: raw };
  return { status: ARTIFACT_TO_RUN_STATUS.get(parsed.data) ?? null, unrecognised: null };
}

/** Row shape `ci_runs` reads back as. Kept local: no `*Row` leaves this module. */
export interface CiRunRowLike {
  id: string;
  ciInstallationId: string | null;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: string | null;
  repo: string | null;
  workflowRunId: number | null;
  agent: string | null;
  durationMs: number | null;
  headSha: string | null;
  bundleVersion: string | null;
  verdict: string | null;
}

/**
 * `ci_runs` row → `CiRun`.
 *
 * The unit conversion is the whole reason this is a function: the column is
 * `duration_ms` and the contract field is `duration_s`. Writing the row's number
 * straight into the DTO shows a 42-second run as 42 000 seconds, and every gate
 * in this repository is blind to it — both types are `number`.
 */
export function toCiRun(row: CiRunRowLike): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt?.toISOString() ?? null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agent,
    duration_s: row.durationMs === null ? null : row.durationMs / 1000,
    repo: row.repo,
    workflow_run_id: row.workflowRunId,
    head_sha: row.headSha,
    bundle_version: row.bundleVersion,
    verdict: row.verdict as Verdict | null,
  };
}

/** `ci_installations` row → `CiInstallation`. */
export function toCiInstallation(row: InstallationRecord): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    agent_version: row.agentVersion,
  };
}

/**
 * Why the tab may not claim this installation's workflow is running, or `null`.
 *
 * ONE ORDERED DECISION, made here, because the alternative is three booleans on
 * the wire and a browser deciding what they mean together. `never_polled` comes
 * first: with no successful poll, `workflow_present` and `observed_agent` are
 * both empty and neither is evidence of anything (AC-148).
 *
 * The other two are mutually exclusive by construction — an artifact can only
 * name an agent if runs came back, and runs only come back when the file is
 * there — so their order settles nothing and is the enum's.
 */
function unconfirmedReason(row: InstallationWithLastRun): CiUnconfirmedReason | null {
  if (row.lastPolledAt === null) return 'never_polled';
  if (row.workflowPresent !== true) return 'workflow_missing';
  if (row.observedAgent !== null) return 'other_agent';
  return null;
}

/**
 * `ci_installations` row + its last run → `CiInstallationListItem`.
 *
 * `stale` is FALSE for an installation with no recorded version (AC-90 marks one
 * that is BELOW the current version; a row that predates `agent_version` is
 * unknown, not old, and a marker on it would be a guess).
 *
 * `workflow_path` is derived from the SAME `agentSlug()` the generator
 * wrote the file with (AC-17, AC-135). Deriving it rather than storing it is
 * what keeps the tab honest about a renamed agent: the row would still name the
 * old file, while the expected path shown beside "not confirmed" is the one the
 * next publication will actually use.
 */
export function toInstallationListItem(row: InstallationWithLastRun): CiInstallationListItem {
  return {
    ...toCiInstallation(row),
    last_run_status: row.lastRunStatus,
    last_run_at: row.lastRunAt?.toISOString() ?? null,
    stale: row.agentVersion !== null && row.agentVersion < row.currentAgentVersion,
    workflow_path: workflowPathFor(agentSlug({ id: row.agentId, name: row.agentName })),
    unconfirmed_reason: unconfirmedReason(row),
    observed_agent: row.observedAgent,
  };
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

/**
 * Read the ONE JSON document inside an artifact archive (AC-71).
 *
 * The budget is spent inside fflate's `filter`, which runs BEFORE an entry is
 * decompressed — the shape `modules/skills/import.ts:33` uses, and for the same
 * reason: a 10 KB archive declaring a 4 GB member must never allocate. It
 * budgets `max(originalSize, size)` because for a STORED entry fflate copies
 * `size` — the compressed field — verbatim, and the two are independent numbers
 * the archive writes about itself.
 *
 * Everything it refuses is a rejection of ONE run, never of the poll.
 */
export function readArtifactJson(bytes: Uint8Array): unknown {
  let entries = 0;
  let inflated = 0;

  const unzipped = unzipSync(bytes, {
    filter: (entry: UnzipFileInfo) => {
      if (entry.name.endsWith('/')) return false;
      entries += 1;
      if (entries > 1) {
        throw new ValidationError('artifact archive holds more than one file');
      }
      inflated += Math.max(entry.originalSize, entry.size);
      if (inflated > MAX_UNZIPPED_BYTES) {
        throw new ValidationError(`artifact content exceeds ${MAX_UNZIPPED_BYTES} bytes`);
      }
      return true;
    },
  });

  const names = Object.keys(unzipped);
  if (names.length !== 1) {
    throw new ValidationError('artifact archive must hold exactly one file');
  }
  const text = new TextDecoder().decode(unzipped[names[0]!]);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('artifact file is not valid JSON');
  }
}

/** The generated bundle as a zip, same paths, same contents (AC-44). */
export function zipFiles(files: CiFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.path] = strToU8(file.contents);
  return zipSync(entries, { level: 6 });
}

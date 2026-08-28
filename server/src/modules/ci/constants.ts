/**
 * Export-to-CI constants. Everything the generator and the ingest agree on
 * without talking to each other: paths, the workflow file name, the pinned
 * action SHAs, and the size ceilings from `SPEC-05 § Non-functional requirements`.
 */

/**
 * Directory the whole bundle lives in, inside the TARGET repository, and the two
 * subfolders it fills.
 *
 * They come from `_shared/bundle-paths.ts` because `modules/context` has to
 * leave exactly those two folders out of its scan (`AC-106`, `AC-107`) and
 * `no-cross-module` forbids it importing this slice. Restating them here is what
 * let a rename on one side pass every gate.
 */
import { DEVDIGEST_ROOT } from '../_shared/bundle-paths.js';

export { BUNDLE_AGENTS_DIR, BUNDLE_SKILLS_DIR, DEVDIGEST_ROOT } from '../_shared/bundle-paths.js';

/** Directory GitHub reads workflows from. */
export const WORKFLOWS_DIR = '.github/workflows';

/**
 * Fixed head of every generated workflow file name, and load-bearing.
 *
 * Without it an agent called "Client" would generate
 * `.github/workflows/client.yml` — a real file in this very repository — and
 * publishing that agent would overwrite an unrelated workflow with a DevDigest
 * one. The prefix is what keeps the generated names inside a namespace nobody
 * else writes into.
 */
export const WORKFLOW_PREFIX = 'devdigest-review-';

/**
 * The name the Actions API addresses this agent's workflow by (AC-68, AC-70).
 *
 * A FUNCTION and not a constant, because two agents in one repository must not
 * share a file: the constant `devdigest-review.yml` meant the second agent's
 * bundle silently overwrote the first's while both installation rows stayed
 * valid (D23). It lives beside the prefix on purpose — a prefix in one file and
 * the code that applies it in another is the same drift one indirection later.
 */
export function workflowFileFor(agentSlug: string): string {
  return `${WORKFLOW_PREFIX}${agentSlug}.yml`;
}

/** The same file, as a path inside the target repository (AC-135). */
export function workflowPathFor(agentSlug: string): string {
  return `${WORKFLOWS_DIR}/${workflowFileFor(agentSlug)}`;
}

/**
 * The one file name this feature used before workflows became per-agent.
 *
 * Every repository DevDigest has ever published into carries it, running
 * whichever agent published last. It is removed by the same commit that writes
 * the per-agent files (AC-146) — leaving it would have that agent review every
 * pull request a second time, from a file no installation row points at any
 * more.
 */
export const LEGACY_WORKFLOW_PATH = `${WORKFLOWS_DIR}/devdigest-review.yml`;

/**
 * The bundled runner, and the path the generated workflow invokes.
 *
 * One definition because two spellings of it cannot be kept honest by any gate:
 * `bundle.ts` wrote `${DEVDIGEST_ROOT}/runner.mjs` while `workflow.ts` spelled
 * `node .devdigest/runner.mjs` as a literal, so renaming the root compiled,
 * typechecked, passed `pnpm arch` and shipped a workflow that runs a file which
 * is not there.
 */
export const RUNNER_FILE = 'runner.mjs';
export const RUNNER_PATH = `${DEVDIGEST_ROOT}/${RUNNER_FILE}`;

/** Artifact the runner uploads, and the single file inside it (AC-54, AC-70). */
export const ARTIFACT_NAME = 'devdigest-result';
export const ARTIFACT_FILE = 'devdigest-result.json';

/** Publication branch and PR title (AC-39, AC-37). Never the base branch (AC-40). */
export const PUBLISH_BRANCH = 'devdigest/ci';
export const PR_TITLE = 'Add DevDigest CI review';
/** Message of the ONE commit every generated file is written in (AC-39). */
export const COMMIT_MESSAGE = 'chore(devdigest): add the CI review bundle';

/**
 * External actions, pinned to a full 40-character commit SHA (AC-49).
 *
 * Resolved on 2026-08-26 against `https://api.github.com/repos/<repo>/git/ref/tags/<version>`.
 * A tag is a moving pointer; the SHA is what makes the supply chain reproducible.
 * When bumping a version, resolve the new SHA the same way — never hand-write one.
 */
export const PINNED_ACTIONS = {
  checkout: {
    name: 'actions/checkout',
    sha: '11bd71901bbe5b1630ceea73d27597364c9af683',
    version: 'v4.2.2',
  },
  setupNode: {
    name: 'actions/setup-node',
    sha: '39370e3970a6d050c480ffad4ff0ed4d3fdee5af',
    version: 'v4.1.0',
  },
  uploadArtifact: {
    name: 'actions/upload-artifact',
    sha: 'b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882',
    version: 'v4.4.3',
  },
} as const;

/** Node the generated job runs on. The runner supports 20 and 22 (AC-56). */
export const RUNNER_NODE_VERSION = '20';
/** Job-level `timeout-minutes` (AC-51). */
export const JOB_TIMEOUT_MINUTES = 15;
/** The documented input ceiling handed to the runner (AC-67, AC-111). */
export const MAX_DIFF_LINES = 50_000;

/** `pull_request` activity types the wizard may choose from (AC-27, AC-35). */
export const ALLOWED_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;

/** Artifact ceilings (AC-71). Archive first, then what it inflates to. */
/**
 * Length cap for the artifact's free-text fields on their way into Postgres.
 *
 * `CiResultArtifact.agent` and `.version` are `z.string()` with no bound, read
 * out of a repository DevDigest does not control. The archive caps above bound
 * the FILE, not the field: a 500 000-character `agent` fits in a 686-byte
 * archive. Generous enough that no honest runner is truncated — our own slug is
 * a few dozen characters — and small enough that a row stays a row.
 */
export const MAX_ARTIFACT_TEXT = 256;

export const MAX_ARCHIVE_BYTES = 1_048_576;
export const MAX_UNZIPPED_BYTES = 4_194_304;

/** Workflow runs read per poll, newest first. */
export const RUNS_PER_POLL = 20;

/**
 * How long a SUCCESSFUL poll of one repository suppresses the next one (AC-121).
 *
 * Read from `ci_installations.last_polled_at`, never from an in-process cache:
 * a window that lives in memory reopens every installation on the next restart
 * and survives a failed poll differently from the column (D20, AC-127).
 */
export const POLL_WINDOW_MS = 5 * 60 * 1000;

/** `JobRunner` kind for the ingest pass (`SPEC-05 § Non-functional requirements`). */
export const CI_INGEST_JOB_KIND = 'ci_ingest';

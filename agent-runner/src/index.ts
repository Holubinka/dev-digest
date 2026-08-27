import type {
  CiArtifactStatus,
  CiResultArtifact,
  Finding,
  GitHubReviewPayload,
  Verdict,
} from '@devdigest/shared';
import { toReviewPayload, type ReviewEvent } from '@devdigest/reviewer-core';
import { ARTIFACT_FILE, ArtifactSecretError, writeArtifact } from './artifact.js';
import {
  agentLabel,
  isForkRun,
  maxDiffLinesOf,
  prNumberOrNull,
  readRunnerEnv,
  type RunnerEnv,
} from './env.js';
import { EXIT_FAILED, EXIT_OK, exitCodeFor } from './gate.js';
import { GitHubApi, changedLines, diffFromFiles } from './github.js';
import { ManifestError, readManifest, readMemory, readSkillBodies } from './inputs.js';
import { publish } from './publish.js';
import { createProvider, runReview } from './review.js';
import { jobSummary, reasonText, summaryLine } from './summary.js';
import { RUNNER_VERSION } from './version.js';

/** The review verdict recorded in the artifact is the one that was POSTED. */
const VERDICT_BY_EVENT: Record<GitHubReviewPayload['event'], Verdict> = {
  APPROVE: 'approve',
  REQUEST_CHANGES: 'request_changes',
  COMMENT: 'comment',
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function severityCounts(findings: Finding[]): {
  critical: number;
  warning: number;
  suggestion: number;
} {
  return {
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
    warning: findings.filter((f) => f.severity === 'WARNING').length,
    suggestion: findings.filter((f) => f.severity === 'SUGGESTION').length,
  };
}

/**
 * Write the artifact, or — if it turned out to carry a credential — a record
 * built from nothing but the run's own constants.
 *
 * A refusal is never swallowed: the summary says the file was refused, and the
 * fallback is written only if it passes the same scan.
 */
function writeResult(
  dir: string,
  artifact: CiResultArtifact,
  literals: readonly string[],
  env: NodeJS.ProcessEnv,
): void {
  try {
    writeArtifact(dir, artifact, literals);
    return;
  } catch (err) {
    if (!(err instanceof ArtifactSecretError)) throw err;
    jobSummary(`DevDigest: ${ARTIFACT_FILE} refused — it contained a ${err.detector}`, env);
  }
  try {
    writeArtifact(
      dir,
      {
        findings_count: 0,
        cost_usd: null,
        agent: artifact.agent,
        version: artifact.version,
        pr_number: artifact.pr_number,
        status: 'failed' satisfies CiArtifactStatus,
        reason: 'result withheld: a credential was detected in it',
      },
      literals,
    );
  } catch (err) {
    jobSummary(`DevDigest: no artifact written — ${messageOf(err)}`, env);
  }
}

/**
 * The runner.
 *
 * Its whole input is the environment; it takes no arguments (AC-50, AC-53). The
 * branch order is the contract: the fork check runs FIRST and reads nothing
 * else (AC-52), then the environment, then the manifest, then the diff ceiling.
 * Every one of those paths writes `devdigest-result.json` before it returns.
 */
export async function run(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  const startedAt = Date.now();
  const agent = agentLabel(env);
  const prNumber = prNumberOrNull(env);
  const maxDiffLines = maxDiffLinesOf(env);
  const literals = [env.OPENROUTER_API_KEY ?? '', env.GITHUB_TOKEN ?? ''];

  const base = {
    findings_count: 0,
    cost_usd: null,
    agent,
    version: RUNNER_VERSION,
    pr_number: prNumber,
    max_changed_lines: maxDiffLines,
  } as const;

  const finish = (
    status: CiArtifactStatus,
    reason: string | null,
    extra: Partial<CiResultArtifact> = {},
  ): void => {
    writeResult(
      cwd,
      {
        ...base,
        ...extra,
        status,
        reason: reason === null ? null : reasonText(reason),
        duration_ms: Date.now() - startedAt,
      } as CiResultArtifact,
      literals,
      env,
    );
  };

  // 1 — Fork. Nothing else is read: on a fork run the repository's secrets are
  //     not in the environment at all, so demanding them would turn AC-52 into
  //     a failure instead of a skip.
  if (isForkRun(env)) {
    const reason =
      'fork pull request — repository secrets are not available to a workflow triggered ' +
      'from a fork, so OPENROUTER_API_KEY is absent and no model was called';
    jobSummary(`DevDigest: skipped. ${reason}.`, env);
    finish('skipped', reason);
    return EXIT_OK;
  }

  // 2 — The environment the review path needs.
  let cfg: RunnerEnv;
  try {
    cfg = readRunnerEnv(env);
  } catch (err) {
    const reason = `environment: ${messageOf(err)}`;
    console.error(`DevDigest: ${reason}`);
    jobSummary(`DevDigest: failed. ${reason}`, env);
    finish('failed', reason);
    return EXIT_FAILED;
  }

  // 3 — The manifest. An invalid one names its failing field and calls no model.
  let manifest;
  try {
    manifest = readManifest(cwd, env.DEVDIGEST_AGENT ?? '');
  } catch (err) {
    const reason =
      err instanceof ManifestError
        ? `manifest invalid at "${err.field}": ${err.message}`
        : `manifest unreadable: ${messageOf(err)}`;
    console.error(`DevDigest: ${reason}`);
    jobSummary(`DevDigest: failed. ${reason}`, env);
    finish('failed', reason);
    return EXIT_FAILED;
  }

  const skills = readSkillBodies(cwd, manifest.skills);
  const memory = readMemory(cwd);
  for (const note of [...skills.notes, ...memory.notes]) jobSummary(`DevDigest: ${note}`, env);

  // 4 — The pull request, and the diff rebuilt from its patches.
  const api = new GitHubApi(cfg.githubToken, cfg.repo);
  let diff;
  let lines: number;
  let pr;
  try {
    pr = await api.pullRequest(cfg.prNumber);
    const files = await api.changedFiles(cfg.prNumber);
    pr.comments = await api.comments(cfg.prNumber);
    diff = diffFromFiles(files);
    lines = changedLines(diff);
  } catch (err) {
    const reason = `GitHub API failed after retries: ${messageOf(err)}`;
    console.error(`DevDigest: ${reason}`);
    jobSummary(`DevDigest: failed. ${reason}`, env);
    finish('failed', reason);
    return EXIT_FAILED;
  }

  // 5 — The documented input ceiling. Over it, no model is called.
  if (lines > cfg.maxDiffLines) {
    const reason =
      `diff of ${lines} changed lines is over the ${cfg.maxDiffLines}-line ceiling — ` +
      'no model was called';
    jobSummary(`DevDigest: skipped. ${reason}.`, env);
    finish('skipped', reason, { changed_lines: lines });
    return EXIT_OK;
  }

  // 6 — The review. Grounding runs inside the engine; what it dropped is
  //     reported here and reaches neither the publication nor the artifact.
  let outcome;
  try {
    outcome = await runReview({
      manifest,
      diff,
      llm: createProvider(cfg.openRouterKey),
      pr,
      prNumber: cfg.prNumber,
      repoSlug: cfg.repoSlug,
      memory: memory.items,
      skills: skills.bodies,
      onEvent: (e: ReviewEvent) => console.log(`[${e.kind}] ${e.msg}`),
    });
  } catch (err) {
    const reason = `model call failed after retries: ${messageOf(err)}`;
    console.error(`DevDigest: ${reason}`);
    jobSummary(`DevDigest: failed. ${reason}`, env);
    finish('failed', reason, { changed_lines: lines });
    return EXIT_FAILED;
  }

  const findings = outcome.review.findings;
  jobSummary(
    `DevDigest: grounding ${outcome.grounding}, ${outcome.dropped.length} finding(s) dropped`,
    env,
  );

  // 7 — Publish exactly as post_as says, then record what was published.
  // The heading names the agent, and names it the SAME way the check does.
  // With two agents installed on one repository a PR carries two reviews from
  // the same `github-actions[bot]` account, and without the name in the heading
  // the reader cannot tell which agent asked for which change. The format is
  // the generator's `checkName` verbatim (`generate/workflow.ts`), so the
  // review heading and the check name a branch rule matches on never drift.
  const payload = toReviewPayload(outcome.review, {
    failOn: manifest.ci_fail_on,
    diff,
    title: `DevDigest Review (${manifest.name})`,
  });
  const result = {
    ...severityCounts(findings),
    findings_count: findings.length,
    cost_usd: outcome.costUsd,
    changed_lines: lines,
    verdict: VERDICT_BY_EVENT[payload.event],
  };
  try {
    jobSummary(`DevDigest: ${await publish(api, cfg.prNumber, payload, cfg.postAs)}`, env);
  } catch (err) {
    const reason = `publishing the review failed after retries: ${messageOf(err)}`;
    console.error(`DevDigest: ${reason}`);
    jobSummary(`DevDigest: failed. ${reason}`, env);
    finish('failed', reason, result);
    return EXIT_FAILED;
  }

  finish('succeeded', null, result);
  const code = exitCodeFor(findings, manifest.ci_fail_on);
  jobSummary(
    `DevDigest: ${findings.length} finding(s), ci_fail_on=${manifest.ci_fail_on}, exit ${code}`,
    env,
  );
  return code;
}

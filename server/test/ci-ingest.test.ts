/**
 * P3.5 / P3.6 — the ingest chain, over a fake repository and the GitHub mock.
 *
 * TWO KINDS OF FAILURE, and telling them apart is what this file is for.
 *
 * A REJECTED ARTIFACT is a decision about ONE run: the poll reached the
 * repository and read an answer it will not store. No row, a logged reason, the
 * poll carries on — and `last_polled_at` still moves, because the repository
 * did answer.
 *
 * A FAILED POLL is the Actions API refusing. It becomes an entry in `errors[]`
 * and, decisively, must NOT stamp `last_polled_at`: a stamp there would report a
 * poll that did not happen (AC-128) and would restart the five-minute window on
 * a failure (AC-129).
 *
 * Every test therefore asserts on BOTH the rows and the stamp.
 */
import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { WorkflowRunRef } from '@devdigest/shared';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import { POLL_WINDOW_MS } from '../src/modules/ci/constants.js';
import { CiIngestExecutor } from '../src/modules/ci/ingest-executor.js';
import type { CiRepository } from '../src/modules/ci/repository.js';
import type {
  CiAgentRunWrite,
  CiRunWrite,
  InstallationTarget,
  PollObservation,
} from '../src/modules/ci/types.js';

const REPO = 'acme/payments-api';
/** `slugify('Security Reviewer', 'agent-1')` — the file this installation polls. */
const WORKFLOW = 'devdigest-review-security-reviewer.yml';

const target = (over: Partial<InstallationTarget> = {}): InstallationTarget => ({
  id: 'inst-1',
  agentId: 'agent-1',
  agentName: 'Security Reviewer',
  workspaceId: 'ws-1',
  repo: REPO,
  agentVersion: 3,
  lastPolledAt: null,
  ...over,
});

const run = (over: Partial<WorkflowRunRef> = {}): WorkflowRunRef => ({
  id: 900_100_200_300,
  head_sha: 'de50d5c364fb',
  status: 'completed',
  conclusion: 'success',
  pr_number: 42,
  html_url: 'https://github.com/acme/payments-api/actions/runs/900100200300',
  run_started_at: '2026-08-26T10:00:00Z',
  updated_at: '2026-08-26T10:04:00Z',
  repository: REPO,
  ...over,
});

/**
 * `agent` is the SLUG, because that is what the runner writes.
 *
 * The workflow sets `DEVDIGEST_AGENT: <slug>` and the runner copies that env
 * value into the artifact (`agent-runner/src/env.ts` → `agentLabel`). This
 * fixture said `Security Reviewer` while nothing compared the two; now the
 * ingest refuses an artifact whose agent is not this installation's (AC-143),
 * and a display name here would fail every test in the file for the right
 * reason and the wrong one.
 */
const ARTIFACT = {
  findings_count: 2,
  cost_usd: 0.014,
  duration_ms: 42_000,
  agent: 'security-reviewer',
  version: '0.1.0',
  pr_number: 42,
  status: 'succeeded',
  verdict: 'comment',
};

function archive(body: unknown, name = 'devdigest-result.json'): Uint8Array {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return zipSync({ [name]: strToU8(text) });
}

/** Two entries where the chain accepts exactly one (AC-71). */
function twoFileArchive(): Uint8Array {
  return zipSync({
    'devdigest-result.json': strToU8(JSON.stringify(ARTIFACT)),
    'notes.txt': strToU8('hello'),
  });
}

interface Recorder {
  runs: CiRunWrite[];
  agentRuns: CiAgentRunWrite[];
  /** Every `recordPoll`: the stamp AND what that poll saw (AC-147, AC-149). */
  stamped: { id: string; at: Date; seen: PollObservation }[];
  repo: CiRepository;
}

/** The range `ci_runs.findings_count` and `ci_runs.duration_ms` really accept. */
const PG_INT_MAX = 2_147_483_647;
const PG_INT_MIN = -2_147_483_648;

/**
 * Refuse what the `integer` column refuses, in the driver's own words.
 *
 * A fake repository that swallowed `3_000_000_000` would disagree with the table
 * it stands in for, and the run that wedges a whole repository's ingest would be
 * invisible here. The error is a PLAIN `Error` and not a `ValidationError` on
 * purpose — that difference is the entire defect: the ingest's per-run catch
 * rethrows anything else, so one bad row aborts the poll rather than the run.
 */
function asIntegerColumn(value: number | null): number | null {
  if (value !== null && (value > PG_INT_MAX || value < PG_INT_MIN)) {
    throw new Error('integer out of range');
  }
  return value;
}

function fakeRepo(targets: InstallationTarget[], opts: { inserted?: boolean } = {}): Recorder {
  const rec: Omit<Recorder, 'repo'> = { runs: [], agentRuns: [], stamped: [] };
  const repo = {
    listTargets: async () => targets,
    upsertRun: async (write: CiRunWrite) => {
      asIntegerColumn(write.findingsCount);
      asIntegerColumn(write.durationMs);
      asIntegerColumn(write.prNumber);
      rec.runs.push(write);
      return { id: `row-${rec.runs.length}`, inserted: opts.inserted ?? true };
    },
    insertAgentRun: async (write: CiAgentRunWrite) => {
      asIntegerColumn(write.findingsCount);
      asIntegerColumn(write.durationMs);
      rec.agentRuns.push(write);
      return `agent-run-${rec.agentRuns.length}`;
    },
    recordPoll: async (id: string, at: Date, seen: PollObservation) => {
      rec.stamped.push({ id, at, seen });
    },
  } as unknown as CiRepository;
  return { ...rec, repo };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

interface Scene {
  github: MockGitHubClient;
  rec: Recorder;
  log: ReturnType<typeof logger>;
  ingest: (force?: boolean) => Promise<{ errors: { repo: string; reason: string }[] }>;
}

function scene(opts: {
  targets?: InstallationTarget[];
  runs?: WorkflowRunRef[];
  artifactName?: string;
  expired?: boolean;
  bytes?: Uint8Array;
  /** A different artifact per run — what one poisoned run among healthy ones needs. */
  bytesFor?: (run: WorkflowRunRef) => Uint8Array;
  actionsError?: Error;
  inserted?: boolean;
  /** Per-file answers; `null` is "the repository has no such workflow" (AC-147). */
  runsByWorkflow?: Record<string, WorkflowRunRef[] | null>;
}): Scene {
  const runs = opts.runs ?? [run()];
  const artifacts = Object.fromEntries(
    runs.map((r) => [
      r.id,
      [
        {
          id: 5000 + (r.id % 1000),
          name: opts.artifactName ?? 'devdigest-result',
          size_in_bytes: 400,
          expired: opts.expired ?? false,
        },
      ],
    ]),
  );
  const zips = Object.fromEntries(
    runs.map((r) => [5000 + (r.id % 1000), opts.bytesFor?.(r) ?? opts.bytes ?? archive(ARTIFACT)]),
  );
  const github = new MockGitHubClient({
    workflowRuns: runs,
    runArtifacts: artifacts,
    artifactZips: zips,
    ...(opts.runsByWorkflow ? { runsByWorkflow: opts.runsByWorkflow } : {}),
    ...(opts.actionsError ? { actionsError: opts.actionsError } : {}),
  });
  const rec = fakeRepo(opts.targets ?? [target()], { inserted: opts.inserted ?? true });
  const log = logger();
  const container = { github: async () => github } as unknown as Container;
  const executor = new CiIngestExecutor(container, rec.repo, log);
  return {
    github,
    rec,
    log,
    ingest: (force = true) => executor.run({ workspaceId: 'ws-1', force }),
  };
}

describe('an accepted artifact (AC-73, AC-75, AC-76, AC-112, AC-117)', () => {
  it('writes one ci_runs row attributed from the RUN, not from the artifact body', async () => {
    const s = scene({});
    await s.ingest();
    expect(s.rec.runs).toHaveLength(1);
    const row = s.rec.runs[0]!;
    expect(row).toMatchObject({
      ciInstallationId: 'inst-1',
      repo: REPO,
      workflowRunId: 900_100_200_300,
      prNumber: 42,
      headSha: 'de50d5c364fb',
      githubUrl: 'https://github.com/acme/payments-api/actions/runs/900100200300',
      status: 'succeeded',
      findingsCount: 2,
      costUsd: 0.014,
      durationMs: 42_000,
      bundleVersion: '0.1.0',
      agent: 'security-reviewer',
      verdict: 'comment',
    });
    expect(row.ranAt?.toISOString()).toBe('2026-08-26T10:00:00.000Z');
  });

  it('takes the verdict from the artifact and never derives it from the count', async () => {
    const s = scene({ bytes: archive({ ...ARTIFACT, findings_count: 5, verdict: undefined }) });
    await s.ingest();
    expect(s.rec.runs[0]!.findingsCount).toBe(5);
    expect(s.rec.runs[0]!.verdict).toBeNull();
  });

  it('adds one agent_runs row with source ci, and stamps the poll', async () => {
    const s = scene({});
    await s.ingest();
    expect(s.rec.agentRuns).toHaveLength(1);
    expect(s.rec.agentRuns[0]).toMatchObject({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo: REPO,
      prNumber: 42,
      findingsCount: 2,
      costUsd: 0.014,
      durationMs: 42_000,
      status: 'succeeded',
    });
    expect(s.rec.stamped.map((x) => x.id)).toEqual(['inst-1']);
  });

  it('does not add a SECOND agent_runs row when the same run is polled again', async () => {
    // The upsert reports which half it took. A second history row would double
    // the workspace's recorded CI cost for a run that happened once.
    const s = scene({ inserted: false });
    await s.ingest();
    expect(s.rec.runs).toHaveLength(1);
    expect(s.rec.agentRuns).toHaveLength(0);
  });
});

describe('the run state (AC-118, AC-131, AC-132)', () => {
  it('writes skipped as skipped — never failed, never no_findings', async () => {
    const s = scene({
      bytes: archive({ ...ARTIFACT, status: 'skipped', reason: 'diff over the ceiling' }),
    });
    await s.ingest();
    expect(s.rec.runs[0]!.status).toBe('skipped');
  });

  it('creates a row with an empty state for an artifact that carries none', async () => {
    const s = scene({ bytes: archive({ ...ARTIFACT, status: undefined, verdict: undefined }) });
    await s.ingest();
    expect(s.rec.runs).toHaveLength(1);
    expect(s.rec.runs[0]!.status).toBeNull();
    expect(s.rec.runs[0]!.verdict).toBeNull();
  });

  it('reaches the WRITE path for a state it does not recognise, logging the value', async () => {
    const s = scene({ bytes: archive({ ...ARTIFACT, status: 'cancelled' }) });
    await s.ingest();
    // Not a rejection branch: the bundle in a target repository is whatever
    // version was committed there, and refusing an unknown state would stop
    // ingest for every repo still on an older runner.
    expect(s.rec.runs).toHaveLength(1);
    expect(s.rec.runs[0]!.status).toBeNull();
    const logged = s.log.warn.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    expect(logged).toContain('cancelled');
    expect(logged).toContain('900100200300');
  });
});

describe('rejections — one run refused, the poll still counted', () => {
  const cases: { name: string; opts: Parameters<typeof scene>[0]; reason: RegExp }[] = [
    {
      name: 'an archive holding more than one file (AC-71)',
      opts: { bytes: twoFileArchive() },
      reason: /one file/,
    },
    {
      name: 'content that is not JSON (AC-71)',
      opts: { bytes: archive('{ not json') },
      reason: /not valid JSON/,
    },
    {
      name: 'content failing the schema, with the field named (AC-72)',
      opts: { bytes: archive({ ...ARTIFACT, findings_count: 'two' }) },
      reason: /findings_count/,
    },
    {
      name: 'a repository the run does not belong to (AC-74)',
      opts: { runs: [run({ repository: 'someone-else/api' })] },
      reason: /someone-else\/api/,
    },
    {
      name: 'a self-reported PR number the run disagrees with (AC-74)',
      opts: { bytes: archive({ ...ARTIFACT, pr_number: 999 }) },
      reason: /PR #999/,
    },
  ];

  for (const c of cases) {
    it(`refuses ${c.name} and writes no row`, async () => {
      const s = scene(c.opts);
      const out = await s.ingest();
      expect(s.rec.runs).toHaveLength(0);
      expect(s.rec.agentRuns).toHaveLength(0);
      // The repository ANSWERED, so this is not a failed poll.
      expect(out.errors).toEqual([]);
      expect(s.rec.stamped.map((x) => x.id)).toEqual(['inst-1']);
      const logged = s.log.warn.mock.calls.map((c2) => JSON.stringify(c2)).join(' ');
      expect(logged).toMatch(c.reason);
    });
  }

  /**
   * A number the artifact can carry and the COLUMN cannot (AC-118, AC-129).
   *
   * The throw is not the defect; the blast radius is. `ci_runs.findings_count` is
   * a Postgres `integer`, the artifact is written by code living in the target
   * repository's PR branch, and an unbounded `z.number().int()` let the value
   * through the parse and into `upsertRun`. What came back was `integer out of
   * range` — not a `ValidationError` — so the per-run catch rethrew it, the
   * repository's REMAINING runs were skipped, `last_polled_at` was never
   * stamped, and every later refresh hit the same run and failed identically.
   *
   * The poisoned run is FIRST on purpose: that is the ordering in which one
   * artifact takes a healthy one down with it.
   */
  describe('a value the ci_runs column cannot hold', () => {
    const POISONED = 900_100_200_301;
    const HEALTHY = 900_100_200_302;

    const poisonedFirst = () =>
      scene({
        runs: [run({ id: POISONED }), run({ id: HEALTHY })],
        bytesFor: (r) =>
          r.id === POISONED
            ? archive({ ...ARTIFACT, findings_count: 3_000_000_000 })
            : archive({ ...ARTIFACT, findings_count: 1 }),
      });

    it('refuses it at the parse, naming the field', async () => {
      const s = poisonedFirst();
      await s.ingest();
      const logged = s.log.warn.mock.calls.map((c) => JSON.stringify(c)).join(' ');
      expect(logged).toContain('findings_count');
      expect(logged).toContain('artifact rejected');
    });

    it('leaves the repository’s other runs landing and its poll stamped', async () => {
      const s = poisonedFirst();
      const out = await s.ingest();

      // The healthy run behind it is written, so the poll was not aborted.
      expect(s.rec.runs.map((w) => w.workflowRunId)).toEqual([HEALTHY]);
      expect(s.rec.runs[0]!.findingsCount).toBe(1);
      // The repository ANSWERED — this is a rejected artifact, not a failed poll.
      expect(out.errors).toEqual([]);
      expect(s.rec.stamped.map((x) => x.id)).toEqual(['inst-1']);
    });
  });

  it('ignores a run whose artifacts are not this feature’s (AC-70)', async () => {
    const s = scene({ artifactName: 'coverage' });
    await s.ingest();
    expect(s.rec.runs).toHaveLength(0);
    expect(s.github.downloadedArtifacts).toEqual([]);
    expect(s.rec.stamped).toHaveLength(1);
  });

  it('ignores an expired artifact rather than failing the poll (N8)', async () => {
    const s = scene({ expired: true });
    const out = await s.ingest();
    expect(s.rec.runs).toHaveLength(0);
    expect(out.errors).toEqual([]);
    expect(s.rec.stamped).toHaveLength(1);
  });
});

describe('a failed poll (AC-83, AC-128, AC-129)', () => {
  it('reports the repository and leaves last_polled_at exactly where it was', async () => {
    const s = scene({ actionsError: new Error('Resource not accessible by integration') });
    const out = await s.ingest();
    expect(out.errors).toEqual([
      { repo: REPO, reason: 'Resource not accessible by integration' },
    ]);
    expect(s.rec.stamped).toEqual([]);
    expect(s.rec.runs).toHaveLength(0);
  });

  it('is per installation — one repository’s refusal neither aborts nor stamps a sibling', async () => {
    // The mock throws for every Actions call, so the two installations are
    // separated by giving the failing one a repository the parse refuses: the
    // sibling's poll must still run, and must still be the only one stamped.
    const s = scene({
      targets: [target({ id: 'bad', repo: 'not-a-repo' }), target({ id: 'good' })],
    });
    const out = await s.ingest();
    expect(out.errors.map((e) => e.repo)).toEqual(['not-a-repo']);
    expect(s.rec.stamped.map((x) => x.id)).toEqual(['good']);
    expect(s.rec.runs).toHaveLength(1);
  });
});

describe('the five-minute window (AC-120, AC-121)', () => {
  it('does not poll a repository that answered less than five minutes ago', async () => {
    const s = scene({ targets: [target({ lastPolledAt: new Date(Date.now() - 60_000) })] });
    await s.ingest(false);
    expect(s.github.polledWorkflows).toEqual([]);
    expect(s.rec.stamped).toEqual([]);
  });

  it('polls one that answered longer ago than the window', async () => {
    const s = scene({
      targets: [target({ lastPolledAt: new Date(Date.now() - POLL_WINDOW_MS - 1000) })],
    });
    await s.ingest(false);
    expect(s.github.polledWorkflows).toEqual([{ repo: REPO, workflowFile: WORKFLOW }]);
  });

  it('polls regardless when the person pressed Refresh (AC-68)', async () => {
    const s = scene({ targets: [target({ lastPolledAt: new Date() })] });
    await s.ingest(true);
    expect(s.github.polledWorkflows).toHaveLength(1);
  });

  it('asks only for runs of THIS installation’s workflow file (AC-68, AC-135)', async () => {
    const s = scene({});
    await s.ingest();
    expect(s.github.polledWorkflows).toEqual([{ repo: REPO, workflowFile: WORKFLOW }]);
  });
});

describe('the file belongs to ONE agent (AC-140, AC-142, AC-143, AC-147, AC-149)', () => {
  it('refuses an artifact naming a different agent, and writes no row', async () => {
    const s = scene({ bytes: archive({ ...ARTIFACT, agent: 'general-reviewer' }) });
    const out = await s.ingest();

    expect(s.rec.runs).toHaveLength(0);
    expect(s.rec.agentRuns).toHaveLength(0);
    // The repository answered, so this is a rejected artifact and not a failed
    // poll: the stamp still moves (AC-74's shape).
    expect(out.errors).toEqual([]);
    const logged = s.log.warn.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    expect(logged).toContain('general-reviewer');
    expect(logged).toContain('security-reviewer');
  });

  it('remembers WHO ran there, so the tab can name it (AC-149)', async () => {
    const s = scene({ bytes: archive({ ...ARTIFACT, agent: 'general-reviewer' }) });
    await s.ingest();
    expect(s.rec.stamped).toEqual([
      {
        id: 'inst-1',
        at: expect.any(Date),
        seen: { workflowPresent: true, observedAgent: 'general-reviewer' },
      },
    ]);
  });

  it('clears the finding on a poll that saw only its own agent', async () => {
    // The column describes the LAST poll. A mismatch fixed by a republish has to
    // stop being reported, or the tab keeps an installation unconfirmed forever.
    const s = scene({});
    await s.ingest();
    expect(s.rec.stamped[0]!.seen).toEqual({ workflowPresent: true, observedAgent: null });
  });

  it('records the workflow as ABSENT when Actions has no such file (AC-147)', async () => {
    const s = scene({ runsByWorkflow: { [WORKFLOW]: null } });
    const out = await s.ingest();

    expect(s.rec.runs).toHaveLength(0);
    // "No such workflow" is an ANSWER, not a failure: it counts as a poll and
    // stamps the time, while a token that cannot read the repository does not.
    expect(out.errors).toEqual([]);
    expect(s.rec.stamped).toEqual([
      {
        id: 'inst-1',
        at: expect.any(Date),
        seen: { workflowPresent: false, observedAgent: null },
      },
    ]);
  });

  it('polls two agents in one repository as two files, and attributes each row', async () => {
    const GENERAL = 'devdigest-review-general-reviewer.yml';
    const securityRun = run({ id: 900_100_200_311 });
    const generalRun = run({ id: 900_100_200_312, pr_number: 42 });
    const s = scene({
      targets: [
        target({ id: 'inst-sec' }),
        target({ id: 'inst-gen', agentId: 'agent-2', agentName: 'General Reviewer' }),
      ],
      runs: [securityRun, generalRun],
      runsByWorkflow: { [WORKFLOW]: [securityRun], [GENERAL]: [generalRun] },
      bytesFor: (r) =>
        archive({
          ...ARTIFACT,
          agent: r.id === securityRun.id ? 'security-reviewer' : 'general-reviewer',
        }),
    });
    const out = await s.ingest();

    expect(s.github.polledWorkflows).toEqual([
      { repo: REPO, workflowFile: WORKFLOW },
      { repo: REPO, workflowFile: GENERAL },
    ]);
    // AC-140: one row per run. AC-142: each row carries the installation whose
    // agent produced it — not whichever installation polled last.
    expect(out.errors).toEqual([]);
    expect(s.rec.runs.map((r) => [r.workflowRunId, r.ciInstallationId])).toEqual([
      [securityRun.id, 'inst-sec'],
      [generalRun.id, 'inst-gen'],
    ]);
    expect(s.rec.stamped.map((x) => x.seen.observedAgent)).toEqual([null, null]);
  });
});

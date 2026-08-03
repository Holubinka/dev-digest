import {
  FEATURE_MODELS,
  type ConventionCandidate,
  type ConventionStatus,
  type ConventionsResponse,
  type FeatureModelChoice,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ValidationError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import { ConventionsRepository, type InsertCandidate, type RepoRef } from './repository.js';
import {
  CONFIG_PATHS,
  EXTRACT_TIMEOUT_MS,
  MAX_FILE_CHARS,
  MAX_SAMPLE_TOKENS,
  MIN_VERIFIED_EVIDENCE,
  TOP_FILE_COUNT,
} from './constants.js';
import {
  emptyTally,
  enforcedTopics,
  isMachineEnforced,
  normaliseRule,
  toCandidateDto,
  toScanDto,
  verifyEvidence,
  type VerificationTally,
} from './helpers.js';
import {
  EXTRACTION_SCHEMA_NAME,
  ExtractionResponse,
  SYSTEM_PROMPT,
  buildUserMessage,
} from './prompt.js';

/**
 * Conventions extractor.
 *
 * Sampling is code, not a model: the repo's own configs plus the files
 * repo-intel already ranked highest. One cheap model call turns that into
 * candidate rules. Then code checks every rule again — a candidate whose
 * evidence is not in the repository does not reach the screen.
 *
 * The repository arrives as a parameter with a default so a unit test can pass
 * a fake without a database.
 */

interface Sample {
  path: string;
  content: string;
}

/** Counts behind one scan — the quality report's raw material. */
export interface ExtractionAudit extends VerificationTally {
  returned: number;
  kept: number;
  machineEnforced: number;
  tooLittleEvidence: number;
  duplicate: number;
}

/** A candidate that survived grounding, before it knows its scan or repo. */
type GroundedCandidate = Omit<InsertCandidate, 'workspaceId' | 'repoId' | 'scanId' | 'headSha'>;

export class ConventionsService {
  constructor(
    private container: Container,
    private repo: ConventionsRepository = new ConventionsRepository(container.db),
  ) {}

  /** Everything the screen shows: the last scan and the current candidates. */
  async list(workspaceId: string, repoId: string): Promise<ConventionsResponse | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const [scan, rows] = await Promise.all([
      this.repo.latestScan(workspaceId, repoId),
      this.repo.listForRepo(workspaceId, repoId),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: rows.map(toCandidateDto),
    };
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: string },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toCandidateDto(row) : undefined;
  }

  /**
   * Scan the repo. Returns the fresh list plus the audit counts behind it, or
   * undefined when the repo is not in this workspace. Throws when there is
   * nothing to read — a repo that never finished cloning would otherwise get an
   * empty list and no explanation.
   */
  async extract(
    workspaceId: string,
    repoId: string,
  ): Promise<{ response: ConventionsResponse; audit: ExtractionAudit } | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    const configs = await this.readMany(repo, [...CONFIG_PATHS]);
    const sources = await this.collectSources(repo, await this.samplePaths(repo));
    if (sources.length === 0) {
      throw new ValidationError(
        'No source files could be read for this repo. Wait for the clone to finish, or re-sync it, then scan again.',
      );
    }

    const headSha = await this.container.git
      .currentHead({ owner: repo.owner, name: repo.name })
      .catch(() => null);

    const { choice, response } = await this.askModel(workspaceId, repo, configs, sources);

    const files = new Map([...configs, ...sources].map((s) => [s.path, s.content]));
    const judged = await this.repo.judgedRules(workspaceId, repoId);
    const { candidates, audit } = this.ground(response, files, configs, judged);

    const { scan, rows } = await this.repo.replacePending(
      workspaceId,
      repoId,
      {
        workspaceId,
        repoId,
        headSha,
        model: choice.model,
        sampleFiles: configs.length + sources.length,
        candidatesReturned: audit.returned,
        candidatesKept: audit.kept,
      },
      candidates.map((c) => ({ ...c, workspaceId, repoId, headSha })),
    );

    const kept = new Set(rows.map((r) => r.id));
    const all = await this.repo.listForRepo(workspaceId, repoId);
    return {
      response: {
        scan: toScanDto(scan),
        // `all` includes rows a person already judged; `kept` is only what this
        // scan added. Both belong on the screen — the judged ones are why a
        // re-scan does not propose them again.
        candidates: all.map(toCandidateDto).filter((c) => kept.has(c.id) || c.status !== 'pending'),
      },
      audit,
    };
  }

  // -------------------------------------------------------------- sampling

  /**
   * The files to read: repo-intel's ranking when the repo is indexed, and a
   * ripgrep proxy when it is not. An unindexed repo is the common case right
   * after adding one, and refusing to scan it would make the feature look
   * broken for the first minute of its life.
   */
  private async samplePaths(repo: RepoRef): Promise<string[]> {
    const ranked = await this.container.repoIntel
      .getConventionSamples(repo.id, TOP_FILE_COUNT)
      .catch(() => [] as string[]);
    if (ranked.length > 0) return ranked;

    const matches = await this.container.codeIndex
      .grep({ owner: repo.owner, name: repo.name }, '^export ')
      .catch(() => []);
    const perFile = new Map<string, number>();
    for (const m of matches) {
      if (isJunkPath(m.path)) continue;
      perFile.set(m.path, (perFile.get(m.path) ?? 0) + 1);
    }
    return [...perFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_FILE_COUNT)
      .map(([path]) => path);
  }

  /**
   * Read what exists and skip what does not. A missing file is the normal case
   * — `CONFIG_PATHS` lists every spelling of an ESLint config, and a repo has
   * one. Blank content is skipped too: it teaches the model nothing and would
   * still be counted as a sampled file.
   */
  private async readMany(repo: RepoRef, paths: string[]): Promise<Sample[]> {
    const out: Sample[] = [];
    for (const path of paths) {
      const content = await this.container.git
        .readFile({ owner: repo.owner, name: repo.name }, path)
        .catch(() => null);
      if (content !== null && content.trim() !== '') out.push({ path, content });
    }
    return out;
  }

  /**
   * Read the sampled files, stopping at the token budget.
   *
   * The content kept here is the WHOLE file even when the prompt gets a
   * truncated copy: grounding checks a quote against the repository, not
   * against what happened to fit in the context window.
   */
  private async collectSources(repo: RepoRef, paths: string[]): Promise<Sample[]> {
    const out: Sample[] = [];
    let tokens = 0;
    for (const sample of await this.readMany(repo, paths)) {
      const forPrompt = promptCopy(sample.content);
      const cost = this.container.tokenizer.count(forPrompt);
      if (tokens + cost > MAX_SAMPLE_TOKENS) break;
      tokens += cost;
      out.push(sample);
    }
    return out;
  }

  // ----------------------------------------------------------------- model

  private async askModel(
    workspaceId: string,
    repo: RepoRef,
    configs: Sample[],
    sources: Sample[],
  ): Promise<{ choice: FeatureModelChoice; response: ExtractionResponse }> {
    const choice = await this.featureModel(workspaceId);
    const llm = await this.container.llm(choice.provider);
    const user = buildUserMessage(
      repo.fullName,
      configs.map((c) => ({ path: c.path, content: promptCopy(c.content) })),
      sources.map((s) => ({ path: s.path, content: promptCopy(s.content) })),
    );

    const result = await withTimeout(
      llm.completeStructured({
        model: choice.model,
        schema: ExtractionResponse,
        schemaName: EXTRACTION_SCHEMA_NAME,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        temperature: 0,
        timeoutMs: EXTRACT_TIMEOUT_MS,
      }),
      EXTRACT_TIMEOUT_MS,
    );
    return { choice, response: result.data };
  }

  /** Workspace override, else the registry default for the `conventions` feature. */
  private async featureModel(workspaceId: string): Promise<FeatureModelChoice> {
    const override = await this.repo.featureModelOverride(workspaceId, 'conventions');
    if (override) return override;
    const registry = FEATURE_MODELS.find((f) => f.id === 'conventions')!;
    return { provider: registry.defaultProvider, model: registry.defaultModel };
  }

  // ------------------------------------------------------------- grounding

  /**
   * Turn what the model said into what the repository can prove.
   *
   * Four gates, in the order that spends the least work: a rule the config
   * already enforces dies before its quotes are checked; quotes are then
   * verified against the clone; a rule left with fewer than
   * MIN_VERIFIED_EVIDENCE sites dies as an observation rather than a rule; and
   * anything a person already accepted or rejected is not proposed twice.
   */
  private ground(
    response: ExtractionResponse,
    files: Map<string, string>,
    configs: Sample[],
    judgedRules: string[],
  ): { candidates: GroundedCandidate[]; audit: ExtractionAudit } {
    const enforced = enforcedTopics(new Map(configs.map((c) => [c.path, c.content])));
    const seen = new Set(judgedRules.map(normaliseRule));
    const tally = emptyTally();
    const audit: ExtractionAudit = {
      ...tally,
      returned: response.candidates.length,
      kept: 0,
      machineEnforced: 0,
      tooLittleEvidence: 0,
      duplicate: 0,
    };
    const out: GroundedCandidate[] = [];

    for (const raw of response.candidates) {
      if (isMachineEnforced(raw.rule, enforced)) {
        audit.machineEnforced++;
        continue;
      }
      const key = normaliseRule(raw.rule);
      if (seen.has(key)) {
        audit.duplicate++;
        continue;
      }
      const evidence = verifyEvidence(raw.evidence, files, tally);
      if (evidence.length < MIN_VERIFIED_EVIDENCE) {
        audit.tooLittleEvidence++;
        continue;
      }
      seen.add(key);
      out.push({
        category: raw.category,
        rule: raw.rule,
        evidence,
        // The model's own number, discounted by how much of what it cited was
        // actually there. A rule that quoted four places and proved two is not
        // as certain as the model thought.
        confidence: clamp(raw.confidence * (evidence.length / Math.max(raw.evidence.length, 1))),
      });
    }

    audit.kept = out.length;
    audit.unsampledFile = tally.unsampledFile;
    audit.snippetNotFound = tally.snippetNotFound;
    audit.reanchored = tally.reanchored;
    return { candidates: out, audit };
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** What the prompt gets: the file, cut to a length one sample may occupy. */
function promptCopy(content: string): string {
  return content.length > MAX_FILE_CHARS
    ? `${content.slice(0, MAX_FILE_CHARS)}\n… (truncated)`
    : content;
}

const JUNK_PATH_PATTERNS = [
  'node_modules/',
  '/dist/',
  '/vendor/',
  '.test.',
  '.spec.',
  '/test/',
  '/tests/',
  '/migrations/',
  '.config.',
];

function isJunkPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JUNK_PATH_PATTERNS.some((p) => lower.includes(p));
}

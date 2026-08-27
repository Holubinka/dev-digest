import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  SkillFetcher,
  PromptTemplates,
  RunnerBundle,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { PullsRepository } from '../modules/pulls/repository.js';
import { SettingsRepository } from '../modules/settings/repository.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import type { IntentDeriver } from '../modules/intent/types.js';
import type { BlastReader } from '../modules/blast/types.js';
import { BlastService } from '../modules/blast/service.js';
import { BlastRepository } from '../modules/blast/repository.js';
import type { BriefReader } from '../modules/brief/types.js';
import { BriefService } from '../modules/brief/service.js';
import { BriefRepository } from '../modules/brief/repository.js';
import type { OnboardingGenerator, OnboardingReader } from '../modules/onboarding/types.js';
import { OnboardingService } from '../modules/onboarding/service.js';
import { OnboardingRepository } from '../modules/onboarding/repository.js';
import { OnboardingGenerateExecutor } from '../modules/onboarding/generate-executor.js';
import { IntentService } from '../modules/intent/service.js';
import { IntentRepository } from '../modules/intent/repository.js';
import type { ProjectContextResolver } from '../modules/context/types.js';
import { ContextService } from '../modules/context/service.js';
import { ContextRepository } from '../modules/context/repository.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { HttpSkillFetcher } from '../adapters/skill-fetch/index.js';
import { FilePromptTemplates } from '../adapters/prompts/file-templates.js';
import { FileRunnerBundle } from '../adapters/runner-bundle/index.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /**
   * Catch-all for every provider id `llm` does not name — consulted BEFORE any
   * key lookup, so a container carrying one reaches no secret and no network for
   * any provider at all.
   *
   * It exists because the set of ids a run touches is no longer knowable when
   * the container is built. Before 05 every LLM call in a review used the
   * agent's own provider, which a test could name; the intent pre-pass resolves
   * a SECOND provider from `settings.feature_models`, so which id
   * `container.llm` is asked for depends on a database row. `llm` alone can
   * therefore only ever be an incomplete allowlist, and a test relying on that
   * gap is relying on the failure path — a missing key throwing `ConfigError` —
   * rather than on an override.
   *
   * A sibling field rather than a `fallback` key inside `llm`: the record is
   * keyed by provider id, and a magic member would widen that union so
   * `container.llm('fallback')` type-checks, and would collide outright the day
   * a provider is called that.
   */
  llmFallback?: LLMProvider;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** PR intent derivation (05) — tests inject a canned deriver. */
  intent?: IntentDeriver;
  /** Blast radius (07) — the brief's tests inject a canned view instead of an index. */
  blast?: BlastReader;
  /** Risk Brief (10) — injectable for the same reason every other service here is. */
  brief?: BriefReader;
  /** Onboarding Tour (11) — the routes' own tests inject a canned page and record. */
  onboarding?: OnboardingReader;
  /**
   * The tour's ONE model call. Overridden by every `onboarding` integration test:
   * a canned draft is what keeps a suite that reaches the real routes off the
   * network and off a paid provider.
   */
  onboardingGenerator?: OnboardingGenerator;
  /**
   * Project Context (08) — a review test injects a canned resolver and reaches
   * no clone and no `repo_docs` row at all.
   */
  projectContext?: ProjectContextResolver;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /** Skill import by URL — tests inject a canned document instead of a network. */
  skillFetcher?: SkillFetcher;
  /** Instruction templates — tests inject canned text instead of reading `src/prompts`. */
  prompts?: PromptTemplates;
  /**
   * The built CI runner (16) — tests inject a fixture instead of requiring
   * `agent-runner/dist`, which is git-ignored and absent until it is built.
   */
  runnerBundle?: RunnerBundle;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _reviewRepo?: ReviewRepository;
  private _pullsRepo?: PullsRepository;
  private _settingsRepo?: SettingsRepository;
  private _repoIntel?: RepoIntel;
  private _intentService?: IntentDeriver;
  private _blastService?: BlastReader;
  private _briefService?: BriefReader;
  private _onboardingService?: OnboardingReader;
  private _onboardingGenerator?: OnboardingGenerator;
  private _projectContext?: ProjectContextResolver;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _skillFetcher?: SkillFetcher;
  private _prompts?: PromptTemplates;
  private _runnerBundle?: RunnerBundle;
  private _priceBook?: PriceBook;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get skillFetcher(): SkillFetcher {
    if (this.overrides.skillFetcher) return this.overrides.skillFetcher;
    this._skillFetcher ??= new HttpSkillFetcher();
    return this._skillFetcher;
  }

  /**
   * Instruction templates. A port because the implementation reads
   * `src/prompts/*.md`, and a service may not touch the filesystem — an
   * indirection through a loader module satisfies `no-fs-in-service` while
   * breaking what it stands for, so the rule cannot be the thing that enforces
   * this.
   */
  get prompts(): PromptTemplates {
    if (this.overrides.prompts) return this.overrides.prompts;
    this._prompts ??= new FilePromptTemplates();
    return this._prompts;
  }

  /**
   * The built `.devdigest/runner.mjs` the export commits into a target
   * repository. A port for the reason `prompts` is one — the implementation
   * reads the filesystem and the generator may not — and the reason it is
   * injectable is that `agent-runner/dist` is a BUILD OUTPUT: without an
   * override every test of the export would need `npm run build` to have run.
   */
  get runnerBundle(): RunnerBundle {
    if (this.overrides.runnerBundle) return this.overrides.runnerBundle;
    this._runnerBundle ??= new FileRunnerBundle();
    return this._runnerBundle;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  /**
   * PR-list data-access. Wired here rather than in `pulls/routes.ts` because
   * `pulls` has no service to own it, and a route naming `container.db` to
   * build a repository is the very thing the repository was extracted to stop.
   */
  get pullsRepo(): PullsRepository {
    return (this._pullsRepo ??= new PullsRepository(this.db));
  }

  /**
   * Non-secret preference rows. Hung off the container so
   * `modules/_shared/feature-models.ts` can resolve a workspace's model choice
   * without holding Drizzle itself and without importing the settings slice.
   */
  get settingsRepo(): SettingsRepository {
    return (this._settingsRepo ??= new SettingsRepository(this.db));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /**
   * PR intent derivation (05). The review pre-pass consumes it through the
   * container rather than an import: `modules/reviews/**` may not reach into
   * `modules/intent/**` (`no-cross-module`), and a barrel does not help.
   */
  get intentService(): IntentDeriver {
    if (this.overrides.intent) return this.overrides.intent;
    // The repository is built HERE, not defaulted inside the service: naming a
    // concrete type is the composition root's job, and it is what keeps `Db`
    // off `IntentContainer`, the port `IntentService` codes against.
    return (this._intentService ??= new IntentService(this, new IntentRepository(this.db)));
  }

  /**
   * Blast radius (07). The Risk Brief reads it through this interface rather
   * than an import: `modules/brief/**` may not reach into `modules/blast/**`
   * (`no-cross-module`), and `import type` counts.
   *
   * `blast/routes.ts` uses this getter too, instead of constructing its own
   * instance. One owner is the point: two live `BlastService`s answering the
   * same question is the drift `intentService` was created to prevent.
   */
  get blastService(): BlastReader {
    if (this.overrides.blast) return this.overrides.blast;
    return (this._blastService ??= new BlastService(this, new BlastRepository(this.db)));
  }

  /**
   * Risk Brief (10). MEMOISED, and that is the point rather than a convenience:
   * `BriefService` carries the single-flight map that makes AC-45 true — two
   * tabs on one PR state pay for one model call — and a map on a second instance
   * is not the same lock. Constructing it in `brief/routes.ts` made that
   * correctness depend on module registration running exactly once; the first
   * non-HTTP caller (MCP, a review executor) would have had a fresh empty Map
   * and no way to know.
   *
   * The repository is built HERE, like `intentService`'s and `blastService`'s:
   * naming a concrete type is the composition root's job, and it is what keeps
   * `Db` off `BriefContainer`, the port `BriefService` codes against.
   */
  get briefService(): BriefReader {
    if (this.overrides.brief) return this.overrides.brief;
    return (this._briefService ??= new BriefService(this, new BriefRepository(this.db)));
  }

  /**
   * Onboarding Tour (11). MEMOISED, for the reason `briefService` is: the
   * service carries the single-flight map that makes AC-74 true — two people
   * pressing Generate on one repo within the same second pay for one model call
   * — and a map on a second instance is not the same lock. Constructing it in
   * `onboarding/routes.ts` would make that correctness depend on module
   * registration running exactly once, and `pnpm arch` cannot see the
   * difference.
   *
   * The repository is built HERE, like every other service's: naming a concrete
   * type is the composition root's job, and it is what keeps `Db` off
   * `OnboardingContainer`, the port `OnboardingService` codes against.
   */
  get onboardingService(): OnboardingReader {
    if (this.overrides.onboarding) return this.overrides.onboarding;
    return (this._onboardingService ??= new OnboardingService(
      this,
      new OnboardingRepository(this.db),
    ));
  }

  /**
   * The tour's generation half — gather, one structured call, ground, hand back
   * a draft. It writes nothing and reads no index state; this container is where
   * the two halves meet.
   *
   * The port keeps its role name (`OnboardingGenerator`) rather than the class's,
   * because this file imports both and two identical names collide. Same shape as
   * `BriefReader` implemented by `BriefService`.
   */
  get onboardingGenerator(): OnboardingGenerator {
    if (this.overrides.onboardingGenerator) return this.overrides.onboardingGenerator;
    return (this._onboardingGenerator ??= new OnboardingGenerateExecutor(this));
  }

  /**
   * Project Context (08). The review executor resolves an agent's effective set
   * through this interface rather than an import: `modules/reviews/**` may not
   * reach into `modules/context/**` (`no-cross-module`).
   */
  get projectContext(): ProjectContextResolver {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    // The repository is built HERE, not defaulted inside the service: naming a
    // concrete type is the composition root's job, and it is what keeps `Db`
    // off `ContextContainer`, the port `ContextService` codes against.
    return (this._projectContext ??= new ContextService(this, new ContextRepository(this.db)));
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    // Before the secret, before the cache: `llmFallback` is what makes "this run
    // touches no live LLM" expressible for a provider chosen from data.
    if (this.overrides.llmFallback) return this.overrides.llmFallback;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}

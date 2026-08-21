import type {
  DiscoveredPackage,
  OnboardingGenerationContainer,
  OnboardingRepoRef,
  OnboardingSources,
} from './generation-types.js';
import {
  COMPOSE_FILES,
  LOCKFILES,
  MAX_DOC_FILE_BYTES,
  MAX_PACKAGES,
  MAX_SAMPLE_FILE_BYTES,
  MIN_FILE_CHARS,
  PACKAGE_CONFIG_FILES,
  PACKAGE_DOC_FILES,
  PACKAGE_MANIFEST,
  PACKAGE_SCAN_DEPTH,
  PACKAGE_SCAN_LIMIT,
  PATH_PROBE_BYTES,
  PROJECT_DOC_PATHS,
  REPO_MAP_TOKEN_BUDGET,
  SAMPLE_FILE_COUNT,
} from './constants.js';
import {
  managerFor,
  manifestPathFor,
  packageDirOf,
  parseManifest,
  pathBeside,
  selectPackages,
} from './packages.js';

/** Just enough of a repo to reach its clone. */
type CloneRef = { owner: string; name: string };

/**
 * Everything the model is allowed to see, and nothing else.
 *
 * This is the whole answer to "where did that come from" for every claim the
 * tour later makes: five inputs, each read through a port, each recorded with
 * the path it came from. A section can only be grounded against what this
 * returned, so an input missing here becomes an EMPTY section with a reason —
 * never a plausible substitute (AC-67).
 *
 * Named `*-executor` for the architecture rules rather than for the prose:
 * `.dependency-cruiser.cjs` matches that suffix for `no-fs-in-service` and
 * `no-service-to-adapter-impl`, so the clone is reached through `GitClient` and
 * never through `node:fs`, and the concrete adapter cannot be named here. It is
 * what makes the whole gather testable over `MockGitClient` with no repository
 * on disk.
 *
 * It writes nothing and decides nothing about the model call; `generate-executor.ts`
 * does both.
 */
export class OnboardingGatherExecutor {
  constructor(private container: OnboardingGenerationContainer) {}

  /**
   * Read the five inputs, in priority order.
   *
   * A missing FILE is the normal case and never an error — every read is
   * `.catch(() => null)`, exactly as `ConventionsService.readMany` treats it: a
   * repository decides which of `.env.example`, `AGENTS.md` or a lock file it
   * has, and the answer "it does not" is an input, not a failure.
   *
   * A missing CLONE is not in that class and is deliberately left to throw: the
   * walk failing means there is nothing to describe at all, and the alternative
   * — an empty scan — would store a complete-looking tour of five empty sections
   * with no explanation anywhere for a reader or an operator.
   *
   * Likewise the facade reads are not caught. `getRepoMap` answers `degraded`
   * with empty text and the two graph reads answer `[]` when a repository has no
   * index, so the empty-input path is already theirs to express; a throw from
   * one of them is a real fault and reads as one.
   */
  async gather(repo: OnboardingRepoRef): Promise<OnboardingSources> {
    const ref: CloneRef = { owner: repo.owner, name: repo.name };
    /**
     * Every path a read or the walk returned successfully — i.e. proven to exist
     * in the clone AS IT IS NOW.
     *
     * The chains and the ranked list are deliberately NOT added: they are rows
     * out of the index, which describes the repository at the commit it was
     * built from, and a file deleted since is still in them. Only a sampled file
     * that was actually read joins the set. Grounding intersects the model's
     * claims with this first and probes the rest, so a stale index costs a probe
     * here and never a link to a file that is gone.
     */
    const knownPaths = new Set<string>();

    const map = await this.container.repoIntel.getRepoMap(repo.id, REPO_MAP_TOKEN_BUDGET);

    const { packages, package_scan } = await this.discoverPackages(ref, repo, knownPaths);

    const chains = await this.container.repoIntel.getCriticalPaths(repo.id);

    const ranked = await this.container.repoIntel.getTopFilesByRank(repo.id, SAMPLE_FILE_COUNT);
    const samples: { path: string; text: string }[] = [];
    for (const path of ranked) {
      const text = await this.read(ref, path, MAX_SAMPLE_FILE_BYTES, knownPaths);
      // Ranking rewards being imported everywhere, which a nine-line barrel also
      // is. There is nothing to learn from one, and it still costs a slot.
      if (text === null || text.length < MIN_FILE_CHARS) continue;
      samples.push({ path, text });
    }

    const envSources = await this.readConfigs(ref, packages, knownPaths);
    const composeSources = await this.readCompose(ref, knownPaths);
    const docs = await this.readDocs(ref, packages, knownPaths);

    return {
      repoMap: { text: map.text, tokens: map.tokens },
      chains,
      ranked,
      packages,
      package_scan,
      envSources,
      composeSources,
      samples,
      docs,
      knownPaths,
    };
  }

  /**
   * Find the packages, then describe the ones that are shown.
   *
   * The walk asks for a NAME, and asks for more matches than can be shown. Both
   * halves are the same criterion (AC-91): `package.json` is not an extension —
   * `.json` returns every fixture in the repository — and `maxFiles` counts
   * matches, not files visited, so the ceiling is spent on manifests.
   *
   * The root package surviving the ceiling is the PORT's property, not this
   * method's: `listFiles` returns shallowest first, so a root `package.json`
   * cannot be cut by `maxFiles` while any manifest at all is returned. Counting
   * matches was once claimed to do that job and does not — it raises the
   * threshold and leaves the alphabetical slice in place, which is how 65
   * `apps/aNNN/package.json` used to hide the root behind a ceiling of 64.
   * `PACKAGE_SCAN_LIMIT` is still larger than `MAX_PACKAGES` so that the twelve
   * shown are chosen after `selectPackages` orders them, never by the walk.
   */
  private async discoverPackages(
    ref: CloneRef,
    repo: OnboardingRepoRef,
    knownPaths: Set<string>,
  ): Promise<{ packages: DiscoveredPackage[]; package_scan: OnboardingSources['package_scan'] }> {
    const walk = await this.container.git.listFiles(ref, {
      roots: ['.'],
      extensions: [],
      names: [PACKAGE_MANIFEST],
      maxDepth: PACKAGE_SCAN_DEPTH,
      maxFiles: PACKAGE_SCAN_LIMIT,
      maxFileBytes: MAX_SAMPLE_FILE_BYTES,
    });

    // EVERY manifest the walk returned, not only the ones that will be shown:
    // the port listed them off the disk a step ago, so a manifest the ceiling
    // cuts is proven to exist exactly as much as one it keeps. Left out,
    // grounding spends a probe re-asking a question already answered, and past
    // `MAX_PATH_PROBES` drops the link as `unknown_path` — this run reporting
    // "no such file" about a file it found itself.
    for (const file of walk.files) knownPaths.add(file.path);

    const { shown, found } = selectPackages(
      walk.files.map((file) => packageDirOf(file.path)),
      MAX_PACKAGES,
    );

    const packages: DiscoveredPackage[] = [];
    for (const dir of shown) {
      packages.push(await this.describePackage(ref, repo, dir, knownPaths));
    }

    return {
      packages,
      package_scan: {
        depth: PACKAGE_SCAN_DEPTH,
        // Reported BY the walk, not restated here: which directories were
        // skipped is a fact only the adapter has, and a copy of the list in this
        // module was a third one of the same eight names (R36/AC-93).
        excluded_dirs: walk.excludedDirs,
        found,
        shown: packages.length,
        bounded: walk.bounded,
      },
    };
  }

  /**
   * One package's evidence: what it calls itself, which scripts it declares, and
   * which lock files sit beside it.
   *
   * The manifest is re-read rather than taken from the walk because `listFiles`
   * returns names and sizes, not content. Each lock file is PROBED at one byte:
   * the question is only whether it is there, and pulling a 400 kB
   * `pnpm-lock.yaml` to learn that is an existence check priced like a download.
   *
   * The manifest is read at the same bound the walk filtered on, so a manifest
   * the walk was willing to return is one this can read whole.
   */
  private async describePackage(
    ref: CloneRef,
    repo: OnboardingRepoRef,
    dir: string,
    knownPaths: Set<string>,
  ): Promise<DiscoveredPackage> {
    const manifestPath = manifestPathFor(dir);
    const raw = await this.read(ref, manifestPath, MAX_SAMPLE_FILE_BYTES, knownPaths);
    const manifest = raw === null ? { scripts: [] } : parseManifest(raw);

    const lockfiles: string[] = [];
    for (const lockfile of Object.keys(LOCKFILES)) {
      const probe = await this.read(ref, pathBeside(dir, lockfile), PATH_PROBE_BYTES, knownPaths);
      if (probe !== null) lockfiles.push(lockfile);
    }

    return {
      // The manifest's own name, else the directory it sits in — and for the
      // root package that directory is `.`, which names nothing, so the
      // repository's own name stands in. It comes from the repo record, not from
      // the clone and not from the model.
      name: manifest.name ?? (dir === '.' ? repo.name : (dir.split('/').at(-1) ?? dir)),
      path: dir,
      manager: managerFor(lockfiles),
      scripts: manifest.scripts,
      lockfiles,
    };
  }

  /**
   * The config files a variable may be named from (AC-21), and the `.env.example`
   * a `cp` setup command is authorised by.
   *
   * Beside every shown package AND at the clone root, deduplicated. The root is
   * probed unconditionally rather than only when a root package exists, because
   * the two questions are not the same one: a repository can have an
   * `.env.example` and no `package.json` at all, and it still has to be told to
   * copy it.
   */
  private async readConfigs(
    ref: CloneRef,
    packages: DiscoveredPackage[],
    knownPaths: Set<string>,
  ): Promise<{ path: string; text: string }[]> {
    const wanted = new Set<string>();
    for (const dir of ['.', ...packages.map((pkg) => pkg.path)]) {
      for (const name of PACKAGE_CONFIG_FILES) wanted.add(pathBeside(dir, name));
    }
    return this.readAll(ref, [...wanted], knownPaths, MAX_SAMPLE_FILE_BYTES);
  }

  /**
   * The compose file at the clone root, read for its TEXT.
   *
   * The FIRST one that exists, in `COMPOSE_FILES` order, and then it stops —
   * which is the order Docker Compose itself resolves in. Reading all four would
   * be worse than useless here: a `docker compose up -d postgres redis` is
   * authorised by the file the tool would actually load, and gathering a service
   * name out of a `docker-compose.yml` that `compose.yaml` shadows would
   * authorise a command that does nothing when the reader runs it.
   *
   * The raw text, not a parsed service list. Whether a service is declared is
   * grounding's question, and answering it here would mean a YAML parser — a new
   * dependency for one field, over untrusted repository content, where a
   * substring of the file already answers what the command claims.
   */
  private async readCompose(
    ref: CloneRef,
    knownPaths: Set<string>,
  ): Promise<{ path: string; text: string }[]> {
    for (const name of COMPOSE_FILES) {
      const text = await this.read(ref, name, MAX_SAMPLE_FILE_BYTES, knownPaths);
      if (text !== null && text.trim() !== '') return [{ path: name, text }];
    }
    return [];
  }

  /**
   * The repository's own prose: `README.md` and `AGENTS.md` at the root, plus
   * the `README.md` beside every SHOWN package — the lowest-priority input.
   *
   * Beside the shown packages and not beside every manifest the walk returned,
   * for the same reason `readConfigs` uses that list: the packages the reader is
   * told about are the ones the model is given material for, and a document from
   * a package no block names is context for something invisible.
   *
   * Root FIRST, and the order is the priority: the walk offers these one
   * document at a time and stops at the first that does not fit, so what a
   * repository says about itself outranks what one of its packages says. The set
   * deduplicates, which is what keeps a repository WITH a root `package.json`
   * from offering `README.md` twice — `pathBeside('.', 'README.md')` is the same
   * string `PROJECT_DOC_PATHS` already holds.
   *
   * Read at `MAX_DOC_FILE_BYTES` rather than at the sample bound: `readFile`
   * fills a fixed buffer, so this is the step where the ceiling is real, and a
   * cap applied to the returned string would already have paid for the whole of
   * a 13 kB README.
   */
  private async readDocs(
    ref: CloneRef,
    packages: DiscoveredPackage[],
    knownPaths: Set<string>,
  ): Promise<{ path: string; text: string }[]> {
    const wanted = new Set<string>(PROJECT_DOC_PATHS);
    for (const pkg of packages) {
      for (const name of PACKAGE_DOC_FILES) wanted.add(pathBeside(pkg.path, name));
    }
    return this.readAll(ref, [...wanted], knownPaths, MAX_DOC_FILE_BYTES);
  }

  /**
   * Read what is there and skip what is not.
   *
   * Blank content is skipped as well: it teaches the model nothing and would
   * still occupy an input slot. The path stays in `knownPaths` regardless — the
   * read succeeded, so the file exists, and that is a different question from
   * whether it had anything in it.
   *
   * `maxBytes` is a parameter because the callers genuinely differ: a config
   * file is evidence a variable name is quoted out of, a document is prose read
   * for orientation, and folding them into one number would silently move one of
   * them.
   */
  private async readAll(
    ref: CloneRef,
    paths: string[],
    knownPaths: Set<string>,
    maxBytes: number,
  ): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = [];
    for (const path of paths) {
      const text = await this.read(ref, path, maxBytes, knownPaths);
      if (text !== null && text.trim() !== '') out.push({ path, text });
    }
    return out;
  }

  /**
   * One bounded read through the port, `null` when it did not happen.
   *
   * `null` rather than `''` because a zero-byte file that exists and a file that
   * does not are different answers, and the lock-file probe turns on exactly
   * that distinction: an empty `yarn.lock` still dictates yarn.
   */
  private async read(
    ref: CloneRef,
    path: string,
    maxBytes: number,
    knownPaths: Set<string>,
  ): Promise<string | null> {
    const text = await this.container.git.readFile(ref, path, maxBytes).catch(() => null);
    if (text === null) return null;
    knownPaths.add(path);
    return text;
  }
}

import { simpleGit, type SimpleGit } from 'simple-git';
import { randomBytes } from 'node:crypto';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import {
  mkdir,
  open,
  access,
  rm,
  rename,
  lstat,
  realpath,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  ClonedFile,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { CloneReadError, CloneWriteError } from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';
import { EXCLUDED_WALK_DIRS } from './constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_WALK_DIRS);

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

/**
 * Does a clone-relative path enter a git directory at any depth?
 *
 * One function because `readFile` and `writeTarget` must answer it identically,
 * and until 2026-08-16 they each tested `segments[0]` alone — so `docs/vendor/.git/`
 * in a nested repository was refused by neither, while both carried a comment
 * saying the git directory is refused. The string gate in
 * `modules/_shared/repo-paths.ts` makes the same check on the way in; this is the
 * one that still holds after `realpath` has resolved a link.
 *
 * Case-folded: macOS resolves `.GIT` to the same directory, so an exact compare
 * refuses the path a caller typed and admits the one it did not.
 */
function isGitDirPath(relativePath: string): boolean {
  return relativePath
    .split(sep)
    .some((segment) => segment.toLowerCase() === '.git');
}

/**
 * GitClient over simple-git. Repos clone to
 * `<cloneDir>/<owner>/<repo>`. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(private cloneDir: string) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
  }

  clonePathFor(repo: RepoRef): string {
    return join(this.cloneDir, repo.owner, repo.name);
  }

  private git(repo: RepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    await mkdir(join(this.cloneDir, repo.owner), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      // already cloned → fetch latest
      await simpleGit(dest).fetch();
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    return { path: dest };
  }

  async fetchPullHead(repo: RepoRef, n: number): Promise<void> {
    // Fetch the PR head ref into a local ref (GitHub exposes pull/<n>/head).
    await this.git(repo).fetch(['origin', `pull/${n}/head:pr-${n}`]);
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the mirror to upstream. A bare `fetch` only moves `origin/<branch>`,
    // so we `reset --hard` to advance local HEAD + worktree.
    //
    // The clone is NO LONGER read-only. `writeFile` below authors documents into
    // it, so what `reset --hard` does to them is a behaviour of this feature
    // rather than a non-question:
    //
    //   - An UNTRACKED file survives. `reset --hard` moves tracked paths only,
    //     which is exactly why documents created here live under `.devdigest/`
    //     and are the whole durability mechanism (`AC-65`).
    //   - An edit to a TRACKED file is DESTROYED, silently and with no prompt —
    //     the file goes back to whatever the branch says. That is the erasure
    //     `AC-70` makes the editor warn about before it saves, and `AC-71` is how
    //     the page reports it after the fact.
    //
    // We still never commit to, push from, or run code from the clone.
    //
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = this.git(repo);
    await g.fetch(['origin', branch, '--depth', String(RESYNC_FETCH_DEPTH)]);
    await g.reset(['--hard', `origin/${branch}`]);
    return { head: (await g.revparse(['HEAD'])).trim() };
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    const raw = await this.git(repo).diff([`${base}...${head}`]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  /**
   * Read one file out of the clone, refusing anything that resolves outside it
   * or into its git directory.
   *
   * `path` reaches here from a PR body (`modules/intent`), so on a public repo
   * it is attacker-controlled. The caller sanitises it as a *string* — no `..`
   * segment, no absolute path, `.md` only — and a string check cannot see the
   * filesystem: a repo may commit `docs/plan.md` as a symlink to
   * `../../../../etc/passwd`, git materialises that verbatim on clone, and the
   * `.md` rule constrains the link's name, never its target. Only resolving the
   * path catches it, which is why the check is here and not in the caller —
   * `no-fs-in-service` forbids a service touching `node:fs` at all.
   *
   * Both sides are resolved. The clone root can itself sit under a symlink
   * (`/tmp` → `/private/tmp` on macOS), and comparing a resolved target against
   * an unresolved root would reject legitimate reads. `root + sep` is what stops
   * a sibling directory — `…/repo-evil` — satisfying a `…/repo` prefix test.
   *
   * `repo-intel/pipeline/walk.ts` already skips every symlink it walks. This is
   * that same stance for the one reader that takes a path from outside.
   *
   * Containment alone is not enough, and the second check is not redundant with
   * the first. `.git/config` carries the URL `clone()` was given, and that URL
   * has the stored GitHub PAT embedded in it (`modules/repos/helpers.ts`
   * `withGitHubToken`) — nothing rewrites the remote afterwards. So a symlink
   * aimed *back inside* at `../.git/config` satisfies every containment test
   * there is and still hands the token to the caller. `sanitizeRepoPath`
   * refuses a `.git/` prefix on the string; this is that same rule applied
   * after resolution, which is the only place a symlink is visible. The segment
   * comparison is exact, so `.github/` — a directory somebody may legitimately
   * want to read — is unaffected.
   *
   * Size is the third thing the path cannot tell you. `fs.readFile` allocates
   * the whole file before anyone can measure it, so a caller's character cap
   * runs one step too late; `open` + a fixed buffer is what makes the bound
   * real. A cut can land mid-sequence and leave one U+FFFD at the end — that is
   * the decoder behaving correctly on a truncated read, not a defect, and the
   * caller's own truncation removes it in every case but an all-4-byte file.
   */
  async readFile(repo: RepoRef, path: string, maxBytes: number): Promise<string> {
    const root = await realpath(this.clonePathFor(repo));
    let target: string;
    try {
      target = await realpath(join(root, path));
    } catch {
      // realpath fails on a path with no file at the end of it, and on a
      // dangling symlink. Both are "this document is not in the clone", which
      // the caller reports differently from a refusal.
      throw new CloneReadError('not_found', `not in the clone: ${path}`);
    }
    if (target !== root && !target.startsWith(root + sep)) {
      throw new CloneReadError('outside_clone', `refusing to read outside the clone: ${path}`);
    }
    // Any segment, not just the first: a nested repository puts a real `.git`
    // below the root, and `realpath` has already run, so this also catches a
    // link that RESOLVED into one.
    if (isGitDirPath(relative(root, target))) {
      throw new CloneReadError('git_dir', `refusing to read the clone's git directory: ${path}`);
    }
    let handle;
    try {
      handle = await open(target, 'r');
    } catch {
      throw new CloneReadError('not_found', `not in the clone: ${path}`);
    }
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }

  /**
   * Resolve a write target inside the clone, or refuse.
   *
   * A write is not a read with the arrow reversed, and this is where the two
   * part company. `readFile` resolves the path with `realpath` and then asks
   * where it landed: following a symlink is fine as long as the destination is
   * still inside the clone. A write cannot do that. A symlink is a *pointer the
   * repository committed*, so honouring one on a write means the repository
   * chooses which file DevDigest creates — `.devdigest/x.md` → `../../.git/config`
   * hands it the remote URL carrying the stored PAT, and `.devdigest/x.md` →
   * `~/.ssh/authorized_keys` does not even need to stay in the clone.
   *
   * So every existing component is `lstat`ed and a symbolic link anywhere along
   * the path is refused outright, which is the stance `walkDocs` already takes
   * for every directory it descends. Refusing is also why `realpath` is not used
   * on the target: there is nothing to resolve once links are forbidden, and
   * `realpath` fails on the last component of a create anyway.
   *
   * Containment and the `.git` refusal are still checked, on the joined and
   * normalised path — `join` is what removes any `..` a caller let through, and
   * `root + sep` is what stops a sibling `…/repo-evil` satisfying a prefix test.
   * Neither is redundant: a path can stay inside the clone and still be
   * `.git/config`. The refusal tests EVERY segment, because a nested repository
   * puts a second real `.git` somewhere below the root.
   */
  private async writeTarget(repo: RepoRef, path: string): Promise<string> {
    const root = await realpath(this.clonePathFor(repo));
    const target = join(root, path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new CloneWriteError('outside_clone', `refusing to write outside the clone: ${path}`);
    }
    const relativePath = relative(root, target);
    const segments = relativePath.split(sep).filter(Boolean);
    if (segments.length === 0) {
      throw new CloneWriteError('outside_clone', `refusing to write the clone root itself`);
    }
    if (isGitDirPath(relativePath)) {
      throw new CloneWriteError('git_dir', `refusing to write the clone's git directory: ${path}`);
    }
    let walked = root;
    for (const segment of segments) {
      walked = join(walked, segment);
      let info;
      try {
        info = await lstat(walked);
      } catch {
        // Nothing here yet, so nothing below it either: the rest of the path is
        // ours to create. A component that appears between this check and the
        // write is caught by `open(…, 'wx')`, which fails on a symlink.
        break;
      }
      if (info.isSymbolicLink()) {
        throw new CloneWriteError('symlink', `refusing to write through a symlink: ${path}`);
      }
    }
    return target;
  }

  /**
   * Write one UTF-8 document into the clone.
   *
   * The size is refused BEFORE anything is opened or allocated: a cap applied
   * after the buffer exists is a cap on nothing, and this is the same argument
   * `readFile`'s `maxBytes` makes from the other direction.
   *
   * The two modes are different syscall sequences on purpose.
   *
   *   - Create is `open(target, 'wx')` — `O_CREAT|O_EXCL`, which fails with
   *     `EEXIST` if anything is there, symlink included, in ONE syscall. An
   *     `access()` test followed by a write is two, and the gap between them is
   *     where a concurrent create silently loses a document. A write that fails
   *     part-way unlinks what it made: `AC-67` asks for nothing partial and no
   *     empty file left behind.
   *   - Overwrite writes a sibling temp file and `rename`s it over the target.
   *     `rename` within a directory is atomic, so an interrupted save leaves the
   *     ORIGINAL intact rather than a truncated file — which is the difference
   *     between losing an edit and losing the document.
   */
  async writeFile(
    repo: RepoRef,
    path: string,
    content: string,
    opts: { maxBytes: number; overwrite: boolean },
  ): Promise<{ size_bytes: number; modified_at: string }> {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > opts.maxBytes) {
      throw new CloneWriteError('too_large', `document is ${bytes} bytes, over ${opts.maxBytes}`);
    }
    const target = await this.writeTarget(repo, path);
    // The parent is created because a fresh clone has no `.devdigest/` at all,
    // so the first document would otherwise fail on ENOENT. Every existing
    // component was just checked, and `mkdir` creates plain directories.
    await mkdir(dirname(target), { recursive: true });

    if (opts.overwrite) await this.writeViaTemp(target, content);
    else await this.writeExclusive(target, content, path);

    const info = await stat(target);
    return { size_bytes: info.size, modified_at: info.mtime.toISOString() };
  }

  private async writeExclusive(target: string, content: string, path: string): Promise<void> {
    let handle;
    try {
      handle = await open(target, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CloneWriteError('exists', `already in the clone: ${path}`);
      }
      throw err;
    }
    try {
      await handle.writeFile(content, 'utf8');
    } catch (err) {
      // The file exists and is empty or half-written. Leaving it behind would
      // make the next create answer "already exists" for a document nobody has.
      await handle.close().catch(() => undefined);
      await unlink(target).catch(() => undefined);
      throw err;
    }
    await handle.close();
  }

  private async writeViaTemp(target: string, content: string): Promise<void> {
    // Same directory, so the rename is within one filesystem and therefore
    // atomic; a dot prefix and a `.tmp` suffix keep a stray one out of the `.md`
    // walk if a crash lands between the write and the rename.
    const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
    const handle = await open(temp, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.close();
      await rename(temp, target);
    } catch (err) {
      await handle.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Create a directory inside the clone, parents included.
   *
   * The same containment walk as `writeFile`, for the same reason: a directory
   * created through a symlinked component lands wherever the link points.
   * `recursive: true` makes an existing directory a no-op — "already exists" is
   * a question about the document list, and the service answers it before ever
   * reaching here.
   */
  async makeDir(repo: RepoRef, path: string): Promise<void> {
    const target = await this.writeTarget(repo, path);
    await mkdir(target, { recursive: true });
  }

  /**
   * List files under `opts.roots` inside the clone.
   *
   * Every root is resolved before it is walked, and both sides are resolved for
   * the same reason `readFile` resolves them: the clone root can itself sit
   * under a symlink (`/tmp` → `/private/tmp`), and a repo can commit
   * `docs` as a symlink to anywhere at all. A root that escapes the clone, or
   * resolves into `.git`, contributes NOTHING rather than raising — a
   * misconfigured root is not an error the user can act on, and the `.git`
   * refusal is what keeps the PAT in `.git/config` unreadable.
   *
   * A root that simply does not exist also contributes nothing: the empty state
   * naming the roots searched is a requirement, not a failure.
   *
   * The walk itself copies `repo-intel/pipeline/walk.ts`: never descend a
   * symlink, skip the excluded directory names, sort for a reproducible
   * "first N", then cap. The extension match is case-insensitive because `.MD`
   * is a file people commit.
   *
   * A missing clone DIRECTORY is different and does throw — the caller maps it
   * to "no clone yet", which is not the same answer as "no documents".
   */
  async listFiles(
    repo: RepoRef,
    opts: { roots: string[]; extensions: string[]; maxFiles: number; maxFileBytes: number },
  ): Promise<{ files: ClonedFile[]; bounded: boolean }> {
    const root = await realpath(this.clonePathFor(repo));
    const wanted = new Set(opts.extensions.map((e) => e.toLowerCase()));
    const out: ClonedFile[] = [];

    for (const configured of opts.roots) {
      let target: string;
      try {
        target = await realpath(join(root, configured));
      } catch {
        continue; // root not present in this clone
      }
      if (target !== root && !target.startsWith(root + sep)) continue;
      const firstSegment = relative(root, target).split(sep)[0];
      if (firstSegment === '.git') continue;
      await this.walkDocs(root, target, wanted, opts.maxFileBytes, out);
    }

    // Sorted, then de-duplicated: two configured roots can nest ("docs" and
    // "docs/adr"), and the same file reached twice would be counted twice and
    // attached twice.
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const deduped = out.filter((f, i) => i === 0 || f.path !== out[i - 1]!.path);

    const bounded = deduped.length > opts.maxFiles;
    return { files: bounded ? deduped.slice(0, opts.maxFiles) : deduped, bounded };
  }

  private async walkDocs(
    root: string,
    dir: string,
    extensions: ReadonlySet<string>,
    maxFileBytes: number,
    out: ClonedFile[],
  ): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      // Unreadable directory (permissions, dangling link) — skip it and keep
      // making progress on the parts of the clone that CAN be read.
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow a symlink (loops, escapes)
      if (entry.isDirectory()) {
        if (EXCLUDED_SET.has(entry.name)) continue;
        await this.walkDocs(root, join(dir, entry.name), extensions, maxFileBytes, out);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.has(extname(entry.name).toLowerCase())) continue;

      const full = join(dir, entry.name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.size > maxFileBytes) continue;
      out.push({
        // Posix-style relative path so rows are platform-agnostic (the
        // `pr_files.path` convention).
        path: relative(root, full).split(sep).join('/'),
        size_bytes: info.size,
        modified_at: info.mtime.toISOString(),
      });
    }
  }
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}

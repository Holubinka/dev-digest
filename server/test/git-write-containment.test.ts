/**
 * `SimpleGitClient.writeFile` / `makeDir` containment.
 *
 * No DB and no git binary: a clone-shaped temp tree on disk, with the symlinks a
 * repository is free to commit, and assertions about what the adapter will and
 * will not CREATE.
 *
 * The sibling file `git-read-containment.test.ts` asks the same questions of the
 * reader, and the answers are deliberately different. A read that follows a
 * symlink is allowed as long as it lands inside the clone — the destination is
 * what matters, and `realpath` decides it. A write that follows one is not,
 * whatever it lands on: the link is a pointer the *repository* committed, so
 * honouring it hands the repository the choice of which file DevDigest creates.
 * `.devdigest/x.md` → `../../.git/config` replaces the remote URL that carries
 * the stored PAT; `.devdigest/x.md` → `~/.ssh/authorized_keys` does not even
 * need to stay in the clone to be interesting. Hence: any symlinked component,
 * refused.
 *
 * The other three questions are the ones a write has and a read does not — does
 * an over-cap body leave a file behind, does a create replace something, and does
 * an overwrite leave debris.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  rm,
  stat,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneWriteError } from '@devdigest/shared';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

const REPO = { owner: 'acme', name: 'payments-api' };
const TOKEN_URL = 'https://x-access-token:ghp_notarealtoken@github.com/acme/payments-api';
/** Roomy enough that no containment case below is refused for its size instead. */
const CAP = 4096;
const CREATE = { maxBytes: CAP, overwrite: false };
const OVERWRITE = { maxBytes: CAP, overwrite: true };

let cloneDir: string;
let outside: string;
let root: string;
let client: SimpleGitClient;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

beforeEach(async () => {
  // realpath because the macOS temp dir is itself a symlink (/var → /private/var).
  cloneDir = await realpath(await mkdtemp(join(tmpdir(), 'dd-wclone-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'dd-woutside-')));

  root = join(cloneDir, REPO.owner, REPO.name);
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'real.md'), 'a genuine plan');
  await writeFile(join(outside, 'target.md'), 'not ours to touch');

  // The git directory in the shape `clone()` leaves it: the remote URL carries
  // the PAT, because `withGitHubToken` builds the URL git is handed.
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${TOKEN_URL}\n`);

  // A .devdigest that is a symlink to somewhere else entirely: every path under
  // it looks ordinary, and every write through it lands outside the clone.
  await mkdir(join(root, 'linked'), { recursive: true });
  await symlink(outside, join(root, 'linked', 'escape'));
  // The attack that never leaves the clone, and so passes every containment
  // test there is: a legally named .md pointing back at the token.
  await symlink(join(root, '.git', 'config'), join(root, 'docs', 'creds.md'));

  // A sibling clone whose path shares the victim's prefix.
  await mkdir(join(cloneDir, REPO.owner, `${REPO.name}-evil`), { recursive: true });

  client = new SimpleGitClient(cloneDir);
});

afterEach(async () => {
  await rm(cloneDir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('SimpleGitClient.writeFile — creates only inside the clone', () => {
  it('creates a document under a folder that does not exist yet', async () => {
    // A fresh clone has no `.devdigest/` at all, so this is the FIRST document
    // anyone ever writes and the parent has to be made for it.
    const out = await client.writeFile(REPO, '.devdigest/specs/api.md', '# API', CREATE);
    await expect(readFile(join(root, '.devdigest', 'specs', 'api.md'), 'utf8')).resolves.toBe(
      '# API',
    );
    expect(out.size_bytes).toBe(5);
    expect(new Date(out.modified_at).getTime()).not.toBeNaN();
  });

  it('refuses a path that resolves outside the clone', async () => {
    await expect(
      client.writeFile(REPO, `../${REPO.name}-evil/x.md`, 'nope', CREATE),
    ).rejects.toMatchObject({ reason: 'outside_clone' });
    expect(await exists(join(cloneDir, REPO.owner, `${REPO.name}-evil`, 'x.md'))).toBe(false);
  });

  it('refuses to write THROUGH a symlinked directory, and creates nothing beyond it', async () => {
    await expect(
      client.writeFile(REPO, 'linked/escape/planted.md', 'planted', CREATE),
    ).rejects.toMatchObject({ reason: 'symlink' });
    // The whole point: the file did not appear at the link's destination.
    expect(await exists(join(outside, 'planted.md'))).toBe(false);
  });

  it('refuses to overwrite a symlinked FILE, leaving both it and its target alone', async () => {
    // `docs/creds.md` → `.git/config`. Following it would replace the remote URL
    // that carries the stored PAT; replacing the link itself would delete the
    // repository's own file. Neither is this feature's business.
    await expect(
      client.writeFile(REPO, 'docs/creds.md', 'overwritten', OVERWRITE),
    ).rejects.toMatchObject({ reason: 'symlink' });
    await expect(readFile(join(root, '.git', 'config'), 'utf8')).resolves.toContain(TOKEN_URL);
  });

  it('refuses a direct path into .git', async () => {
    await expect(
      client.writeFile(REPO, '.git/config', 'rewritten', OVERWRITE),
    ).rejects.toMatchObject({ reason: 'git_dir' });
    await expect(readFile(join(root, '.git', 'config'), 'utf8')).resolves.toContain(TOKEN_URL);
  });

  it('refuses an over-cap body and creates NO file — not even an empty one', async () => {
    const err = await client
      .writeFile(REPO, '.devdigest/big.md', 'x'.repeat(CAP + 1), CREATE)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloneWriteError);
    expect(err).toMatchObject({ reason: 'too_large' });
    // The bound is checked before anything is opened, which is the whole reason
    // there is nothing here to clean up.
    expect(await exists(join(root, '.devdigest', 'big.md'))).toBe(false);
  });

  it('measures the cap in BYTES, so a short string of 4-byte code points can exceed it', async () => {
    const emoji = '🙂'.repeat(4); // 4 code points, 16 bytes
    await expect(
      client.writeFile(REPO, '.devdigest/emoji.md', emoji, { maxBytes: 8, overwrite: false }),
    ).rejects.toMatchObject({ reason: 'too_large' });
    await expect(
      client.writeFile(REPO, '.devdigest/emoji.md', emoji, { maxBytes: 16, overwrite: false }),
    ).resolves.toMatchObject({ size_bytes: 16 });
  });
});

describe('SimpleGitClient.writeFile — create never replaces, overwrite never truncates', () => {
  it('refuses a create onto an existing path and leaves it byte-identical', async () => {
    const before = await readFile(join(root, 'docs', 'real.md'));
    await expect(
      client.writeFile(REPO, 'docs/real.md', 'replaced', CREATE),
    ).rejects.toMatchObject({ reason: 'exists' });
    expect(await readFile(join(root, 'docs', 'real.md'))).toEqual(before);
  });

  it('overwrites an existing document and leaves no temp file behind', async () => {
    await client.writeFile(REPO, 'docs/real.md', 'a revised plan', OVERWRITE);
    await expect(readFile(join(root, 'docs', 'real.md'), 'utf8')).resolves.toBe('a revised plan');
    // The temp sibling is what makes the rename atomic; one still on disk after a
    // successful save would eventually be walked, listed, or read as a document.
    const left = await readdir(join(root, 'docs'));
    expect(left.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(left.sort()).toEqual(['creds.md', 'real.md']);
  });

  it('creates a document that is not there yet even with overwrite on', async () => {
    await client.writeFile(REPO, '.devdigest/new.md', 'fresh', OVERWRITE);
    await expect(readFile(join(root, '.devdigest', 'new.md'), 'utf8')).resolves.toBe('fresh');
  });
});

describe('SimpleGitClient.makeDir — the same containment', () => {
  it('creates a folder under .devdigest, parents included', async () => {
    await client.makeDir(REPO, '.devdigest/specs/adr');
    expect((await stat(join(root, '.devdigest', 'specs', 'adr'))).isDirectory()).toBe(true);
  });

  it('is a no-op for a folder that already exists', async () => {
    await client.makeDir(REPO, '.devdigest/specs');
    await expect(client.makeDir(REPO, '.devdigest/specs')).resolves.toBeUndefined();
  });

  it('refuses to create a folder through a symlink, or outside the clone, or in .git', async () => {
    await expect(client.makeDir(REPO, 'linked/escape/planted')).rejects.toMatchObject({
      reason: 'symlink',
    });
    expect(await exists(join(outside, 'planted'))).toBe(false);
    await expect(client.makeDir(REPO, `../${REPO.name}-evil/planted`)).rejects.toMatchObject({
      reason: 'outside_clone',
    });
    await expect(client.makeDir(REPO, '.git/hooks')).rejects.toMatchObject({ reason: 'git_dir' });
  });
});

/**
 * The refusal travels as DATA, for the same reason `CloneReadError`'s does: the
 * service maps each reason to a different status code — `exists` is a 409 and
 * `symlink` a 400 — and matching on a message to do that is a distinction the
 * next reword silently inverts.
 */
describe('CloneWriteError', () => {
  it('carries its reason as data', async () => {
    const err = await client
      .writeFile(REPO, 'docs/real.md', 'x', CREATE)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloneWriteError);
    expect(err).toBeInstanceOf(Error);
    expect((err as CloneWriteError).reason).toBe('exists');
  });
});

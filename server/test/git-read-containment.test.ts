/**
 * `SimpleGitClient.readFile` containment.
 *
 * No DB and no git binary: builds a clone-shaped temp tree on disk, including a
 * symlink that escapes it, and asserts what the adapter will and will not read.
 *
 * The escape is the point. `modules/intent` takes a path out of a PR body —
 * attacker-controlled on a public repo — and sanitises it as a string: no `..`
 * segment, no absolute path, `.md` only. A repo can still commit `docs/plan.md`
 * as a symlink to `../../../../etc/passwd`; git materialises that verbatim on
 * clone, and the `.md` rule constrains the link's name, never its target. Only
 * resolving the path catches it.
 *
 * There are two escapes, and only the first one leaves. The second stays put:
 * `docs/plan.md` → `../.git/config` satisfies every containment test there is
 * and still reaches the GitHub PAT that `withGitHubToken` embedded in the
 * remote URL. Both are exercised below, because a check that stops one and
 * waves the other through is the state this file was written in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

const REPO = { owner: 'acme', name: 'payments-api' };
const TOKEN_URL = 'https://x-access-token:ghp_notarealtoken@github.com/acme/payments-api';
/** Roomy enough that no containment case below is truncated by accident. */
const CAP = 4096;

let cloneDir: string;
let outside: string;
let client: SimpleGitClient;

beforeEach(async () => {
  // realpath because the macOS temp dir is itself a symlink (/var → /private/var).
  // Passing the unresolved path as cloneDir is what a wrong implementation —
  // one that resolves the target but not the root — would reject.
  cloneDir = await realpath(await mkdtemp(join(tmpdir(), 'dd-clone-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'dd-outside-')));

  const root = join(cloneDir, REPO.owner, REPO.name);
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'real.md'), 'a genuine plan');
  await writeFile(join(root, 'inner.md'), 'inside the clone');
  await writeFile(join(outside, 'passwd'), 'root:x:0:0:root:/root:/bin/sh');

  // The attack: a legally named, legally placed .md that points out of the tree.
  await symlink(join(outside, 'passwd'), join(root, 'docs', 'plan.md'));
  // A symlink that stays inside must keep working — containment, not a symlink ban.
  await symlink(join(root, 'inner.md'), join(root, 'docs', 'alias.md'));
  // A sibling clone whose path shares the victim's prefix: `…/payments-api-evil`
  // satisfies a naive startsWith(`…/payments-api`) test.
  await mkdir(join(cloneDir, REPO.owner, `${REPO.name}-evil`), { recursive: true });
  await writeFile(join(cloneDir, REPO.owner, `${REPO.name}-evil`, 'x.md'), 'not yours');

  // The git directory in the shape `clone()` leaves it: the remote URL carries
  // the PAT, because `withGitHubToken` builds the URL git is handed.
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${TOKEN_URL}\n`);
  // The attack that never leaves the clone, and so passes containment.
  await symlink(join(root, '.git', 'config'), join(root, 'docs', 'creds.md'));
  // `.github` is not `.git`, and the segment test is exact — this must be readable.
  await mkdir(join(root, '.github'), { recursive: true });
  await writeFile(join(root, '.github', 'notes.md'), 'a workflow note');
  // Comfortably past any cap the size tests below pass in.
  await writeFile(join(root, 'docs', 'big.md'), 'x'.repeat(50_000));

  client = new SimpleGitClient(cloneDir);
});

afterEach(async () => {
  await rm(cloneDir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('SimpleGitClient.readFile — stays inside the clone', () => {
  it('reads an ordinary file', async () => {
    await expect(client.readFile(REPO, 'docs/real.md', CAP)).resolves.toBe('a genuine plan');
  });

  it('follows a symlink that stays inside the clone', async () => {
    await expect(client.readFile(REPO, 'docs/alias.md', CAP)).resolves.toBe('inside the clone');
  });

  it('refuses a symlink that resolves outside the clone', async () => {
    await expect(client.readFile(REPO, 'docs/plan.md', CAP)).rejects.toThrow(
      /refusing to read outside the clone/,
    );
  });

  it('refuses a sibling directory that merely shares the clone path prefix', async () => {
    await expect(client.readFile(REPO, `../${REPO.name}-evil/x.md`, CAP)).rejects.toThrow(
      /refusing to read outside the clone/,
    );
  });

  it('still fails for a file that is simply absent', async () => {
    await expect(client.readFile(REPO, 'docs/missing.md', CAP)).rejects.toThrow();
  });
});

/**
 * The half containment cannot see. Every path here resolves *inside* the clone,
 * so `startsWith(root + sep)` is satisfied by all of them and stops none.
 */
describe('SimpleGitClient.readFile — stays out of the git directory', () => {
  it("refuses a symlink that resolves into the clone's own .git", async () => {
    await expect(client.readFile(REPO, 'docs/creds.md', CAP)).rejects.toThrow(
      /refusing to read the clone's git directory/,
    );
  });

  it('refuses a direct path into .git', async () => {
    await expect(client.readFile(REPO, '.git/config', CAP)).rejects.toThrow(
      /refusing to read the clone's git directory/,
    );
  });

  it('reads under .github, which is a different directory', async () => {
    await expect(client.readFile(REPO, '.github/notes.md', CAP)).resolves.toBe('a workflow note');
  });
});

/**
 * The third thing a path cannot tell you. `fs.readFile` allocates the whole file
 * before any caller can measure it, so a character cap applied to the returned
 * string is one step too late for a repo that committed a 400 MB `plan.md`.
 */
describe('SimpleGitClient.readFile — bounded by the read itself', () => {
  it('returns at most maxBytes, whatever the file weighs', async () => {
    await expect(client.readFile(REPO, 'docs/big.md', 100)).resolves.toHaveLength(100);
  });

  /** The buffer is zero-filled, so returning it whole pads a short file with NULs. */
  it('returns a short file whole, with no padding up to maxBytes', async () => {
    await expect(client.readFile(REPO, 'docs/real.md', CAP)).resolves.toBe('a genuine plan');
  });
});

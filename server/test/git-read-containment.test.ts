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
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

const REPO = { owner: 'acme', name: 'payments-api' };

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

  client = new SimpleGitClient(cloneDir);
});

afterEach(async () => {
  await rm(cloneDir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('SimpleGitClient.readFile — stays inside the clone', () => {
  it('reads an ordinary file', async () => {
    await expect(client.readFile(REPO, 'docs/real.md')).resolves.toBe('a genuine plan');
  });

  it('follows a symlink that stays inside the clone', async () => {
    await expect(client.readFile(REPO, 'docs/alias.md')).resolves.toBe('inside the clone');
  });

  it('refuses a symlink that resolves outside the clone', async () => {
    await expect(client.readFile(REPO, 'docs/plan.md')).rejects.toThrow(
      /refusing to read outside the clone/,
    );
  });

  it('refuses a sibling directory that merely shares the clone path prefix', async () => {
    await expect(client.readFile(REPO, `../${REPO.name}-evil/x.md`)).rejects.toThrow(
      /refusing to read outside the clone/,
    );
  });

  it('still fails for a file that is simply absent', async () => {
    await expect(client.readFile(REPO, 'docs/missing.md')).rejects.toThrow();
  });
});

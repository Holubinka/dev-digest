/**
 * P3.2 — the `RunnerBundle` adapter over `agent-runner/dist`.
 *
 * The directory is a constructor parameter so this suite needs no build to have
 * run; the DEFAULT path — four levels up from this module — is what the real
 * export exercises, and is deliberately not asserted here, because a test that
 * reads the checked-out `agent-runner/dist` passes or fails on whether someone
 * ran `npm run build`, not on whether this code is right.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunnerBundle } from '../src/adapters/runner-bundle/index.js';
import { ConfigError } from '../src/platform/errors.js';

const BANNER =
  '// DevDigest agent-runner v0.1.0 — built from e59ab5739c40980be0d229fff4c895e242e10ab5\n' +
  '// generated — do not edit\nconsole.log(1);\n';

let dir: string;
let empty: string;
let broken: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dd-runner-'));
  empty = await mkdtemp(join(tmpdir(), 'dd-runner-empty-'));
  broken = await mkdtemp(join(tmpdir(), 'dd-runner-broken-'));
  await writeFile(join(dir, 'runner.mjs'), BANNER, 'utf8');
  await writeFile(
    join(dir, 'runner.meta.json'),
    JSON.stringify({ version: '0.1.0', sourceSha: 'e59ab5739c40', bytes: 1 }),
    'utf8',
  );
  await writeFile(join(broken, 'runner.mjs'), BANNER, 'utf8');
  await writeFile(join(broken, 'runner.meta.json'), 'not json', 'utf8');
});

afterAll(async () => {
  await Promise.all([dir, empty, broken].map((d) => rm(d, { recursive: true, force: true })));
});

describe('FileRunnerBundle', () => {
  it('hands back the bytes, the version and the commit it was built from', async () => {
    const info = await new FileRunnerBundle(dir).read();
    expect(info.contents).toBe(BANNER);
    expect(info.version).toBe('0.1.0');
    expect(info.sourceSha).toBe('e59ab5739c40');
  });

  it('measures the size rather than trusting the meta file’s number', async () => {
    // The fixture's meta says 1 byte. A `bytes` read out of a stale meta file
    // describes whatever the PREVIOUS build wrote, not the file just read.
    const info = await new FileRunnerBundle(dir).read();
    expect(info.bytes).toBe(Buffer.byteLength(BANNER, 'utf8'));
  });

  it('carries the AC-22 header through untouched', async () => {
    const info = await new FileRunnerBundle(dir).read();
    const [first, second] = info.contents.split('\n');
    expect(first).toContain('agent-runner v0.1.0');
    expect(first).toMatch(/built from [0-9a-f]+/);
    expect(second).toContain('generated — do not edit');
  });

  it('names the build command when the bundle has never been built', async () => {
    // `agent-runner/dist` is git-ignored, so this is what a fresh clone hits.
    await expect(new FileRunnerBundle(empty).read()).rejects.toBeInstanceOf(ConfigError);
    await expect(new FileRunnerBundle(empty).read()).rejects.toThrow(
      /cd agent-runner && npm run build/,
    );
  });

  it('names the build command when the meta file is not JSON', async () => {
    await expect(new FileRunnerBundle(broken).read()).rejects.toThrow(
      /runner.meta.json is not valid JSON/,
    );
  });

  it('re-reads on every call, so a rebuild is visible without a restart', async () => {
    const adapter = new FileRunnerBundle(dir);
    const first = await adapter.read();
    await writeFile(join(dir, 'runner.mjs'), `${BANNER}// rebuilt\n`, 'utf8');
    const second = await adapter.read();
    expect(second.contents).not.toBe(first.contents);
    await writeFile(join(dir, 'runner.mjs'), BANNER, 'utf8');
  });
});

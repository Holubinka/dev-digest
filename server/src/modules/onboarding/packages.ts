/**
 * onboarding · generation — everything about a repository's packages that can be
 * decided from strings alone.
 *
 * Pure by construction: no port, no clone, no `node:fs`, every input by
 * parameter. That is not decoration. Which package is first, which manager a
 * lock file dictates and which scripts exist are the three facts the "How to
 * run" section is copied from and pasted into a shell, and each of them is a
 * rule with a failure mode rather than a formatting choice — so each is testable
 * here without a repository being present.
 *
 * The reads themselves live in `gather-executor.ts`, behind `GitClient`.
 */

import type { OnboardingPackageManager } from '@devdigest/shared';
import { truncateCodePoints } from '../_shared/repo-paths.js';
import { LOCKFILES, MAX_LINE_CHARS, PACKAGE_MANIFEST } from './constants.js';

/** The directory a manifest defines a package for. `package.json` → `.`. */
export function packageDirOf(manifestPath: string): string {
  const cut = manifestPath.lastIndexOf('/');
  return cut === -1 ? '.' : manifestPath.slice(0, cut);
}

/** The manifest that defines the package rooted at `dir`. `.` → `package.json`. */
export function manifestPathFor(dir: string): string {
  return dir === '.' ? PACKAGE_MANIFEST : `${dir}/${PACKAGE_MANIFEST}`;
}

/** A file sitting beside the package rooted at `dir`. */
export function pathBeside(dir: string, name: string): string {
  return dir === '.' ? name : `${dir}/${name}`;
}

/**
 * Package directories in the order their blocks are shown: the root first when
 * there is one, then the rest by path, ascending. Duplicates collapse.
 *
 * Root-first is a requirement, not a preference (AC-94): a reader arriving at a
 * repository runs the root's install before anything else, and a list that
 * opened with `apps/admin` would be telling them to start in the middle.
 *
 * The comparison is by code unit, deliberately not `localeCompare`: the order
 * has to be the same for every reader of one repository (AC-92), and a
 * locale-aware collation makes it depend on where the server happens to run —
 * the same reason `GitClient.listFiles` compares paths that way.
 *
 * The port's order is NOT this one and does not need to be: it sorts shallowest
 * first, because what it orders decides which matches its ceiling drops. This
 * one decides which blocks a reader sees first, and for that the root is not
 * merely shallow, it is the one that has to be first.
 */
export function orderPackages(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  const root = unique.filter((p) => p === '.');
  const rest = unique.filter((p) => p !== '.').sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...root, ...rest];
}

/**
 * The blocks that are shown, and how many there were.
 *
 * It ORDERS BEFORE IT CUTS, and it does the ordering itself rather than trusting
 * a caller to have done it. That is the whole of AC-91/AC-94 in one line: a cut
 * applied to an unordered list is an alphabetical slice, and an alphabetical
 * slice of thirteen packages is the one that drops the root — the block that
 * must always be first.
 *
 * The port keeps that same shape away from the walk's own ceiling by ordering
 * its matches shallowest-first; counting matches rather than files does NOT do
 * it, which is worth writing down because it was believed here for a while. The
 * two orderings are independent and both are needed — this one is the only thing
 * standing between a reader and a list that opens with `apps/admin`.
 *
 * `found` counts the distinct packages the walk matched, so `found - shown` is
 * what a reader is told about instead of left to guess (AC-90).
 */
export function selectPackages(
  paths: string[],
  max: number,
): { shown: string[]; found: number } {
  const ordered = orderPackages(paths);
  return { shown: ordered.slice(0, max), found: ordered.length };
}

/**
 * The manager the lock files beside one manifest dictate, or `null` when they do
 * not dictate one.
 *
 * Three cases, and two of them are `null`:
 *
 *  - exactly one known lock file → its manager (AC-25);
 *  - none → `null`, and the block carries no install command at all (AC-87);
 *  - two or more naming DIFFERENT managers → `null` as well.
 *
 * The last case is the one worth spelling out. Picking either answer, or a
 * default, would be a guess printed beside a copy control: `AGENTS.md:32` says
 * "Do not mix" in one line, and `npm install` in a pnpm workspace rewrites
 * the lock file of a repository someone was only trying to read. A block that
 * says nothing is a smaller failure than a block that says the wrong thing.
 *
 * Unknown file names are ignored rather than counted — `deno.lock` beside a
 * `pnpm-lock.yaml` does not make the pnpm evidence ambiguous, because nothing
 * here claims to know every manager that exists.
 */
export function managerFor(lockfileNames: string[]): OnboardingPackageManager | null {
  const managers = new Set<OnboardingPackageManager>();
  for (const name of lockfileNames) {
    // `Object.hasOwn`, never a bare index — the rule `modules/blast/helpers.ts`
    // writes out. `LOCKFILES` is an object literal, so indexing it with
    // `constructor`, `toString` or `valueOf` answers with a function and
    // `__proto__` with an object: all truthy, all added, and all typed as a
    // manager by the assertion that made the index possible. Beside a real
    // lockfile that pushes the count to two, and a repository with one manager
    // is shown no install command at all.
    if (!Object.hasOwn(LOCKFILES, name)) continue;
    managers.add(LOCKFILES[name as keyof typeof LOCKFILES]);
  }
  if (managers.size !== 1) return null;
  const [only] = [...managers];
  return only ?? null;
}

/**
 * The two things a manifest is read for: what the package calls itself, and
 * which scripts exist in it.
 *
 * `JSON.parse` runs inside a `try` and every shape is checked afterwards,
 * because a public repository decides what is in its own `package.json`: a
 * manifest that is truncated, a `scripts` that is an array, a `name` that is a
 * number. None of those is an error worth failing a tour over — the package
 * simply gets a block with no commands, since a script can only be confirmed
 * against a list this returns.
 *
 * SCRIPT KEYS ONLY, never the command bodies. What a script runs is not needed
 * to decide whether `pnpm dev` is real, and the bodies are the half of the
 * manifest most likely to contain a token someone pasted into a `postinstall`.
 *
 * `name` is capped at `MAX_LINE_CHARS` here rather than at render: it is
 * repository text on its way to a heading, and the read that produced it is
 * bounded in bytes, which is not a bound on one string inside it.
 */
export function parseManifest(json: string): { name?: string; scripts: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { scripts: [] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { scripts: [] };
  }
  const manifest = parsed as Record<string, unknown>;
  const scripts = manifest.scripts;
  const names =
    typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
      ? Object.keys(scripts as Record<string, unknown>)
      : [];
  const rawName = manifest.name;
  if (typeof rawName !== 'string' || rawName.trim() === '') return { scripts: names };
  return { name: truncateCodePoints(rawName.trim(), MAX_LINE_CHARS), scripts: names };
}

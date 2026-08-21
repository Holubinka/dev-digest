/**
 * Constants belonging to the git adapter itself.
 *
 * `EXCLUDED_WALK_DIRS` duplicates `modules/repo-intel/constants.ts`'s
 * `EXCLUDED_DIRS` on purpose and must NOT be replaced by an import of it:
 * `no-adapter-to-module` forbids an adapter reaching into a feature slice, and
 * the two entries of exactly that shape already sitting in the architecture
 * baseline are why copying that import reads as safe. A seven-name list beside
 * its consumer is the cheapest way out of the escalation order.
 *
 * `.git` is in the list twice over: `listFiles` also refuses a root that
 * resolves into the git directory, because `.git/config` carries the clone URL
 * with the stored GitHub PAT embedded in it.
 *
 * It leaves the adapter as DATA, in `listFiles`'s `excludedDirs`. A caller that
 * has to tell a reader where a scan did not look reads it from the result rather
 * than keeping a fourth copy — `modules/onboarding` kept one until 2026-08-18.
 */
export const EXCLUDED_WALK_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

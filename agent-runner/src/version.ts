/**
 * The runner version compiled into the bundle.
 *
 * `scripts/build.mjs` replaces the identifier with a literal via esbuild
 * `--define`. Under vitest and tsx it is never declared, which is why the read
 * goes through `typeof` — a bare reference would throw a ReferenceError there.
 */
declare const __RUNNER_VERSION__: string;

export const RUNNER_VERSION: string =
  typeof __RUNNER_VERSION__ === 'string' ? __RUNNER_VERSION__ : 'dev';

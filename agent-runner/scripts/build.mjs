#!/usr/bin/env node
/**
 * Bundle the runner into ONE self-contained ESM file.
 *
 * The output is committed into someone else's repository as
 * `.devdigest/runner.mjs` and runs with `node .devdigest/runner.mjs` and no
 * `node_modules` (AC-48, AC-56), so everything it imports — reviewer-core, the
 * vendored contracts, openai, zod, yaml — is inlined here.
 *
 * `openai` and `zod` resolve out of `reviewer-core/node_modules`; install that
 * package first or the bundle fails to resolve them.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(ROOT, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'runner.mjs');
const META_FILE = path.join(OUT_DIR, 'runner.meta.json');

/** SPEC-05 § Non-functional requirements: `.devdigest/runner.mjs` ≤ 1.5 MiB. */
const MAX_BYTES = 1.5 * 1024 * 1024;

/** Mirrors `ARTIFACT_FILE` in `src/artifact.ts` — the one file the workflow uploads. */
const ARTIFACT = 'devdigest-result.json';

const pkg = JSON.parse(
  await import('node:fs/promises').then((fs) => fs.readFile(path.join(ROOT, 'package.json'), 'utf8')),
);

function sourceSha() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

const sha = sourceSha();

/**
 * The AC-22 comment MUST be the first two lines, so anything else the banner
 * needs goes after it.
 *
 * What follows is not optional. `openai` pulls in CJS dependencies whose
 * `require("stream")` esbuild cannot hoist into an import; for those it emits its
 * `__require` shim, and that shim throws `Dynamic require of "stream" is not
 * supported` the moment the file runs, because an ESM module has no `require`.
 * The bundle then dies on its FIRST line, before any DevDigest code executes —
 * and the unit suite cannot see it, because the suite runs the TypeScript source
 * and never the bundle. Restoring `require` from `import.meta.url` is what makes
 * the output actually satisfy AC-56. The smoke check at the end of this script is
 * the gate that keeps it that way.
 */
const banner =
  `// DevDigest agent-runner v${pkg.version} — built from ${sha}\n` +
  `// generated — do not edit\n` +
  `import { createRequire as __ddCreateRequire } from "node:module";\n` +
  `const require = __ddCreateRequire(import.meta.url);`;

mkdirSync(OUT_DIR, { recursive: true });

const started = Date.now();
await build({
  entryPoints: [path.join(ROOT, 'src/main.ts')],
  outfile: OUT_FILE,
  bundle: true,
  platform: 'node',
  format: 'esm',
  minify: true,
  target: 'node20',
  legalComments: 'none',
  banner: { js: banner },
  define: { __RUNNER_VERSION__: JSON.stringify(pkg.version) },
  // The same three aliases as tsconfig.json `paths` and vitest `resolve.alias`.
  alias: {
    '@devdigest/shared': path.join(REPO, 'server/src/vendor/shared'),
    '@devdigest/reviewer-core': path.join(REPO, 'reviewer-core/src/index.ts'),
    '@devdigest/diff-parser': path.join(REPO, 'server/src/adapters/git/diff-parser.ts'),
  },
});
const elapsed = Date.now() - started;

const bytes = statSync(OUT_FILE).size;
writeFileSync(
  META_FILE,
  `${JSON.stringify({ version: pkg.version, sourceSha: sha, bytes }, null, 2)}\n`,
  'utf8',
);

const kib = (bytes / 1024).toFixed(1);
const limit = (MAX_BYTES / 1024).toFixed(0);
console.log(`runner.mjs — ${bytes} bytes (${kib} KiB of ${limit} KiB) in ${elapsed} ms`);
console.log(`runner.meta.json — version ${pkg.version}, sourceSha ${sha}`);

if (bytes > MAX_BYTES) {
  console.error(
    `bundle is ${kib} KiB, over the ${limit} KiB ceiling in SPEC-05 § Non-functional requirements`,
  );
  process.exit(1);
}

/**
 * Does the bundle actually RUN? (AC-56)
 *
 * The unit suite executes `src/**` through vitest's own resolver and never loads
 * `dist/runner.mjs`, so an output that dies on its first line passes every test in
 * the package. That is not hypothetical: it is what the missing `createRequire`
 * banner did, and the failure only appeared when someone ran the file by hand.
 *
 * The fork path is the one branch that needs no secrets, no network and no
 * manifest, which makes it the cheapest possible proof that the module graph
 * loads and DevDigest code reaches the end. It runs in a throwaway directory with
 * no `node_modules`, which is the condition AC-56 actually states.
 */
const smokeDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-smoke-'));
const smoke = spawnSync(process.execPath, [OUT_FILE], {
  cwd: smokeDir,
  env: { PATH: process.env.PATH ?? '', DEVDIGEST_IS_FORK: 'true', DEVDIGEST_AGENT: 'smoke' },
  encoding: 'utf8',
});
const smokeArtifact = path.join(smokeDir, 'devdigest-result.json');

if (smoke.status !== 0 || !existsSync(smokeArtifact)) {
  console.error('smoke check failed — the bundle does not run with no node_modules:');
  console.error(`  exit ${smoke.status}`);
  if (smoke.stderr?.trim()) console.error(`  ${smoke.stderr.trim().split('\n')[0]}`);
  if (!existsSync(smokeArtifact)) console.error(`  no ${ARTIFACT} was written`);
  rmSync(smokeDir, { recursive: true, force: true });
  process.exit(1);
}

const smokeResult = JSON.parse(readFileSync(smokeArtifact, 'utf8'));
rmSync(smokeDir, { recursive: true, force: true });

if (smokeResult.status !== 'skipped' || smokeResult.version !== pkg.version) {
  console.error(
    `smoke check failed — expected a skipped artifact at v${pkg.version}, got ` +
      `status=${smokeResult.status} version=${smokeResult.version}`,
  );
  process.exit(1);
}

console.log(`smoke check — ran on node ${process.versions.node}, wrote a ${smokeResult.status} ${ARTIFACT}`);

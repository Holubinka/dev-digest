/**
 * The bundle's entry point — `node .devdigest/runner.mjs`.
 *
 * Kept apart from `index.ts` so importing the runner (a test does) never starts
 * a run. The unref'd timer is a floor, not a policy: `process.exitCode` lets
 * stdout drain, and the timer is there in case a keep-alive socket outlives the
 * work and would otherwise hold the job open to its 15-minute timeout.
 */
import { EXIT_FAILED } from './gate.js';
import { run } from './index.js';

const FORCED_EXIT_MS = 5000;

run()
  .catch((err: unknown) => {
    console.error(`DevDigest: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILED;
  })
  .then((code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(code), FORCED_EXIT_MS).unref();
  });

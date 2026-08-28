import { defineConfig } from 'vitest/config';
import path from 'node:path';

// These three aliases REPEAT tsconfig.json's `paths` on purpose: the two files
// duplicate each other, and adding a path to one and not the other leaves
// typecheck green while the tests stop resolving (CLAUDE.md, Non-default
// conventions).
export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src/index.ts'),
      '@devdigest/diff-parser': path.resolve(
        __dirname,
        '../server/src/adapters/git/diff-parser.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

import { defineConfig } from 'vitest/config';

// No `resolve.alias` block on purpose: unlike server/ and reviewer-core/, this
// package declares no tsconfig `paths`, so there is nothing for the vitest
// config to duplicate (root AGENTS.md §Non-default conventions). Adding a path
// alias later means adding it here in the same commit.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // `spike/` is a throwaway package of its own (spec 06 step 1) and is not
    // part of this suite.
    exclude: ['node_modules/**', 'dist/**', 'spike/**'],
  },
});

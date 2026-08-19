/**
 * The order `GitClient.listFiles` returns matches in, shared by the real adapter
 * and by `MockGitClient` so the two cannot drift.
 *
 * It lives beside the adapter rather than in a module because it is part of what
 * the port promises, and both implementations of that promise are adapters.
 */

/** How far below the clone root a posix repo-relative path sits. `a/b.ts` → 1. */
function depthOf(path: string): number {
  let depth = 0;
  for (const ch of path) if (ch === '/') depth += 1;
  return depth;
}

/**
 * Shallowest first, then by path — and the depth half is load-bearing.
 *
 * `maxFiles` slices this order, so whatever sorts last is what a bounded walk
 * drops. Sorted by path alone that is "everything after the letter the ceiling
 * fell on": a repo with 65 `apps/aNNN/package.json` and a ceiling of 64 returns
 * not one root `package.json`, because `apps/` precedes `package.json`. Sorted
 * by depth first, the root of the clone always survives and the ceiling is spent
 * on the deepest entries instead.
 *
 * The path comparison is by code unit, deliberately not `localeCompare`: the
 * order has to be the same for every reader of one repository, and a
 * locale-aware collation makes it depend on where the server happens to run.
 */
export function byDepthThenPath(a: { path: string }, b: { path: string }): number {
  const byDepth = depthOf(a.path) - depthOf(b.path);
  if (byDepth !== 0) return byDepth;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

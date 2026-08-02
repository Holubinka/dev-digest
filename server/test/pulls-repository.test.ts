/**
 * F1 — `modules/pulls/repository.ts`, the part that needs no Postgres.
 *
 * The join itself is only meaningful against a real database (see
 * `../TESTING.md`: repository queries belong in a `*.it.test.ts`). What IS
 * hermetic is the empty-page short-circuit, and it is worth pinning: the PR
 * list calls this per page, an `inArray` over an empty array is a Drizzle
 * sharp edge, and the route's own `prIds.length > 0` guard is not a promise
 * the repository can rely on forever.
 */
import { describe, it, expect } from 'vitest';
import { PullsRepository } from '../src/modules/pulls/repository.js';
import type { Db } from '../src/db/client.js';

/** A `Db` that fails the test the moment anything reaches for it. */
const unusableDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`PullsRepository queried the database (db.${String(prop)})`);
    },
  },
) as Db;

describe('PullsRepository.findingsForPrs', () => {
  it('returns no findings for an empty page of PRs, without querying', async () => {
    const repo = new PullsRepository(unusableDb);
    await expect(repo.findingsForPrs([])).resolves.toEqual([]);
  });
});

describe('PullsRepository.reviewsForPrs', () => {
  it('returns no reviews for an empty page of PRs, without querying', async () => {
    const repo = new PullsRepository(unusableDb);
    await expect(repo.reviewsForPrs([])).resolves.toEqual([]);
  });
});

/**
 * The one budget walk two slices share.
 *
 * It lived in `modules/context/helpers.ts` until 2026-08-16, when `modules/brief`
 * needed the same walk for its elastic spec inputs. `no-cross-module` forbids one
 * slice importing another — `import type` included — and the rule's own message
 * names `_shared/` as the remedy, which is the move `truncateCodePoints` already
 * made. Copying it instead would have given the repository two budget walks with
 * one comment explaining the cut point, and they would have drifted.
 *
 * The code below is `modules/context/helpers.ts:278-377` moved, not rewritten:
 * `test/context-helpers.test.ts` passes unchanged, which is the proof.
 *
 * Nothing here touches a tokenizer, a filesystem or a database. `count` is a
 * PARAMETER, which is what keeps both callers unit-testable with `s => s.length`.
 */

/** What the walk itself can decide about a candidate. Its callers may add their own failures. */
export type BudgetStatus = 'included' | 'truncated' | 'dropped';

/**
 * A read that succeeded, or the reason it did not. Order is the caller's set order.
 *
 * `F` is the caller's own failure vocabulary — `'missing' | 'refused' | 'binary'`
 * for a project-context document, `never` for a caller whose candidates are all
 * already in memory. It is a type parameter rather than a widened union so a
 * caller's result stays assignable to its own contract enum: `ContextDocStatus`
 * has six members and `RiskBriefInputStatus` has four, and a shared six-member
 * status would have made the second one a cast.
 */
export type BudgetCandidate<F extends string = never> =
  | { path: string; rendered: string }
  | { path: string; failure: F };

export interface BudgetResult<F extends string = never> {
  path: string;
  tokens: number;
  status: BudgetStatus | F;
}

export interface BudgetSelection<F extends string = never> {
  /** The rendered documents that actually go into the prompt, in order. */
  blocks: string[];
  /** Every candidate, in the same order, with what happened to it. */
  results: BudgetResult<F>[];
}

/**
 * Take documents in set order until the budget is exhausted.
 *
 * **The walk STOPS at the first document that does not fit**, and that document
 * and every readable one after it are recorded `dropped`. A later, smaller
 * document does NOT get to jump the queue: one explainable cut point beats a
 * knapsack whose result nobody can predict from the list they are looking at.
 *
 * If the FIRST document alone exceeds the budget it is included truncated rather
 * than dropped, so an agent whose single attachment is large still gets some of
 * it. A candidate that could not be read at all is reported with its read
 * failure wherever it sits: it never entered the budget walk, so calling it
 * `dropped` would hide the fact that the file is gone.
 *
 * `count` is a PARAMETER, which is what keeps this file free of the tokenizer
 * and testable with `s => s.length`.
 */
export function selectWithinBudget<F extends string = never>(
  candidates: BudgetCandidate<F>[],
  budget: number,
  count: (text: string) => number,
): BudgetSelection<F> {
  const blocks: string[] = [];
  const results: BudgetResult<F>[] = [];
  let remaining = budget;
  let stopped = false;

  for (const candidate of candidates) {
    if ('failure' in candidate) {
      results.push({ path: candidate.path, tokens: 0, status: candidate.failure });
      continue;
    }
    const tokens = count(candidate.rendered);
    if (stopped) {
      results.push({ path: candidate.path, tokens, status: 'dropped' });
      continue;
    }
    if (tokens <= remaining) {
      blocks.push(candidate.rendered);
      results.push({ path: candidate.path, tokens, status: 'included' });
      remaining -= tokens;
      continue;
    }
    if (blocks.length === 0) {
      const cut = truncateToBudget(candidate.rendered, remaining, count);
      blocks.push(cut);
      results.push({ path: candidate.path, tokens: count(cut), status: 'truncated' });
      remaining = 0;
      stopped = true;
      continue;
    }
    results.push({ path: candidate.path, tokens, status: 'dropped' });
    stopped = true;
  }

  return { blocks, results };
}

/**
 * The longest prefix of `text`, by CODE POINT, that `count` puts within `budget`.
 *
 * Binary search rather than a proportional guess, and at most 12 probes — the
 * same shape as the repo-map budget search, and for the same reason: a real
 * tokenizer's chars-per-token ratio varies enough across a document that a
 * single estimate overshoots. `lo` is only ever moved to a value already proven
 * to fit, so the answer is never over budget even when the probe budget runs out.
 *
 * At least one code point comes back: a zero-length block reported as
 * `truncated` is a document that contributed nothing, which is `dropped` wearing
 * the wrong name.
 */
export function truncateToBudget(
  text: string,
  budget: number,
  count: (text: string) => number,
): string {
  const points = [...text];
  if (count(text) <= budget) return text;

  let lo = 0;
  let hi = points.length;
  for (let probe = 0; probe < 12 && hi - lo > 1; probe += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (count(points.slice(0, mid).join('')) <= budget) lo = mid;
    else hi = mid;
  }
  return points.slice(0, Math.max(lo, 1)).join('');
}

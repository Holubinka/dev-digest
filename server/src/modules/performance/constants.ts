import { PERF_COUNTED_RUN_STATUSES } from '@devdigest/shared';

/** The run statuses a performance read counts. Re-exported so callers here read one name. */
export const COUNTED_RUN_STATUSES = PERF_COUNTED_RUN_STATUSES;

/**
 * Decisions an agent needs before its accept rate is allowed to RANK it.
 *
 * Ten, not one, because the table sorts by this number and a single accepted
 * finding otherwise puts an agent at 100% above one that earned 78% over 200
 * decisions. Below the threshold the rate is still shown — it is real — but it is
 * marked and demoted (AC-29). Served to the client in every response so the badge
 * and the ordering cannot disagree about the threshold (AC-30).
 */
export const MIN_DECISIONS_FOR_RANK = 10;

/**
 * Cost is summed in integer MICRO-dollars and divided back on the way out.
 *
 * Float addition is not associative, so `sum(by agent)` and `sum(by model)` over
 * the same runs can differ in the last bits — and AC-32/AC-33 require both donuts
 * to equal the total exactly. Integers make that equality arithmetic rather than
 * luck. A millionth of a dollar is well below any run this system records.
 */
export const USD_MICROS = 1_000_000;

/** Trend buckets: at most this many points, whatever the span. */
export const MAX_TREND_BUCKETS = 72;

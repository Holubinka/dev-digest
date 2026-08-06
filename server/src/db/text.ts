/**
 * Making a string safe for a Postgres `text` column.
 *
 * A leaf on purpose: it imports nothing, so any repository can reach it. It
 * lived briefly in `modules/reviews/helpers.ts` and closed a cycle —
 * `helpers -> repository -> review.repo -> helpers` — which `no-circular`
 * caught. The constraint is the database's, not the reviews module's.
 */

/**
 * U+0000. Built rather than written literally: a raw NUL in a source file is
 * invisible in a diff, in a review, and in most editors — which is close to how
 * this reached production in the first place.
 */
const NUL = String.fromCharCode(0);

/**
 * Remove U+0000 from a string on its way into Postgres.
 *
 * A `text` column cannot hold a NUL — the server answers `invalid byte
 * sequence for encoding "UTF8": 0x00` and the whole statement fails. Model
 * output can contain one, and did: run `ce536de2` on PR #11 reviewed 109
 * files, produced two findings and passed citation grounding, then lost all of
 * it at `insertReview` because the summary carried a NUL. About 167k input
 * tokens were paid for and nothing was stored.
 *
 * ONLY the NUL. Measured against this repo's own Postgres 16 through the
 * `postgres` driver it actually uses: a lone surrogate, U+0001, a tab, a
 * newline and an astral emoji all insert and read back unchanged. Widening
 * this to "strip the control characters" would silently rewrite legitimate
 * model output — a rationale quoting a diff has tabs in it — to prevent
 * nothing.
 */
export const stripNul = (text: string): string =>
  text.includes(NUL) ? text.replaceAll(NUL, '') : text;

/**
 * The same strip, over every string reachable in a JSON document.
 *
 * `jsonb` refuses U+0000 exactly as `text` does — `select '{"a":"x\\u0000y"}'::jsonb`
 * answers `unsupported Unicode escape sequence` — so a run trace carries the
 * defect one station past `insertReview`. It gets there without any obvious
 * model field: `trace.log` is the run's event buffer verbatim, and the engine
 * writes `grounding dropped "<title>": file '<file>' not present in diff` into
 * it. A `file` holding a NUL is ALWAYS dropped, because a git path cannot
 * contain one — so that log line always carries it.
 *
 * Left alone deliberately: numbers, booleans and null. Only strings can hold
 * the byte, and rebuilding the rest would change types on their way to `jsonb`.
 */
export function stripNulDeep<T>(value: T): T {
  if (typeof value === 'string') return stripNul(value) as T;
  if (Array.isArray(value)) return value.map(stripNulDeep) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripNulDeep(v)]),
    ) as T;
  }
  return value;
}

/** Postgres `integer` is 32-bit signed. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/**
 * Clamp a number into a Postgres `integer` column.
 *
 * `Finding.start_line` and `end_line` are `z.number().int()` with no bounds,
 * and `groundFindings` does not close the gap: for `kind` of `secret_leak`,
 * `lethal_trifecta`, `phantom` or `hook` it keeps a finding on file presence
 * alone and never reaches the line check — and `kind` is a field the model
 * fills in. So `{"kind":"hook","start_line":9999999999}` on a file that really
 * is in the diff reaches the insert, and Postgres answers `integer out of
 * range`, losing the whole review the way the NUL did.
 *
 * This makes the row STORABLE, not correct. A clamped line number is still a
 * wrong citation; judging that is grounding's job, and the `kind` skip above is
 * where it would be fixed.
 */
export const toInt4 = (n: number): number =>
  Number.isFinite(n) ? Math.min(INT4_MAX, Math.max(INT4_MIN, Math.trunc(n))) : 0;

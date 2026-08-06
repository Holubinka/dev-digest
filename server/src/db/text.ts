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

/* Pure rules this section goes through before anything is rendered. Kept out of
   the component because they are calculation, not rendering.

   `lineFor` moved to `../BriefRef/helpers.ts` with the component that was its
   only caller. */

/**
 * The abbreviated form git itself prints, exactly as `BlastRadiusCard` does it.
 * `String.slice` is safe here and only here: a commit id is `[0-9a-f]{40}`, so
 * there is no surrogate pair to split.
 */
export const shortSha = (sha: string) => sha.slice(0, 7);

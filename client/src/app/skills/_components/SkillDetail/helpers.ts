/**
 * MIRRORS `skillBlock` in `server/src/modules/reviews/helpers.ts`.
 *
 * Duplicated rather than shared: `@devdigest/shared` carries contracts, not
 * behaviour. The Preview tab exists to show the block verbatim, so the two must
 * not drift — `helpers.test.ts` here pins the same cases the server test pins.
 */
export function promptBlock(name: string, body: string): string {
  return /^\s*#{1,6}\s/.test(body) ? body : `### ${name}\n${body}`;
}

/** The filename shown above the body editor, derived from the skill's name. */
export function bodyFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "skill" : slug}.md`;
}

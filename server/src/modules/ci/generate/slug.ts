/**
 * File-name slugs for the bundle (AC-17, AC-18, AC-105).
 *
 * Pure: a name in, a path segment out. The rule is deterministic so that
 * republishing an unchanged agent rewrites the same paths and the PR shows no
 * diff for files nobody touched.
 */

/** Letters and digits in ANY script — a Cyrillic name keeps its letters. */
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * Lowercase; every run of non-alphanumerics becomes one hyphen; hyphens are
 * trimmed at both ends. An empty result falls back to the row's id (AC-105).
 *
 * Iterated by CODE POINT, not by UTF-16 unit. `server/INSIGHTS.md` — "Truncating
 * text for an API response with `String.slice` corrupts emoji" — is the same
 * trap one level down: an emoji is a surrogate PAIR, and testing its halves
 * separately classifies each as its own non-alphanumeric character.
 */
/**
 * An agent's slug — the one pairing of the two fields that feed it.
 *
 * Four call sites derived it by hand (`helpers.ts`, `service.ts`,
 * `ingest-executor.ts`, `bundle.ts`), which is the drift `workflowFileFor` in
 * `constants.ts` argues against for the prefix it applies.
 */
export function agentSlug(agent: { id: string; name: string }): string {
  return slugify(agent.name, agent.id);
}

export function slugify(name: string, fallbackId: string): string {
  const mapped = [...name.toLowerCase()]
    .map((ch) => (ALPHANUMERIC.test(ch) ? ch : '-'))
    .join('')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return mapped === '' ? fallbackId : mapped;
}

/**
 * Make a list of slugs unique inside one bundle: the first keeps the base, the
 * next take `-2`, `-3`… and the final value is what the file list shows (AC-18).
 *
 * The suffix loop re-checks the taken set instead of trusting the counter — with
 * names "Rules" and "Rules 2", the second `rules` would otherwise be handed
 * `rules-2`, which "Rules 2" already occupies.
 */
export function disambiguate(slugs: string[]): string[] {
  const taken = new Set<string>();
  return slugs.map((base) => {
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    const unique = `${base}-${n}`;
    taken.add(unique);
    return unique;
  });
}

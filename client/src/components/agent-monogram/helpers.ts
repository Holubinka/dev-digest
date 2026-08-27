/**
 * The single character an agent's tile shows.
 *
 * `Array.from` and not `name[0]`: indexing a string yields one UTF-16 code unit,
 * so an agent named "🛡 Security" would render half a surrogate pair — the
 * replacement glyph, in every workspace that names an agent with an emoji.
 *
 * Nothing is transliterated. A Cyrillic or CJK name keeps its own first
 * character ("Б", "安"); mapping it onto a Latin letter would be this file
 * inventing a name the workspace did not give.
 *
 * `toUpperCase` rather than `toLocaleUpperCase`: the latter reads the HOST
 * locale, so the same agent would show `İ` on a Turkish machine and `I`
 * everywhere else — a difference nothing on screen explains.
 *
 * A name that is empty or only whitespace yields an empty string, and the tile
 * renders as a bare coloured square. That is deliberate: `?` or `•` would claim
 * something about an agent whose name is simply missing, and the name is a
 * required field, so the case is a data defect rather than a state to design for.
 */
export function monogram(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "";
}

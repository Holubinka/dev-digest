/** The filename shown above the body editor, derived from the skill's name. */
export function bodyFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "skill" : slug}.md`;
}

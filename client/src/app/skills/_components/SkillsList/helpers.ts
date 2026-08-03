import type { SkillListItem } from "@devdigest/shared";

/** Filter by name, description or type — whatever the user can see on a card. */
export function filterSkills(skills: SkillListItem[], query: string): SkillListItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return skills;
  return skills.filter((sk) =>
    [sk.name, sk.description, sk.type].some((field) => field.toLowerCase().includes(q)),
  );
}

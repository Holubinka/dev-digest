/* Only what a consumer outside this folder imports. `TYPE_COLORS` stays
   internal: three call sites used to read the palette and rebuild the same
   badge, which is the duplication this folder exists to remove. */
export { SkillTypeBadge } from "./SkillTypeBadge";
export { TYPE_VALUES } from "./values";

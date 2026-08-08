import type { SkillListItem } from "@devdigest/shared";

/**
 * Shared scaffolding for the skills screens. Five test files were building the
 * same eleven-field row by hand, so a field added to the contract meant five
 * edits and a typecheck failure in each.
 */

export function skill(over: Partial<SkillListItem> = {}): SkillListItem {
  return {
    id: "sk1",
    name: "uncovered-branch-rubric",
    description: "List every branch the diff adds and name the test covering it.",
    type: "rubric",
    source: "manual",
    enabled: true,
    version: 3,
    evidence_files: null,
    agents: 2,
    injection: [],
    ...over,
  };
}

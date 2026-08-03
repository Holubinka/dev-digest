import type { Skill } from "@devdigest/shared";

/** The four skill types, in the order the picker offers them. */
export const TYPE_VALUES: ReadonlyArray<Skill["type"]> = [
  "rubric",
  "convention",
  "security",
  "custom",
];

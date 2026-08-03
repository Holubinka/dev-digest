import type { Skill } from "@devdigest/shared";

/** The four skill types, in the order the picker offers them. Shared by the
    three forms that let one be chosen: create, import and the Config tab. */
export const TYPE_VALUES: ReadonlyArray<Skill["type"]> = [
  "rubric",
  "convention",
  "security",
  "custom",
];

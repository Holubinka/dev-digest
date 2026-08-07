import type { Skill } from "@devdigest/shared";

/** The four skill types, in the order the picker offers them. Shared by the
    four forms that let one be chosen: create, import, the Config tab, and the
    merge modal on the Conventions screen — which is why it lives here rather
    than inside the /skills route folder. */
export const TYPE_VALUES: ReadonlyArray<Skill["type"]> = [
  "rubric",
  "convention",
  "security",
  "custom",
];

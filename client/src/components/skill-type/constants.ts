import type { Skill } from "@devdigest/shared";

/** Badge colour per skill type — the same palette findings use for severity. */
export const TYPE_COLORS: Record<Skill["type"], string> = {
  rubric: "var(--info)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-muted)",
};

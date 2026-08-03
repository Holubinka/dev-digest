import type { IconName } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

/** Badge colour per skill type — the same palette findings use for severity. */
export const TYPE_COLORS: Record<Skill["type"], string> = {
  rubric: "var(--info)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-muted)",
};

/** Where the body came from, at a glance. */
export const SOURCE_ICONS: Record<Skill["source"], IconName> = {
  manual: "Edit",
  imported_file: "FileText",
  imported_url: "Link",
  extracted: "Sparkles",
  community: "Globe",
};

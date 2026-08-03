import type { IconName } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

/** Where the body came from, at a glance. */
export const SOURCE_ICONS: Record<Skill["source"], IconName> = {
  manual: "Edit",
  imported_file: "FileText",
  imported_url: "Link",
  extracted: "Sparkles",
  community: "Globe",
};

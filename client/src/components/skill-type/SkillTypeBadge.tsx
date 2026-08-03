/* SkillTypeBadge — a skill's type, coloured and translated. Shared rather than
   colocated because /skills and /agents/:id both render it, and the agent
   editor was reaching six levels across into the skills route to get the
   palette. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { TYPE_COLORS } from "./constants";

export function SkillTypeBadge({ type }: { type: Skill["type"] }) {
  const t = useTranslations("skills");
  return <Badge color={TYPE_COLORS[type]}>{t(`listItem.type.${type}`)}</Badge>;
}

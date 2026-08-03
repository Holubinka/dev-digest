"use client";

import { useParams } from "next/navigation";
import { SkillsView } from "../_components/SkillsView";

/* Route: /skills/:id — the same shell as /skills, with the detail pane filled. */
export default function SkillDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <SkillsView selectedId={id} />;
}

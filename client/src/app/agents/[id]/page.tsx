"use client";

import { useParams } from "next/navigation";
import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id — thin route entry. The list-plus-editor shell, its
   styles and its i18n are colocated under _components/AgentEditorView. */
export default function AgentEditorPage() {
  const { id } = useParams<{ id: string }>();
  return <AgentEditorView id={id} />;
}

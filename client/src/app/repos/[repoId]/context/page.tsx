/* Route: /repos/:repoId/context. Thin route entry — the view, its panes,
   styles and i18n are colocated under _components. */
"use client";

import { useParams } from "next/navigation";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const params = useParams<{ repoId: string }>();
  return <ProjectContextView repoId={params.repoId} />;
}

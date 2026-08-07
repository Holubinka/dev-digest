/* Route: /repos/:repoId/conventions. Thin route entry — the view, its cards,
   the create-skill modal, styles and i18n are colocated under _components. */
"use client";

import { useParams } from "next/navigation";
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  return <ConventionsView repoId={params.repoId} />;
}

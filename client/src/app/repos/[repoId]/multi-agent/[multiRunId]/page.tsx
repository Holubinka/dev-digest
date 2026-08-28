/* Route: /repos/:repoId/multi-agent/:multiRunId — one comparison, at the
   permanent link it stays reachable by (AC-26, AC-92). Thin by convention; the
   view owns the data and the four URL parameters. */
"use client";

import { useParams } from "next/navigation";
import { MultiRunView } from "./_components/MultiRunView";

export default function MultiRunPage() {
  const params = useParams<{ repoId: string; multiRunId: string }>();
  return <MultiRunView repoId={params.repoId} multiRunId={params.multiRunId} />;
}

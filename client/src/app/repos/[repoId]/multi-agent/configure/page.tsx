/* Route: /repos/:repoId/multi-agent/configure — step 1 a PR, step 2 the agents,
   then one multi-run (AC-92). Thin by convention; the screen is the colocated
   view, which reads `?pr` through `useSearchParams` under the `<Suspense>`
   `app/layout.tsx:29` already provides. */
"use client";

import { useParams } from "next/navigation";
import { ConfigureRunView } from "./_components/ConfigureRunView";

export default function ConfigureRunPage() {
  const params = useParams<{ repoId: string }>();
  return <ConfigureRunView repoId={params.repoId} />;
}

/* Route: /repos/:repoId/multi-agent — the feature's landing page and the target
   of the sidebar row (`vendor/ui/nav.ts`, AC-90). It is the PARENT of Configure
   run and of a multi-run's own page, which is what AC-92 and AC-94 together
   imply: a repo-scoped path that is empty when the repo has no multi-runs, and
   a repo-scoped Configure run under it. The mockups' breadcrumbs say the same —
   `Multi-Agent Review › Configure run` and `Multi-Agent Review › #482`.

   Thin by convention (`client/AGENTS.md`): everything lives in the colocated
   view. No `<Suspense>` here — `app/layout.tsx:29` already wraps every page,
   which is what lets these three pages read `useSearchParams`. */
"use client";

import { useParams } from "next/navigation";
import { MultiAgentLandingView } from "./_components/MultiAgentLandingView";

export default function MultiAgentLandingPage() {
  const params = useParams<{ repoId: string }>();
  return <MultiAgentLandingView repoId={params.repoId} />;
}

/* Route: /repos/:repoId/onboarding. Thin route entry — the view, the five
   sections, the rail, every state, the styles and the i18n are colocated under
   `_components`. `/onboarding` (no repo) is a different screen and keeps its
   own page: `app/onboarding/page.tsx` still renders AddRepoView, unchanged. */
"use client";

import { useParams } from "next/navigation";
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default function OnboardingTourPage() {
  const params = useParams<{ repoId: string }>();
  return <OnboardingTourView repoId={params.repoId} />;
}

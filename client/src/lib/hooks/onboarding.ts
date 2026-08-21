/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour screen.
     GET  /repos/:id/onboarding          → OnboardingPage. A pure read: no model
                                           call, however many times it is read.
                                           `tour: null` is "nothing generated
                                           yet", which is DATA and not an error.
     POST /repos/:id/onboarding/generate → OnboardingRecord. One generation, one
                                           paid model call, rate-limited.

   Deliberately NOT re-exported from `lib/hooks/index.ts`: that barrel is
   `export *` over five domain modules, so reaching one hook through it drags
   the other four into the module graph (`client/INSIGHTS.md:805-819`). Import
   this file directly, the way `lib/hooks/brief.ts` and `lib/hooks/blast.ts`
   are imported. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingPage, OnboardingRecord } from "../types";

/**
 * One definition of the cache key, so the mutation writes where the query reads.
 *
 * The tour is per repository and nothing narrower: unlike the Risk Brief, it is
 * not keyed by the index sha. A tour built from an older index is still the
 * tour that exists, and the envelope's `stale` flag is how the page says so —
 * putting the sha in the key would instead make a stale tour unreadable, which
 * is the opposite of what AC-60 asks for.
 */
export const onboardingQueryKey = (repoId: string | null | undefined) => [
  "onboarding",
  repoId,
];

/**
 * The page ENVELOPE, not the tour: `{ tour, index, stale, generate_blocked }`.
 *
 * `generate_blocked` arriving on the READ is what lets the screen say why
 * generating is refused before anyone presses anything, rather than only after
 * a 409 (AC-83). And the current `index` arriving here is why
 * `useRepoIntelStatus` must not be added beside this hook — a second source for
 * the index state is a second answer.
 */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: onboardingQueryKey(repoId),
    queryFn: () => api.get<OnboardingPage>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/**
 * One paid model call, so no retries and no optimistic anything: the response
 * IS the new tour and is merged straight into the envelope the query holds.
 *
 * `setQueryData` and NOT `invalidateQueries` — an invalidation would spend a
 * round trip re-reading the row that was just returned, and would empty the
 * page for its duration.
 *
 * `stale: false` is set alongside the record because the write's own gate
 * approved the index state stamped on it; leaving the previous envelope's
 * `true` in place would keep a staleness note on screen beside a tour that has
 * just been rebuilt from the state the note complains about.
 *
 * No `onError`: `lib/providers.tsx` already toasts every failed mutation with
 * the server's own message, and a local handler is a second copy of one
 * sentence. No `AbortSignal` and no client-side timeout either — the generation
 * legitimately holds the connection for up to 300 000 ms, and a client that
 * gives up first pays for a model call it then throws away. The decision is
 * unchanged and the number is not: the server's clock is now a function of the
 * budget, which is a function of `files_indexed`, so a big repository spends
 * longer in one call — and the cost of giving up on it has gone up with it.
 */
export function useGenerateOnboardingTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingRecord>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (record) =>
      qc.setQueryData(onboardingQueryKey(repoId), (prev: OnboardingPage | undefined) =>
        prev ? { ...prev, tour: record, stale: false } : prev,
      ),
  });
}

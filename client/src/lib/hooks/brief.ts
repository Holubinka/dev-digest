/* hooks/brief.ts — React Query hooks for the per-PR Risk Brief.
     GET  /pulls/:id/brief  → RiskBriefRecord | null. A pure read: it costs
                              nothing and makes no model call. `null` means
                              "no record for this PR's CURRENT head_sha".
     POST /pulls/:id/brief  → RiskBriefRecord. Computes for that same head and
                              replaces the record of that state. Rate-limited.

   Deliberately NOT re-exported from `lib/hooks/index.ts`: that barrel is
   `export *` over five domain modules, so importing one hook through it drags
   the other four into the module graph (`client/INSIGHTS.md:317`). Import this
   file directly, the way `lib/hooks/blast.ts` is imported. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { RiskBriefRecord } from "../types";

/**
 * One definition of the cache key, so the mutation writes where the query reads.
 *
 * `headSha` is IN THE KEY, and that is what makes AC-7 true structurally rather
 * than by convention: a new head is a different key, so the previous state's
 * brief cannot be served as the current one while the new one computes. Nothing
 * in the card has to remember to clear it.
 *
 * The server resolves `head_sha` itself from `pull_requests` and the client
 * never sends one — the sha here identifies the cache entry, not the request.
 */
export const briefQueryKey = (
  prId: string | null | undefined,
  headSha: string | null | undefined,
) => ["brief", prId, headSha] as const;

/** GET /pulls/:id/brief → the stored brief for the current head, or `null`. */
export function usePrBrief(
  prId: string | null | undefined,
  headSha: string | null | undefined,
) {
  return useQuery({
    queryKey: briefQueryKey(prId, headSha),
    queryFn: () => api.get<RiskBriefRecord | null>(`/pulls/${prId}/brief`),
    enabled: !!prId && !!headSha,
  });
}

/**
 * POST /pulls/:id/brief → compute (or recompute) this state's brief.
 *
 * The result is written into the query's key with `setQueryData` and the query
 * is NOT invalidated — the `lib/hooks/blast.ts:41-44` precedent. An invalidation
 * would spend a round trip to re-read the row the mutation just returned, and
 * would leave the card empty for the duration of it.
 */
export function useComputeBrief(
  prId: string | null | undefined,
  headSha: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RiskBriefRecord>(`/pulls/${prId}/brief`),
    onSuccess: (record) => {
      qc.setQueryData<RiskBriefRecord | null>(briefQueryKey(prId, headSha), record);
    },
  });
}

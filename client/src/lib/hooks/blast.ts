/* hooks/blast.ts — React Query hooks for the per-PR blast radius.
     GET  /pulls/:id/blast          → BlastRadiusView. A pure read: it costs
                                      nothing and makes no model call.
     POST /pulls/:id/blast/summary  → one paragraph, grounded in that view.

   Deliberately NOT re-exported from `lib/hooks/index.ts`: that barrel is
   `export *` over five domain modules, so importing one hook through it drags
   the other four into the module graph (`client/INSIGHTS.md:317`). Import this
   file directly. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusView, BlastSummaryResponse } from "../types";

/** One definition of the cache key, so the mutation writes where the query reads. */
export const blastQueryKey = (prId: string | null | undefined) => ["blast", prId] as const;

/** GET /pulls/:id/blast → the read-only view the card renders. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: blastQueryKey(prId),
    queryFn: () => api.get<BlastRadiusView>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/**
 * POST /pulls/:id/blast/summary → the optional LLM explanation.
 *
 * Nothing about the summary is persisted server-side, so the query cache is the
 * only place it lives: the result is written into the view already on screen
 * rather than invalidating it, because a refetch would return `summary: null`
 * and erase the paragraph the user just paid for.
 */
export function useExplainBlast(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BlastSummaryResponse>(`/pulls/${prId}/blast/summary`),
    onSuccess: ({ summary }) => {
      qc.setQueryData<BlastRadiusView>(blastQueryKey(prId), (prev) =>
        prev ? { ...prev, summary } : prev,
      );
    },
  });
}

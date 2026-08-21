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

import { useCallback } from "react";
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
 *
 * The `mutationKey` is the query's own key, and it is not decoration: it is what
 * puts "a compute for THIS state has been fired" in the mutation cache, where
 * `useBriefComputeAttempted` can read it back. Nothing else uses it to dedupe —
 * `useMutation` never restores state from the cache — so the two hooks are one
 * mechanism and the key must stay shared.
 */
export function useComputeBrief(
  prId: string | null | undefined,
  headSha: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: briefQueryKey(prId, headSha),
    mutationFn: () => api.post<RiskBriefRecord>(`/pulls/${prId}/brief`),
    onSuccess: (record) => {
      qc.setQueryData<RiskBriefRecord | null>(briefQueryKey(prId, headSha), record);
    },
  });
}

/**
 * Whether a compute for this exact `(prId, headSha)` has already been fired.
 *
 * The fact is about the PR STATE, so it is kept where state-scoped facts live —
 * the cache — and not in a `useRef`, whose lifetime is one mount. The tab that
 * asks is rendered as `{tab === "overview" && <OverviewTab …/>}`, so every
 * switch to Files changed and back unmounts it: a ref reset to `null` there, the
 * query cache still held `null` for the state, and a FAILED compute therefore
 * paid for itself again on every tab switch — with the error message gone,
 * because the remounted mutation starts at `error: null`.
 *
 * A CALLBACK, not a boolean, because the answer is read inside the effect that
 * acts on it. `mutate()` registers the mutation synchronously, so a value
 * captured at render is a commit stale — and React StrictMode runs an effect's
 * setup twice in one commit, which is the double-fire the old ref was there to
 * catch. Read at call time, one guard covers both.
 *
 * Its window is the mutation's `gcTime`: five minutes after the last observer
 * unmounts, the same span the query cache holds its `null` for. Inside it a tab
 * switch is free; outside it, the tab is a fresh visit to a state with no brief
 * and computing one is exactly AC-2.
 */
export function useBriefComputeAttempted(
  prId: string | null | undefined,
  headSha: string | null | undefined,
): () => boolean {
  const qc = useQueryClient();
  return useCallback(
    () =>
      qc.getMutationCache().find({ mutationKey: briefQueryKey(prId, headSha), exact: true }) !==
      undefined,
    [qc, prId, headSha],
  );
}

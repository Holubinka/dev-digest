/* hooks/conventions.ts — React Query hooks for the Conventions screen. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionsResponse } from "@devdigest/shared";
import { api } from "../api";

const key = (repoId: string | null | undefined) => ["conventions", repoId];

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: key(repoId),
    queryFn: () => api.get<ConventionsResponse>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * One paid model call, so no retries and no optimistic anything: the response
 * IS the new list and is written straight into the cache.
 */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionsResponse>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(key(repoId), data),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: Partial<Pick<ConventionCandidate, "status" | "rule" | "category">>;
}

/**
 * Accept, reject or edit one candidate. The row is written back into the cached
 * list rather than refetched — a scan can take a minute, and the button that
 * accepts a rule should not be able to trigger one.
 */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated) =>
      qc.setQueryData(key(repoId), (prev: ConventionsResponse | undefined) =>
        prev
          ? { ...prev, candidates: prev.candidates.map((c) => (c.id === updated.id ? updated : c)) }
          : prev,
      ),
  });
}

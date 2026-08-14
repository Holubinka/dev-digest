/* hooks/core.ts — typed React Query hooks over the F1 API (contracts):
   settings, secrets, repos, pulls, and project context. Scaffolding screens use
   these; feature-domain hooks live in the sibling files (agents/reviews/trace/…)
   and are re-exported alongside these from hooks/index.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Repo,
  PrMeta,
  PrDetail,
  IntentRecord,
  SmartDiff,
  ContextDocsPage,
} from "../types";

// ---- Settings (F1: GET/PUT /settings, POST /settings/test-connection) ----
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => {
      const body = typeof input === "string" ? { provider: input } : input;
      return api.post<ConnTestResult>("/settings/test-connection", body);
    },
    // Saving/validating a provider key can change which models resolve — drop the
    // cached (possibly empty) model lists so the agent picker refetches, and
    // refresh the "Configured / Not set" key-status badges.
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["provider-models"] });
        qc.invalidateQueries({ queryKey: ["secrets-status"] });
      }
    },
  });
}

/** Which provider keys are configured (booleans only — never the values). */
export function useSecretsStatus() {
  return useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"),
    staleTime: 30_000,
  });
}

// ---- Repos (F1: GET/POST /repos, refresh, delete) ----
export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<Repo[]>("/repos"),
  });
}

export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<Repo>("/repos", { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

export function useRefreshRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<Repo>(`/repos/${repoId}/refresh`),
    onSuccess: (_d, repoId) => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: ["pulls", repoId] });
    },
  });
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

// ---- Pull requests (F1: GET /repos/:id/pulls, GET /pulls/:id) ----
export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

// ---- Smart Diff (GET /pulls/:id/smart-diff) ----

/**
 * The reviewer-ordered file list. Derived server-side from `pr_files` and the
 * PR's findings on every request — no model call, so it needs no "recompute"
 * mutation and is safe to refetch. Invalidate it when a review finishes, which
 * is the only thing that changes the answer (`pulls/[number]/page.tsx`).
 */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: prId != null,
  });
}

// ---- PR intent (05: GET/POST /pulls/:id/intent) ----

/** `null` (not an error) is the answer for a PR whose intent was never derived. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<IntentRecord | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** One LLM call server-side (rate-limited 6/min), so it is never automatic. */
export function useRecomputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: (data) => qc.setQueryData(["pr-intent", prId], data),
  });
}

// ---- Project Context (08) ----

/**
 * The Project Context page in one document: the scan's state and output, plus
 * the documents it found.
 *
 * The name and the call site survive from the A3 scaffolding; the path does not.
 * `GET /repos/:id/context` was written against a server that never shipped, and
 * the endpoint that exists returns the whole page rather than a bare array —
 * the scan state, the roots and the last-scanned time are what the four empty
 * states are decided from, and none of them can be inferred from a list.
 */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-docs", repoId],
    queryFn: () => api.get<ContextDocsPage>(`/repos/${repoId}/context/docs`),
    enabled: !!repoId,
    // A scan runs in the background; poll while it is in flight so the page
    // fills in without the user pressing anything.
    refetchInterval: (query) => (query.state.data?.state === "scanning" ? 2_000 : false),
  });
}

/**
 * Re-scan the clone.
 *
 * Deliberately NOT `useReindexContext`: "reindex" is the vocabulary of the
 * chunk-and-embed feature this lesson puts out of scope, and keeping the word
 * would make the empty half of `IndexStatus` look implemented.
 */
export function useRescanContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ status: "scanning" }>(`/repos/${repoId}/context/rescan`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context-docs", repoId] }),
  });
}

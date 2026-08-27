/* hooks/ci.ts — Export to CI (SPEC-05): the agent's installations, the export
   wizard's two write paths, and the CI Runs page.

   Imported directly (`@/lib/hooks/ci`), never re-exported from
   `lib/hooks/index.ts`: that barrel is an aggregating `export *` and every
   importer of it pulls five more domains into the graph (`client/INSIGHTS.md`
   "Nine `index.ts` files are aggregating barrels").

   NOTHING HERE POLLS ON A TIMER. AC-122 forbids reaching the GitHub Actions API
   from a schedule or a background task, so there is no `refetchInterval` in this
   file and there must not be one; `lib/providers.tsx` already sets
   `refetchOnWindowFocus: false` for every query. The scaffolded string
   `ci.runs.autoRefresh` stays unused for the same reason. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, ApiError } from "../api";
import type {
  CiExport,
  CiExportInputBody,
  CiInstallationListItem,
  CiRun,
} from "../types";

/** `GET /ci/runs` and `POST /ci/runs/refresh` answer with this envelope. */
export interface CiRunsPage {
  runs: CiRun[];
  last_polled_at: string | null;
  /** Per-repo poll failures (AC-83). Absent on the plain read. */
  errors?: { repo: string; reason: string }[];
}

export const CI_RUNS_KEY = ["ci-runs"] as const;
export const ciInstallationsKey = (agentId: string | null | undefined) =>
  ["ci-installations", agentId] as const;

/** An agent's `ci_installations`, each with its last run and its staleness. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciInstallationsKey(agentId),
    queryFn: () => api.get<CiInstallationListItem[]>(`/agents/${agentId}/ci`),
    enabled: !!agentId,
  });
}

/**
 * The CI Runs page's rows.
 *
 * The read IS the unforced poll. AC-120 says opening the page polls the Actions
 * API of every installed repo, and AC-121 says a repo polled successfully less
 * than five minutes ago is skipped and its stored rows returned — which is
 * exactly what `POST /ci/runs/refresh` with `force: false` does. Fetching
 * `GET /ci/runs` first and firing the refresh from an effect would cost a second
 * round trip and a mount guard that `<React.StrictMode>` exists to break
 * (`client/INSIGHTS.md`); putting the unforced refresh in the `queryFn` gets the
 * once-per-open behaviour from the query cache itself.
 */
export function useCiRuns() {
  return useQuery({
    queryKey: CI_RUNS_KEY,
    queryFn: () => api.post<CiRunsPage>("/ci/runs/refresh", { force: false }),
  });
}

/**
 * The Refresh button (AC-68). `force: true` ignores the five-minute window.
 *
 * The fresh page is written into the query cache rather than invalidated: an
 * invalidation would refetch and poll a second time, and `force` is a user
 * action that should cost exactly one poll.
 */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRunsPage>("/ci/runs/refresh", { force: true }),
    onSuccess: (data) => qc.setQueryData(CI_RUNS_KEY, data),
  });
}

/**
 * The wizard's write path, used twice: `action: "files"` generates the bundle
 * for the Preview and Configure steps and writes nothing (AC-7), `action:
 * "open_pr"` is what `Install` sends.
 *
 * The caches are refreshed on every success rather than only for `open_pr`,
 * because the caller decides the action and a generate-only call invalidating
 * two queries costs one refetch of data the screen is already showing.
 */
export function useExportCi(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (data) => {
      if (!data.pr_url) return;
      qc.invalidateQueries({ queryKey: ciInstallationsKey(agentId) });
      qc.invalidateQueries({ queryKey: CI_RUNS_KEY });
    },
  });
}

/** Hand the archive to the browser. Revoked on the next frame, not immediately:
 *  Safari cancels a download whose object URL is revoked in the same task. */
function saveArchive(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Copy files as a zip" (AC-44). Makes no GitHub call and writes no
 * installation row, so no cache is touched on success.
 *
 * `fetch` rather than `lib/api`: the response is `application/zip` and
 * `apiFetch` ends in `res.json()`. It is still the only `fetch` outside
 * `lib/api.ts`, and it stays in this file — never in a component
 * (`client/AGENTS.md`).
 */
export function useDownloadCiZip(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: async (input: CiExportInputBody) => {
      const res = await fetch(`${API_BASE}/agents/${agentId}/export-ci/zip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        let code: string | undefined;
        try {
          const body = await res.json();
          if (body?.error) {
            code = body.error.code;
            message = body.error.message ?? message;
          }
        } catch {
          /* the error body is not JSON */
        }
        throw new ApiError(message, res.status, code);
      }
      const blob = await res.blob();
      // The repo name is the server's; slashes in it would read as a path.
      saveArchive(blob, `devdigest-ci-${input.repo.replace(/[^a-zA-Z0-9._-]+/g, "-")}.zip`);
      return blob.size;
    },
  });
}

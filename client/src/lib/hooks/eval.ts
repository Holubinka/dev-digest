/* hooks/eval.ts — React Query hooks for the eval pipeline (SPEC-05).

     POST   /findings/:id/eval-case        → EvalCaseFromFinding. `created:false`
                                             means the case already existed and
                                             is DATA, not an error: the second
                                             click opens the first case (AC-10).
     GET    /agents/:id/eval-cases         → EvalCaseSet   (cases + N/M passing)
     GET    /skills/:id/eval-cases         → SkillEvalCaseSet (the reciprocal view)
     POST   /agents/:id/eval-cases         → EvalCase      ("New eval case")
     GET    /eval-cases/:id                → EvalCase
     PUT    /eval-cases/:id                → EvalCase
     DELETE /eval-cases/:id                → 204
     POST   /eval-cases/:id/run            → EvalRunResult   PAID
     POST   /agents/:id/eval-runs          → EvalBatchResult PAID, 3/min
     POST   /eval-runs                     → EvalRunAllResult PAID, 3/min
     GET    /eval-dashboard                → EvalDashboardAll
     GET    /agents/:id/eval-dashboard     → EvalAgentDashboard  (?from=&to=)
     GET    /eval-batches/compare?a=&b=    → EvalCompare

   Every mutation below that reaches a model provider — the three run routes —
   gets NO retry and NO optimistic update. A retry on a paid call spends money
   twice for one user gesture, and an optimistic metric is a number nobody
   computed: the whole point of this screen is that recall/precision moved
   because the run said so.

   Deliberately NOT re-exported from `lib/hooks/index.ts`: that barrel is
   `export *` over five domain modules, so reaching one hook through it drags
   the other four into the module graph (`client/INSIGHTS.md`, "export * barrels
   drag four unrelated module graphs into a test"). Import this file directly,
   the way `lib/hooks/onboarding.ts` and `lib/hooks/brief.ts` are imported. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  AgentVersion,
  EvalAgentDashboard,
  EvalBatchResult,
  EvalCase,
  EvalCaseFromFinding,
  EvalCaseSet,
  EvalCompare,
  EvalDashboardAll,
  EvalRunAllResult,
  EvalRunResult,
  SkillEvalCaseSet,
} from "../types";

/** A completed batch is bounded by a date range on the agent dashboard (R46). */
export interface EvalDateRange {
  from?: string | null;
  to?: string | null;
}

/**
 * One definition of every cache key, so a mutation writes where a query reads.
 *
 * `agentDashboard` deliberately nests under the same `"eval-dashboard"` root as
 * `dashboardAll`: a finished batch moves BOTH screens, and TanStack matches
 * query keys by prefix, so one `invalidateQueries({ queryKey: ["eval-dashboard"] })`
 * refreshes the all-agents cards and every per-agent range that is mounted.
 *
 * The range is part of the agent key because it is part of the request: the
 * server bounds the trend and the batch table with the same `from`/`to`, so two
 * ranges are two different answers and must not share a cache entry.
 */
export const evalKeys = {
  caseSet: (agentId: string | null | undefined) => ["eval-cases", agentId] as const,
  skillCaseSet: (skillId: string | null | undefined) => ["skill-eval-cases", skillId] as const,
  case: (caseId: string | null | undefined) => ["eval-case", caseId] as const,
  dashboardAll: () => ["eval-dashboard"] as const,
  agentDashboard: (agentId: string | null | undefined, range?: EvalDateRange) =>
    ["eval-dashboard", agentId, range?.from ?? null, range?.to ?? null] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) =>
    ["eval-compare", a, b] as const,
};

function rangeQuery(range?: EvalDateRange): string {
  const sp = new URLSearchParams();
  if (range?.from) sp.set("from", range.from);
  if (range?.to) sp.set("to", range.to);
  const q = sp.toString();
  return q ? `?${q}` : "";
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** The agent's whole case set plus the `N / M passing` badge the heading shows. */
export function useEvalCaseSet(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.caseSet(agentId),
    queryFn: () => api.get<EvalCaseSet>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** Every case, across agents, whose last run had this skill active (the skill's own tab). */
export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillCaseSet(skillId),
    queryFn: () => api.get<SkillEvalCaseSet>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

/** One case, with the input and expectations the editor edits. */
export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.case(caseId),
    queryFn: () => api.get<EvalCase>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

export interface EvalCaseBody {
  name: string;
  input_diff: string;
  input_meta?: unknown;
  expected_output: unknown;
  notes?: string | null;
}

export function useCreateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EvalCaseBody) => api.post<EvalCase>(`/agents/${agentId}/eval-cases`, body),
    onSuccess: (created) => {
      qc.setQueryData(evalKeys.case(created.id), created);
      void qc.invalidateQueries({ queryKey: evalKeys.caseSet(agentId) });
    },
  });
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, body }: { caseId: string; body: EvalCaseBody }) =>
      api.put<EvalCase>(`/eval-cases/${caseId}`, body),
    onSuccess: (saved) => {
      qc.setQueryData(evalKeys.case(saved.id), saved);
      void qc.invalidateQueries({ queryKey: evalKeys.caseSet(saved.owner_id) });
    },
  });
}

/**
 * Deleting a case takes its run rows with it (DB cascade), but leaves every
 * already-written batch aggregate alone (AC-22) — so the dashboards are
 * invalidated rather than patched: a past batch's "17/20" must not move here.
 */
export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<void>(`/eval-cases/${caseId}`),
    onSuccess: (_void, caseId) => {
      qc.removeQueries({ queryKey: evalKeys.case(caseId) });
      void qc.invalidateQueries({ queryKey: evalKeys.caseSet(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboardAll() });
    },
  });
}

/**
 * Turn a DECIDED finding into a case. Not a model call, but a write: the
 * response carries the case and whether it was created now or already existed.
 */
export function useEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCaseFromFinding>(`/findings/${findingId}/eval-case`),
    onSuccess: ({ case: c }) => {
      qc.setQueryData(evalKeys.case(c.id), c);
      void qc.invalidateQueries({ queryKey: evalKeys.caseSet(c.owner_id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Runs — every one of these spends money
// ---------------------------------------------------------------------------

/** One case, one model call. `result.traces_total` is 1 (AC-21). */
export function useRunEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (caseId: string) => api.post<EvalRunResult>(`/eval-cases/${caseId}/run`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.caseSet(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboardAll() });
    },
  });
}

/**
 * The whole set, one paid call per case, sequentially on the server. The
 * response arrives only when the batch is done, which is what lets the calling
 * screen show "Running…" for its whole duration off `isPending` (AC-35).
 */
export function useRunEvalSet(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: () => api.post<EvalBatchResult>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.caseSet(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboardAll() });
    },
  });
}

/** Every agent that has at least one case; the rest come back named in `skipped`. */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: () => api.post<EvalRunAllResult>("/eval-runs"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.dashboardAll() });
      void qc.invalidateQueries({ queryKey: ["eval-cases"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboards and comparison
// ---------------------------------------------------------------------------

/** Every agent that has cases, plus the recent batches of all of them. */
export function useEvalDashboardAll() {
  return useQuery({
    queryKey: evalKeys.dashboardAll(),
    queryFn: () => api.get<EvalDashboardAll>("/eval-dashboard"),
  });
}

/** One agent's metric cards, trend and batch table — all bounded by `range`. */
export function useEvalAgentDashboard(agentId: string | null | undefined, range?: EvalDateRange) {
  return useQuery({
    queryKey: evalKeys.agentDashboard(agentId, range),
    queryFn: () =>
      api.get<EvalAgentDashboard>(`/agents/${agentId}/eval-dashboard${rangeQuery(range)}`),
    enabled: !!agentId,
  });
}

/**
 * Two batches side by side, old (`a`) → new (`b`). `changed_lines` is computed
 * on the server, so nothing here diffs text — the modal only highlights.
 */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get<EvalCompare>(`/eval-batches/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b,
  });
}

/**
 * «Promote vN» — two EXISTING agent routes in sequence, and deliberately no new
 * endpoint: read the version's config snapshot, then apply it through the
 * ordinary agent update. That path already bumps `agents.version` and writes a
 * fresh `agent_versions` row, so the promoted version's own history row is left
 * exactly as it was (AC-64, AC-65). A dedicated `/promote` route would be a
 * second way to change an agent's config, and a second place for the version
 * bump to drift.
 *
 * `skills` is NOT part of the update: the snapshot records which skills were
 * bound, but `PUT /agents/:id` takes config only, and rebinding them is a
 * different endpoint with set semantics. Promoting a prompt is what AC-64 asks
 * for; silently rewiring an agent's skills is not.
 */
export function usePromoteAgentVersion() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ agentId, version }: { agentId: string; version: number }) => {
      const snapshot = await api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`);
      const { provider, model, system_prompt, output_schema, strategy, ci_fail_on, repo_intel } =
        snapshot.config;
      return api.put<Agent>(`/agents/${agentId}`, {
        provider,
        model,
        system_prompt,
        output_schema,
        strategy,
        ci_fail_on,
        repo_intel,
      });
    },
    onSuccess: (agent) => {
      // The same literal keys `lib/hooks/agents.ts` reads under — the editor
      // must not keep showing the prompt this call just replaced.
      qc.setQueryData(["agent", agent.id], agent);
      void qc.invalidateQueries({ queryKey: ["agents"] });
      void qc.invalidateQueries({ queryKey: ["agent-versions", agent.id] });
    },
  });
}

/* hooks/context.ts — Project Context (08): one document's text, and the
   per-agent / per-skill attachment sets.

   The page itself is `useContextDocs` in `./core`, where the A3 scaffolding put
   it; these are the endpoints that had no stub to inherit. */
"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentContextDocs,
  ContextFolderCreated,
  SkillContextDocs,
  SpecFile,
} from "../types";

/**
 * One document's markdown, for the reading pane.
 *
 * The server serves SCANNED documents only, so a path it has no row for is a
 * 404 rather than an arbitrary read of the clone.
 */
export function useContextDoc(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<SpecFile>(
        `/repos/${repoId}/context/docs/content?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/**
 * An agent's attachments for one repository, plus what it inherits from its
 * enabled bound skills.
 *
 * The repo id is IN the query key, not merely in the URL: switching the active
 * repository has to refetch rather than render the previous repository's set
 * while the new one loads.
 */
export function useAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId, repoId],
    queryFn: () =>
      api.get<AgentContextDocs>(`/agents/${agentId}/context-docs?repo_id=${repoId}`),
    enabled: !!agentId && !!repoId,
  });
}

/**
 * Replace an agent's whole ordered set for one repository.
 *
 * Set semantics, mirroring `useSetAgentSkills`: attaching, detaching and
 * reordering are all this one request, so there is no separate detach route to
 * keep in step. The response IS the new state, so it is written straight into
 * the cache rather than triggering a refetch.
 */
export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      repoId,
      paths,
    }: {
      agentId: string;
      repoId: string;
      paths: string[];
    }) =>
      api.put<AgentContextDocs>(`/agents/${agentId}/context-docs`, {
        repo_id: repoId,
        paths,
      }),
    onSuccess: (data, { agentId, repoId }) => {
      qc.setQueryData(["agent-context-docs", agentId, repoId], data);
      // The page's "Used by N agents" column just moved.
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

/**
 * What every write to a document has to invalidate.
 *
 * The returned `SpecFile` is deliberately NOT written into any cache by hand.
 * A document is a scan result, and `used_by_agents`, the file count and the
 * scan's own state all come from the page query — writing one row from a
 * response would leave the rest of that document stale in a way nothing later
 * corrects.
 *
 * The last two keys are the ones a save reaches indirectly: an edited document
 * is longer or shorter, so the agent editor's token footer moves and its
 * over-budget warning may appear, with the attachment set untouched.
 */
function invalidateAfterWrite(qc: QueryClient, repoId: string, path?: string) {
  qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
  if (path !== undefined) qc.invalidateQueries({ queryKey: ["context-doc", repoId, path] });
  qc.invalidateQueries({ queryKey: ["agent-context-docs"] });
  qc.invalidateQueries({ queryKey: ["skill-context-docs"] });
}

/**
 * Create a document under `.devdigest/` in this repository's clone.
 *
 * The server answers with the scanned row, so the document is in the next
 * `GET …/docs` with no rescan — which is why this invalidates the page rather
 * than starting one.
 */
export function useCreateContextDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, path, content }: { repoId: string; path: string; content: string }) =>
      api.post<SpecFile>(`/repos/${repoId}/context/docs`, { path, content }),
    onSuccess: (_doc, { repoId, path }) => invalidateAfterWrite(qc, repoId, path),
  });
}

/**
 * The same document, from a file the user picked.
 *
 * The browser sends the bytes and the filename; the server decides the path from
 * the BASENAME of that filename, so nothing here tries to build one.
 */
export function useUploadContextDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, file }: { repoId: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<SpecFile>(`/repos/${repoId}/context/docs/upload`, form);
    },
    onSuccess: (doc, { repoId }) => invalidateAfterWrite(qc, repoId, doc.path),
  });
}

/**
 * A folder under `.devdigest/`.
 *
 * It holds no `.md`, so the document list cannot show it and the caller has to
 * say so itself. The page is invalidated anyway: the folder is only useful as
 * somewhere to put a document, and the two happen one after the other.
 */
export function useCreateContextFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, path }: { repoId: string; path: string }) =>
      api.post<ContextFolderCreated>(`/repos/${repoId}/context/folders`, { path }),
    onSuccess: (_folder, { repoId }) => invalidateAfterWrite(qc, repoId),
  });
}

/**
 * Overwrite a scanned document with new text.
 *
 * There is no `confirm_tracked` field and the server asks for none: warning
 * before a save to a git-tracked file is a UI act, and the dialog that carries
 * it lives in the panel that calls this.
 */
export function useSaveContextDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, path, content }: { repoId: string; path: string; content: string }) =>
      api.put<SpecFile>(`/repos/${repoId}/context/docs/content`, { path, content }),
    onSuccess: (_doc, { repoId, path }) => invalidateAfterWrite(qc, repoId, path),
  });
}

export function useSkillContextDocs(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId, repoId],
    queryFn: () =>
      api.get<SkillContextDocs>(`/skills/${skillId}/context-docs?repo_id=${repoId}`),
    enabled: !!skillId && !!repoId,
  });
}

export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      repoId,
      paths,
    }: {
      skillId: string;
      repoId: string;
      paths: string[];
    }) =>
      api.put<SkillContextDocs>(`/skills/${skillId}/context-docs`, {
        repo_id: repoId,
        paths,
      }),
    onSuccess: (data, { skillId, repoId }) => {
      qc.setQueryData(["skill-context-docs", skillId, repoId], data);
      // Every agent binding this skill inherits the change, and the page's
      // "Used by N agents" counts those agents.
      qc.invalidateQueries({ queryKey: ["agent-context-docs"] });
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

import type { ConventionCandidate } from "@devdigest/shared";

/**
 * Shared fixture for the Conventions screens. The card, the view and the merge
 * helper all need a full candidate, and a field added to the contract should
 * cost one edit rather than three.
 */
export function convention(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    repo_id: "repo-1",
    scan_id: "scan-1",
    category: "error-handling",
    rule: "Route handlers throw AppError subclasses instead of returning an error object.",
    evidence_path: "src/modules/skills/routes.ts",
    evidence_snippet: '  throw new NotFoundError("Skill not found");',
    evidence_line: 74,
    evidence_end_line: 74,
    extra_evidence: [
      {
        path: "src/modules/agents/routes.ts",
        line: 148,
        end_line: 148,
        snippet: '  throw new NotFoundError("Agent not found");',
      },
    ],
    head_sha: "d227ec8",
    confidence: 0.86,
    status: "pending",
    created_at: "2026-08-03T12:00:00.000Z",
    ...over,
  };
}

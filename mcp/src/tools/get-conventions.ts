/**
 * `get_conventions` (spec 06 step 6).
 *
 * Reads stored candidates only. It never calls
 * `POST /repos/:id/conventions/extract` — an extraction is one paid model call
 * and the user starts it from the DevDigest UI (spec 06 §Out of scope).
 *
 * An empty answer is treated the way an error is: it says what exists and what
 * to do next, because "no conventions" and "none ACCEPTED yet" lead to
 * completely different next steps.
 */

import { z } from 'zod';
import type { ApiClient } from '../api/client.js';
import type { Resolver } from '../api/resolve.js';
import { assertRepoSlug } from '../api/resolve.js';
import { ConventionsPayload, type ConventionSummary } from '../api/schemas.js';
import { okResult, type ToolTextResult } from '../errors.js';
import { CONVENTIONS_DEFAULT_LIMIT, projectConventions } from '../project.js';

export const CONVENTION_STATUSES = ['accepted', 'pending', 'rejected'] as const;
export type ConventionStatusArg = (typeof CONVENTION_STATUSES)[number];

export interface GetConventionsArgs {
  repo: string;
  status?: ConventionStatusArg;
  limit?: number;
}

/** One line of provenance, so the model can judge how stale the rules are. */
function provenance(scan: z.infer<typeof ConventionsPayload>['scan']): string | null {
  return scan ? `extracted ${scan.created_at} by ${scan.model}` : null;
}

function emptyNote(
  repo: string,
  status: ConventionStatusArg,
  candidates: readonly ConventionSummary[],
): string {
  if (candidates.length === 0) {
    return (
      `DevDigest has not extracted conventions for ${repo} yet. Ask the user to run the ` +
      `extraction scan on the repo page in the DevDigest UI — it is a paid model call, so ` +
      `this server never starts one.`
    );
  }
  const pending = candidates.filter((c) => c.status === 'pending').length;
  if (status === 'accepted' && pending > 0) {
    return (
      `No accepted conventions for ${repo}. ${pending} candidates are pending — call ` +
      `get_conventions with status="pending", or accept them in the DevDigest UI.`
    );
  }
  return (
    `No ${status} conventions for ${repo}. ${candidates.length} candidates exist with a ` +
    `different status — call get_conventions with status="accepted" or status="pending".`
  );
}

export async function getConventions(
  client: ApiClient,
  resolver: Resolver,
  args: GetConventionsArgs,
): Promise<ToolTextResult> {
  const repo = assertRepoSlug(args.repo);
  const status = args.status ?? 'accepted';
  const limit = args.limit ?? CONVENTIONS_DEFAULT_LIMIT;

  const repoId = await resolver.repoId(repo);
  const payload = await client.get(
    `/repos/${encodeURIComponent(repoId)}/conventions`,
    ConventionsPayload,
  );

  const matching = payload.candidates.filter((c) => c.status === status);
  const projected = projectConventions(matching, { limit });
  const note =
    projected.note ?? (matching.length === 0 ? emptyNote(repo, status, payload.candidates) : undefined);

  return okResult({
    repo,
    status,
    scan: provenance(payload.scan),
    conventions: projected.conventions,
    ...(note !== undefined ? { note } : {}),
  });
}

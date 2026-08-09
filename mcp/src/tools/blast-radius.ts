/**
 * `get_blast_radius` (spec 07 step 13, replacing the spec 06 step 9 stub).
 *
 * One read of `GET /pulls/:id/blast`, projected. The route answers from the
 * persistent code index only — no AST parse, no clone read, no model call — so
 * this tool costs nothing and may be called freely before a review.
 *
 * The one thing it must never do is let a short answer read as a safe one. The
 * API says how much of the index backed its answer (`status`), and a non-`full`
 * status becomes a `note` in the result, the way `get_conventions` turns an empty
 * answer into a next step: an empty `symbols` list under `degraded` means the
 * index could not tell, not that nothing depends on the change.
 */

import type { ApiClient } from '../api/client.js';
import { assertPrNumber, assertRepoSlug, type Resolver } from '../api/resolve.js';
import { BlastPayload } from '../api/schemas.js';
import { okResult, type ToolTextResult } from '../errors.js';
import { projectBlast } from '../project.js';

export interface BlastRadiusArgs {
  repo: string;
  pr: number;
}

export function blastPath(pullId: string): string {
  return `/pulls/${encodeURIComponent(pullId)}/blast`;
}

export async function getBlastRadius(
  client: ApiClient,
  resolver: Resolver,
  args: BlastRadiusArgs,
): Promise<ToolTextResult> {
  // Validated here as well as in the resolver: a malformed argument is a caller
  // mistake worth naming before any request is made.
  const repo = assertRepoSlug(args.repo);
  const pr = assertPrNumber(args.pr);

  const pullId = await resolver.pullId(repo, pr);
  const view = await client.get(blastPath(pullId), BlastPayload);

  return okResult({ repo, pr, ...projectBlast(view) });
}

/**
 * Human argument → API id (spec 06 step 3).
 *
 * The tool surface takes what a person says — "acme/payments-api", 482, an agent
 * name — and never an internal id. These three resolvers are what turns that
 * into the ids the API routes need.
 *
 * No caller-supplied string is ever concatenated into a URL path: `repo` and
 * `agent` are MATCHED against API output, and only server-issued ids reach a
 * path segment. The regexes below are validated anyway, so a malformed argument
 * fails with an actionable message instead of a confusing 404.
 *
 * Caching, and why the two are different:
 *   - repo id: forever. A repo's id does not change while this process lives.
 *   - pull id: 5 minutes. `GET /repos/:id/pulls` SYNCS from GitHub and backfills
 *     diff stats for up to ten PRs per call (server/src/modules/pulls/routes.ts:
 *     89-116) — it is the expensive route and it writes, so it must never run
 *     once per poll of a running review.
 */

import { z } from 'zod';
import type { ApiClient } from './client.js';
import { AgentSummary, PullSummary, RepoSummary } from './schemas.js';
import {
  agentAmbiguous,
  agentNotFound,
  invalidArgument,
  prNotFound,
  prNotImported,
  repoNotImported,
} from '../errors.js';

/** `owner/name`, as spec 06 step 3 fixes it. */
export const REPO_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export const PULL_ID_TTL_MS = 5 * 60 * 1000;

export function assertRepoSlug(repo: string): string {
  if (typeof repo !== 'string' || !REPO_SLUG_PATTERN.test(repo)) {
    throw invalidArgument(
      `repo must look like "owner/name" (letters, digits, dot, dash, underscore), got ` +
        `${JSON.stringify(repo)}.`,
    );
  }
  return repo;
}

export function assertPrNumber(pr: number): number {
  if (!Number.isInteger(pr) || pr <= 0) {
    throw invalidArgument(
      `pr must be a positive whole GitHub pull request number, got ${JSON.stringify(pr)}.`,
    );
  }
  return pr;
}

const RepoList = z.array(RepoSummary);
const PullList = z.array(PullSummary);
const AgentList = z.array(AgentSummary);

interface Expiring {
  id: string;
  expiresAt: number;
}

export interface ResolverOptions {
  /** Injected clock, so the pull-id TTL is testable without fake timers. */
  now?: () => number;
  pullTtlMs?: number;
}

export class Resolver {
  private readonly repoIds = new Map<string, string>();
  private readonly pullIds = new Map<string, Expiring>();
  private readonly now: () => number;
  private readonly pullTtlMs: number;

  constructor(
    private readonly client: ApiClient,
    options: ResolverOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.pullTtlMs = options.pullTtlMs ?? PULL_ID_TTL_MS;
  }

  /** `owner/name` → repo id. Case-insensitive; cached for the process lifetime. */
  async repoId(fullName: string): Promise<string> {
    const slug = assertRepoSlug(fullName);
    const key = slug.toLowerCase();
    const cached = this.repoIds.get(key);
    if (cached !== undefined) return cached;

    const repos = await this.client.get('/repos', RepoList);
    for (const repo of repos) this.repoIds.set(repo.full_name.toLowerCase(), repo.id);

    const hit = this.repoIds.get(key);
    if (hit !== undefined) return hit;
    throw repoNotImported(
      slug,
      repos.map((r) => r.full_name),
    );
  }

  /** `owner/name` + PR number → pull id. Cached with a 5-minute TTL. */
  async pullId(fullName: string, prNumber: number): Promise<string> {
    const slug = assertRepoSlug(fullName);
    const number = assertPrNumber(prNumber);
    const repoId = await this.repoId(slug);

    const key = `${repoId}#${number}`;
    const cached = this.pullIds.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.id;
    this.pullIds.delete(key);

    const pulls = await this.client.get(
      `/repos/${encodeURIComponent(repoId)}/pulls`,
      PullList,
    );

    // One sync serves every PR in the response, not only the one asked for.
    const expiresAt = this.now() + this.pullTtlMs;
    for (const pull of pulls) {
      if (pull.id != null) this.pullIds.set(`${repoId}#${pull.number}`, { id: pull.id, expiresAt });
    }

    const match = pulls.find((p) => p.number === number);
    if (!match) {
      throw prNotFound(
        slug,
        number,
        pulls.map((p) => p.number),
      );
    }
    if (match.id == null) throw prNotImported(slug, number);
    return match.id;
  }

  /**
   * Agent name → id. Case-insensitive exact match; ambiguity is an error listing
   * the candidates rather than a silent pick, because picking one would start a
   * billed run with the wrong reviewer.
   */
  async agentId(name: string): Promise<{ id: string; name: string }> {
    const wanted = String(name).trim().toLowerCase();
    const agents = await this.client.get('/agents', AgentList);
    const matches = agents.filter((a) => a.name.trim().toLowerCase() === wanted);

    if (matches.length === 0) throw agentNotFound(name);
    if (matches.length > 1) {
      throw agentAmbiguous(
        name,
        matches.map((m) => ({ name: m.name, model: m.model })),
      );
    }
    const only = matches[0]!;
    return { id: only.id, name: only.name };
  }
}

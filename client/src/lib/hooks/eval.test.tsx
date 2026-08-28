import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentVersion, Agent } from "../types";

/**
 * `usePromoteAgentVersion` — what it reads from a version snapshot and what
 * it actually PUTs. `AgentVersionConfig` carries `skills`, which the mutation
 * deliberately does NOT forward: promoting an old prompt/model must not also
 * revert which skills are bound today, and `tsc` cannot see a field a caller
 * chose to drop.
 */
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { get, put } }));

import { usePromoteAgentVersion } from "./eval";

const SNAPSHOT: AgentVersion = {
  agent_id: "agent-1",
  version: 3,
  created_at: "2026-05-01T00:00:00.000Z",
  config: {
    provider: "openrouter",
    model: "anthropic/claude-haiku-4.5",
    system_prompt: "You are a reviewer.",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills: ["skill-a", "skill-b"],
  },
};

const PROMOTED: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags secrets and injection.",
  provider: "openrouter",
  model: "anthropic/claude-haiku-4.5",
  system_prompt: "You are a reviewer.",
  output_schema: null,
  enabled: true,
  version: 4,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
};

beforeEach(() => {
  get.mockReset().mockResolvedValue(SNAPSHOT);
  put.mockReset().mockResolvedValue(PROMOTED);
});
afterEach(cleanup);

function wrap() {
  // No gcTime: 0 here — unlike brief.test.tsx's helper, these tests read
  // setQueryData's result with no active useQuery observer keeping the entry
  // alive, and an immediate-GC client would drop it before the assertion runs.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("usePromoteAgentVersion", () => {
  it("reads the version snapshot and PUTs only the config fields, never skills", async () => {
    const { Wrapper } = wrap();
    const { result } = renderHook(() => usePromoteAgentVersion(), { wrapper: Wrapper });

    result.current.mutate({ agentId: "agent-1", version: 3 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get).toHaveBeenCalledWith("/agents/agent-1/versions/3");
    expect(put).toHaveBeenCalledWith("/agents/agent-1", {
      provider: "openrouter",
      model: "anthropic/claude-haiku-4.5",
      system_prompt: "You are a reviewer.",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
    });
    const [, body] = put.mock.calls[0]!;
    expect(body).not.toHaveProperty("skills");
  });

  it("writes the promoted agent into the agent cache and invalidates the lists that read it stale", async () => {
    const { client, Wrapper } = wrap();
    client.setQueryData(["agent", "agent-1"], { ...PROMOTED, version: 3 });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePromoteAgentVersion(), { wrapper: Wrapper });

    result.current.mutate({ agentId: "agent-1", version: 3 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Written directly (not invalidated) so the editor shows the promoted
    // prompt on the very next render, with no round trip in between.
    expect(client.getQueryData(["agent", "agent-1"])).toEqual(PROMOTED);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent-versions", "agent-1"] });
  });
});

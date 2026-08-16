import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RiskBriefRecord } from "../types";

/**
 * `usePrBrief` / `useComputeBrief` — the cache key and what the mutation does
 * with it. Both are load-bearing beyond this file and neither is visible to
 * `tsc`.
 *
 * The key carries `head_sha`, and that is the whole of AC-7: a new head is a
 * different entry, so the previous state's brief cannot be rendered as the
 * current one while a new one computes. Pinning the literal here is what makes
 * a drifting key a test failure rather than a wrong answer on screen.
 */
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { get, post } }));

import {
  briefQueryKey,
  useBriefComputeAttempted,
  usePrBrief,
  useComputeBrief,
} from "./brief";

const HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const NEXT_HEAD = "0011223344556677889900112233445566778899";

const RECORD = { head_sha: HEAD, what: "adds a brief", risk_level: "high" } as RiskBriefRecord;

beforeEach(() => {
  get.mockReset().mockResolvedValue(null);
  post.mockReset().mockResolvedValue(RECORD);
});
afterEach(cleanup);

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("briefQueryKey", () => {
  it("keys a brief by the PR AND the state it describes", () => {
    expect(briefQueryKey("pr-1", HEAD)).toEqual(["brief", "pr-1", HEAD]);
    expect(briefQueryKey("pr-1", HEAD)).not.toEqual(briefQueryKey("pr-1", NEXT_HEAD));
  });
});

describe("usePrBrief", () => {
  it("reads the brief route and caches it under the state's own key", async () => {
    get.mockResolvedValue(RECORD);
    const { client, Wrapper } = wrap();
    const { result } = renderHook(() => usePrBrief("pr-1", HEAD), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/pulls/pr-1/brief");
    expect(client.getQueryData(["brief", "pr-1", HEAD])).toEqual(RECORD);
    // The state that has NOT been read holds nothing — which is what stops one
    // head's brief being shown as another's.
    expect(client.getQueryData(["brief", "pr-1", NEXT_HEAD])).toBeUndefined();
  });

  it("asks nothing before the head commit is known", () => {
    const { Wrapper } = wrap();
    renderHook(() => usePrBrief("pr-1", null), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useComputeBrief", () => {
  it("writes its result into the query's key instead of invalidating it", async () => {
    const { client, Wrapper } = wrap();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    // Both hooks, the way `OverviewTab` holds them: the assertion that counts is
    // what the READER ends up with, not what the cache momentarily contains.
    const { result } = renderHook(
      () => ({ read: usePrBrief("pr-1", HEAD), compute: useComputeBrief("pr-1", HEAD) }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.read.isSuccess).toBe(true));
    expect(result.current.read.data).toBeNull();

    result.current.compute.mutate();
    await waitFor(() => expect(result.current.compute.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith("/pulls/pr-1/brief");
    expect(result.current.read.data).toEqual(RECORD);
    expect(client.getQueryData(["brief", "pr-1", HEAD])).toEqual(RECORD);
    // An invalidation would spend a round trip re-reading the row the mutation
    // just returned, and would blank the card for its duration — so the read
    // route must have been called exactly once, by the initial read.
    expect(invalidate).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

/**
 * The pair `useComputeBrief` / `useBriefComputeAttempted` is one mechanism held
 * together by a shared key, and `tsc` cannot see either half of that: a
 * `mutationKey` that drifts from `briefQueryKey` compiles, and so does a
 * `find()` that never matches. What it buys is the thing `OverviewTab` needs —
 * a "already computed for this state" fact that survives the unmount a tab
 * switch causes, where a `useRef` did not and a failed compute paid twice.
 */
describe("useBriefComputeAttempted", () => {
  it("still answers for the state after the mount that fired it is gone", async () => {
    post.mockRejectedValue(new Error("no key configured for openrouter"));
    const { Wrapper } = wrap();
    const first = renderHook(
      () => ({
        compute: useComputeBrief("pr-1", HEAD),
        attempted: useBriefComputeAttempted("pr-1", HEAD),
      }),
      { wrapper: Wrapper },
    );

    expect(first.result.current.attempted()).toBe(false);
    first.result.current.compute.mutate();
    await waitFor(() => expect(first.result.current.compute.isError).toBe(true));
    first.unmount();

    const next = renderHook(
      () => ({
        same: useBriefComputeAttempted("pr-1", HEAD),
        otherHead: useBriefComputeAttempted("pr-1", NEXT_HEAD),
        otherPr: useBriefComputeAttempted("pr-2", HEAD),
      }),
      { wrapper: Wrapper },
    );

    expect(next.result.current.same()).toBe(true);
    // Keyed by the state, not by the PR: a new head has no brief of its own and
    // has not been computed for (AC-7).
    expect(next.result.current.otherHead()).toBe(false);
    expect(next.result.current.otherPr()).toBe(false);
  });
});

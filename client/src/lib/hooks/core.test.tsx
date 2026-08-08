import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * `useSmartDiff` — the query key and the URL, which are the two things nothing
 * else can catch.
 *
 * The key is load-bearing beyond this file: `pulls/[number]/page.tsx`
 * invalidates `["smart-diff", prId]` when a review run finishes. If the two ever
 * disagree the finding badges simply stop appearing until a manual reload, with
 * no error anywhere. Pinning the literal here is what makes that a test failure
 * rather than a bug report.
 */
const get = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { get } }));

import { useSmartDiff } from "./core";

beforeEach(() => get.mockReset().mockResolvedValue({ groups: [], split_suggestion: {} }));
afterEach(cleanup);

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("useSmartDiff", () => {
  it("requests the smart-diff route for the PR", async () => {
    const { Wrapper } = wrap();
    renderHook(() => useSmartDiff("pr-1"), { wrapper: Wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/pulls/pr-1/smart-diff"));
  });

  it("caches under the key page.tsx invalidates after a run", async () => {
    const { client, Wrapper } = wrap();
    const { result } = renderHook(() => useSmartDiff("pr-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["smart-diff", "pr-1"])).toBeDefined();
  });

  it("makes no request until a PR id is known", () => {
    // `prId` is null while the number → uuid lookup is still in flight.
    const { Wrapper } = wrap();
    renderHook(() => useSmartDiff(null), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("treats undefined the same as null", () => {
    const { Wrapper } = wrap();
    renderHook(() => useSmartDiff(undefined), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps two PRs in separate cache entries", async () => {
    const { client, Wrapper } = wrap();
    const { result } = renderHook(() => useSmartDiff("pr-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["smart-diff", "pr-2"])).toBeUndefined();
  });
});

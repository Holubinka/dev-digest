import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingPage, OnboardingRecord } from "../types";

/**
 * `useOnboardingTour` / `useGenerateOnboardingTour` — the cache key, and what
 * the generation does with it. Neither is visible to `tsc`: a key that drifts
 * between the read and the write compiles fine and leaves the screen showing
 * the old tour after a successful regeneration.
 *
 * The read answers with the page ENVELOPE, so the merge is the part worth
 * pinning: the response is only the record, and `index` and `generate_blocked`
 * have to survive it. Writing the record over the whole envelope typechecks
 * nowhere near this file — `setQueryData`'s updater is typed by the key, not by
 * the response — but it would empty the index state the header prints from.
 */
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { get, post } }));

import { onboardingQueryKey, useOnboardingTour, useGenerateOnboardingTour } from "./onboarding";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

const indexState = (sha: string) => ({
  last_indexed_sha: sha,
  files_indexed: 4210,
  files_skipped: 12,
  status: "full" as const,
});

/** A tour built from the OLD index, beside an index that has moved to the new one. */
const STALE_PAGE = {
  tour: { index_state: indexState(OLD_SHA), generated_at: "2026-08-17T09:00:00.000Z" },
  index: { ...indexState(NEW_SHA), updated_at: "2026-08-18T09:00:00.000Z" },
  stale: true,
  generate_blocked: null,
} as unknown as OnboardingPage;

const FRESH_RECORD = {
  index_state: indexState(NEW_SHA),
  generated_at: "2026-08-18T10:00:00.000Z",
} as unknown as OnboardingRecord;

beforeEach(() => {
  get.mockReset().mockResolvedValue(STALE_PAGE);
  post.mockReset().mockResolvedValue(FRESH_RECORD);
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

describe("onboardingQueryKey", () => {
  it("keys a tour by its repository and nothing narrower", () => {
    expect(onboardingQueryKey("r1")).toEqual(["onboarding", "r1"]);
    expect(onboardingQueryKey("r1")).not.toEqual(onboardingQueryKey("r2"));
  });
});

describe("useOnboardingTour", () => {
  it("reads the envelope, not the tour", async () => {
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/repos/r1/onboarding");
    // `stale` and `generate_blocked` ride on the READ, which is what lets the
    // page speak before anyone presses Generate.
    expect(result.current.data?.stale).toBe(true);
    expect(result.current.data?.index.last_indexed_sha).toBe(NEW_SHA);
  });

  it("treats a repository with no tour as data, never as an error", async () => {
    get.mockResolvedValue({ ...STALE_PAGE, tour: null, stale: false });
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tour).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("asks nothing before a repository is known", () => {
    const { Wrapper } = wrap();
    renderHook(() => useOnboardingTour(null), { wrapper: Wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useGenerateOnboardingTour", () => {
  it("merges its record into the envelope the query reads, without invalidating it", async () => {
    const { client, Wrapper } = wrap();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    // Both hooks, the way the view holds them. With `gcTime: 0` a query nobody
    // is observing is collected the moment its last observer unmounts, so a
    // `setQueryData` write is unreadable unless the read is mounted alongside
    // (`client/INSIGHTS.md:1849-1865`).
    const { result } = renderHook(
      () => ({ read: useOnboardingTour("r1"), generate: useGenerateOnboardingTour("r1") }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.read.isSuccess).toBe(true));

    result.current.generate.mutate();
    await waitFor(() => expect(result.current.generate.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith("/repos/r1/onboarding/generate");
    expect(result.current.read.data?.tour).toEqual(FRESH_RECORD);
    // The rest of the envelope survives: the response carries neither, and a
    // page that lost `index` would print an empty provenance line.
    expect(result.current.read.data?.index.last_indexed_sha).toBe(NEW_SHA);
    expect(result.current.read.data?.generate_blocked).toBeNull();
    // The staleness note the old tour earned is gone with the old tour.
    expect(result.current.read.data?.stale).toBe(false);
    // An invalidation would re-read the row that was just returned and blank
    // the page for the trip, so the read route ran exactly once.
    expect(invalidate).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when there is no envelope to merge into", async () => {
    const { client, Wrapper } = wrap();
    const { result } = renderHook(() => useGenerateOnboardingTour("r1"), { wrapper: Wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // A record is not a page. Conjuring an envelope around it would invent an
    // `index`, a `stale` and a `generate_blocked` nobody answered with.
    expect(client.getQueryData(["onboarding", "r1"])).toBeUndefined();
  });
});

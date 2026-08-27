/**
 * `useMultiRunColumnEvents` — the hook the recompute ceiling rests on.
 *
 * `SPEC-05 § Non-functional requirements` allows the results page one read on
 * open plus at most one per run that reached a terminal state. There is no timer
 * anywhere to enforce that: it holds only if `onRunClosed` fires exactly once per
 * run, so that is what is asserted here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RunEvent } from "@devdigest/shared";

const post = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({
  api: { post },
  API_BASE: "http://api.test",
}));

import { prMultiAgentKey, useMultiRunColumnEvents, useRerunMultiAgentRun } from "./multi-agent";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(kind: string, cb: (ev: MessageEvent) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), cb]);
  }
  removeEventListener() {}
  close() {
    this.closed = true;
  }
  /** Server sent a line. The fields a test does not care about are filled in
   *  because the hook parses the frame against the `RunEvent` contract — a
   *  half-written fixture is dropped exactly like a half-written event. */
  emit(event: Partial<RunEvent>) {
    this.emitRaw(
      JSON.stringify({ runId: "run-a", seq: 1, kind: "info", msg: "", t: "00.01", ...event }),
    );
  }
  /** Server sent something. Anything. */
  emitRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  /** Server closed the stream — what EventSource reports as an error. */
  end() {
    this.onerror?.();
  }
  static find(runId: string) {
    const es = FakeEventSource.instances.find((i) => i.url.includes(`/runs/${runId}/events`));
    if (!es) throw new Error(`no stream opened for ${runId}`);
    return es;
  }
}

const original = globalThis.EventSource;
beforeEach(() => {
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
});
afterEach(() => {
  globalThis.EventSource = original;
});

describe("useMultiRunColumnEvents", () => {
  it("opens one stream per run and keeps their lines apart", () => {
    const { result } = renderHook(() => useMultiRunColumnEvents(["run-a", "run-b"]));
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => {
      FakeEventSource.find("run-a").emit({ runId: "run-a", msg: "reading the diff", kind: "info" });
      FakeEventSource.find("run-b").emit({ runId: "run-b", msg: "calling the model", kind: "info" });
    });

    // `started` stays false: an ordinary line is not a claim on a slot. Only an
    // event carrying `data.status` flips it (AC-78) — the diff and the intent go
    // to every run of a multi-run while all of them are still queued.
    expect(result.current["run-a"]).toEqual({
      lastMsg: "reading the diff",
      started: false,
      closed: false,
    });
    expect(result.current["run-b"]).toEqual({
      lastMsg: "calling the model",
      started: false,
      closed: false,
    });
  });

  /**
   * `liveColumns` (`MultiRunView/helpers.ts`) promotes a column the instant
   * this flips, so the latch itself has to be pinned at its source: only an
   * event carrying `data.status === "running"` may set it, and once set a
   * later line that carries nothing must not clear it (AC-78).
   */
  it("latches `started` on an event announcing the run took a slot, and keeps it through a later plain line", () => {
    const { result } = renderHook(() => useMultiRunColumnEvents(["run-a"]));

    act(() => {
      FakeEventSource.find("run-a").emit({
        runId: "run-a",
        msg: "starting",
        data: { status: "running" },
      });
    });
    expect(result.current["run-a"]).toEqual({ lastMsg: "starting", started: true, closed: false });

    act(() => {
      FakeEventSource.find("run-a").emit({ runId: "run-a", msg: "still going" });
    });
    expect(result.current["run-a"]).toEqual({
      lastMsg: "still going",
      started: true,
      closed: false,
    });
  });

  /**
   * Attribution is by `RunEvent.runId`, not by the socket the line arrived on.
   * The two agree today; keying off the payload is what stops a shared bus from
   * painting a line into the wrong column tomorrow.
   */
  it("files a line under the run the EVENT names", () => {
    const { result } = renderHook(() => useMultiRunColumnEvents(["run-a", "run-b"]));

    act(() => {
      FakeEventSource.find("run-a").emit({ runId: "run-b", msg: "belongs to b", kind: "info" });
    });

    expect(result.current["run-b"]?.lastMsg).toBe("belongs to b");
    expect(result.current["run-a"]?.lastMsg).toBeNull();
  });

  it("reports each run closed exactly once, however often its stream errors", () => {
    const onRunClosed = vi.fn();
    const { result } = renderHook(() => useMultiRunColumnEvents(["run-a", "run-b"], onRunClosed));

    act(() => {
      FakeEventSource.find("run-a").end();
      FakeEventSource.find("run-a").end();
      FakeEventSource.find("run-a").end();
    });

    expect(onRunClosed).toHaveBeenCalledTimes(1);
    expect(onRunClosed).toHaveBeenCalledWith("run-a");
    expect(result.current["run-a"]?.closed).toBe(true);
    expect(result.current["run-b"]?.closed).toBe(false);

    act(() => FakeEventSource.find("run-b").end());
    expect(onRunClosed).toHaveBeenCalledTimes(2);
  });

  /**
   * A queued run gets a stream too — `failAll` and `runOneAgent` both end with
   * `runBus.complete(runId)` — so a run that never started still closes, and the
   * page still gets its one refetch for it.
   */
  it("reports a run that never sent a line", () => {
    const onRunClosed = vi.fn();
    renderHook(() => useMultiRunColumnEvents(["run-queued"], onRunClosed));

    act(() => FakeEventSource.find("run-queued").end());

    expect(onRunClosed).toHaveBeenCalledWith("run-queued");
  });

  it("does not re-subscribe when the caller passes a fresh callback each render", () => {
    const { rerender } = renderHook(() => useMultiRunColumnEvents(["run-a"], () => {}));
    rerender();
    rerender();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes every socket when the page unmounts", () => {
    const { unmount } = renderHook(() => useMultiRunColumnEvents(["run-a", "run-b"]));
    unmount();
    expect(FakeEventSource.instances.map((i) => i.closed)).toEqual([true, true]);
  });

  it("opens nothing when there is no run to follow", () => {
    const { result } = renderHook(() => useMultiRunColumnEvents([]));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current).toEqual({});
  });

  /**
   * The frame is PARSED against `RunEvent`, not asserted into it. `msg` lands in
   * a column header and `runId` decides which header, so a frame of another
   * shape has to stop at this boundary — an assertion would have written a
   * number into the header and a line into a column nobody was looking at.
   */
  it("drops a frame that is not a RunEvent", () => {
    const { result } = renderHook(() => useMultiRunColumnEvents(["run-a"]));

    act(() => {
      const es = FakeEventSource.find("run-a");
      es.emitRaw(JSON.stringify({ runId: "run-a", msg: 42, kind: "info", seq: 1, t: "00.01" }));
      es.emitRaw(JSON.stringify({ runId: "run-a", msg: "no seq, no clock" }));
      es.emitRaw("keepalive");
    });

    expect(result.current["run-a"]?.lastMsg).toBeNull();

    act(() => FakeEventSource.find("run-a").emit({ runId: "run-a", msg: "a real one" }));
    expect(result.current["run-a"]?.lastMsg).toBe("a real one");
  });
});

/**
 * A rerun makes a NEW multi-run for the same PR, so the PR page's "way back to
 * the comparison" link — read under `prMultiAgentKey` — is wrong the moment this
 * resolves. `useCreateMultiAgentRun` has always invalidated it; the rerun path
 * did not, and it is the path that navigates away, so the stale link is what the
 * reader meets on returning to the PR.
 */
describe("useRerunMultiAgentRun", () => {
  beforeEach(() => post.mockReset().mockResolvedValue({ id: "mr-2", pr_id: "pr-1", runs: [], skipped: [] }));
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

  it("invalidates the PR's multi-agent link", async () => {
    const { client, Wrapper } = wrap();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRerunMultiAgentRun(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ multiRunId: "mr-1", prId: "pr-1" });
    });

    expect(post).toHaveBeenCalledWith("/multi-agent-runs/mr-1/rerun");
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: prMultiAgentKey("pr-1") }),
    );
  });

  it("invalidates nothing when the PR is not known yet", async () => {
    const { client, Wrapper } = wrap();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRerunMultiAgentRun(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ multiRunId: "mr-1", prId: null });
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});

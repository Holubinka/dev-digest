/**
 * `useMultiRunColumnEvents` — the hook the recompute ceiling rests on.
 *
 * `SPEC-05 § Non-functional requirements` allows the results page one read on
 * open plus at most one per run that reached a terminal state. There is no timer
 * anywhere to enforce that: it holds only if `onRunClosed` fires exactly once per
 * run, so that is what is asserted here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RunEvent } from "@devdigest/shared";
import { useMultiRunColumnEvents } from "./multi-agent";

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
  /** Server sent a line. */
  emit(event: Partial<RunEvent>) {
    const ev = { data: JSON.stringify(event) } as MessageEvent;
    this.onmessage?.(ev);
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
});

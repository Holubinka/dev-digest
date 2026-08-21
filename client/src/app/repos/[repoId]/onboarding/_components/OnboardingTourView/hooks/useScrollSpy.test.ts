/**
 * The scrollspy's three rules, each asserted where it can fail on its own:
 * the LAST section in the band wins, a section that left it stops counting,
 * and the fragment the reader clicked outranks both while its own section is
 * still there.
 *
 * jsdom has no `IntersectionObserver`, so every test here drives a fake one
 * (`src/test/intersection-observer.ts`) rather than installing a silent stub —
 * a stub that never calls its callback leaves the hook returning `null`, which
 * is what it returns when it is deleted.
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  installIntersectionObserver,
  type FakeIntersectionObserver,
} from "@/test/intersection-observer";
import { useScrollSpy } from "./useScrollSpy";

const ANCHORS = ["architecture", "critical-paths", "how-to-run"] as const;

let io: FakeIntersectionObserver;

const mount = (ids: readonly string[] = ANCHORS) => {
  for (const id of ids) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
  io = installIntersectionObserver();
};

const spy = (preferred: string | null = null, enabled = true) =>
  renderHook(
    (props: { preferred: string | null; enabled: boolean }) =>
      useScrollSpy(ANCHORS, props.preferred, props.enabled),
    { initialProps: { preferred, enabled } },
  );

afterEach(() => {
  io?.restore();
  document.body.innerHTML = "";
});

describe("useScrollSpy", () => {
  it("says nothing until the observer does, so the caller keeps what the URL said", () => {
    mount();
    const { result } = spy();

    expect(io.observedIds()).toEqual([...ANCHORS]);
    expect(result.current).toBeNull();
  });

  it("marks the last section in the band, which is the one whose heading just arrived", () => {
    mount();
    const { result } = spy();

    io.report(["architecture", "critical-paths"]);

    expect(result.current).toBe("critical-paths");
  });

  it("stops counting a section that scrolled out of the band", () => {
    mount();
    const { result } = spy();

    io.report(["architecture", "critical-paths"]);
    io.report(["architecture"]);

    expect(result.current).toBe("architecture");
  });

  it("keeps the reader's own fragment marked while its section is in the band, and no longer", () => {
    mount();
    const { result } = spy("architecture");

    // Both are in the band — the clicked one and the card below it. Without
    // the preference the rail would jump off the entry that was just pressed.
    io.report(["architecture", "critical-paths"]);
    expect(result.current).toBe("architecture");

    // Scrolled past it: the URL is a preference, not a lock.
    io.report(["critical-paths", "how-to-run"]);
    expect(result.current).toBe("how-to-run");
  });

  it("observes nothing until the sections are on the page", () => {
    mount();
    const { result, rerender } = spy(null, false);

    expect(io.observedIds()).toEqual([]);
    expect(result.current).toBeNull();

    rerender({ preferred: null, enabled: true });
    io.report(["how-to-run"]);
    expect(result.current).toBe("how-to-run");
  });

  it("skips an anchor with no element and disconnects when the page goes", () => {
    mount(["architecture", "how-to-run"]);
    const { unmount } = spy();

    expect(io.observedIds()).toEqual(["architecture", "how-to-run"]);

    unmount();
    expect(io.observedIds()).toEqual([]);
  });
});

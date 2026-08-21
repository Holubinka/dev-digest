import { act } from "@testing-library/react";

/**
 * A controllable `IntersectionObserver` for jsdom, which ships none at all —
 * `typeof IntersectionObserver === "undefined"` there, the way `ResizeObserver`
 * was until `src/test/setup.ts` stubbed it.
 *
 * Deliberately NOT installed globally in the setup file. A no-op stub that
 * never calls its callback makes every scrollspy assertion pass for the wrong
 * reason: the rail keeps whatever the URL said, and a test that asserts exactly
 * that is green with the observer deleted. So the fake is installed per test
 * file and DRIVEN — `report()` is the scroll, and the assertions are about what
 * the component does with it.
 *
 * `report()` emits an entry for every observed target, not only the ones that
 * changed. A real observer delivers only changes, so a consumer that keeps a
 * set must handle both directions; scrolling back up (`report` with fewer ids)
 * is what tests the removal half.
 */
interface Instance {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  targets: Set<Element>;
  disconnected: boolean;
}

export interface FakeIntersectionObserver {
  /** Every instance constructed since install, in construction order. */
  readonly instances: readonly Instance[];
  /** The ids currently observed, across every live instance. */
  observedIds(): string[];
  /** Deliver a state where exactly these ids intersect and the rest do not. */
  report(intersectingIds: string[]): void;
  restore(): void;
}

export function installIntersectionObserver(): FakeIntersectionObserver {
  const instances: Instance[] = [];
  const previous = globalThis.IntersectionObserver;

  class Fake implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds: readonly number[] = [0];
    #self: Instance;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? "0px";
      this.#self = { callback, options, targets: new Set(), disconnected: false };
      instances.push(this.#self);
    }

    observe(target: Element) {
      this.#self.targets.add(target);
    }
    unobserve(target: Element) {
      this.#self.targets.delete(target);
    }
    disconnect() {
      this.#self.targets.clear();
      this.#self.disconnected = true;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  globalThis.IntersectionObserver = Fake as unknown as typeof IntersectionObserver;

  const live = () => instances.filter((i) => !i.disconnected);

  return {
    instances,
    observedIds: () =>
      live().flatMap((instance) => [...instance.targets].map((target) => target.id)),
    report(intersectingIds: string[]) {
      act(() => {
        for (const instance of live()) {
          const entries = [...instance.targets].map(
            (target) =>
              ({
                target,
                isIntersecting: intersectingIds.includes(target.id),
                intersectionRatio: intersectingIds.includes(target.id) ? 1 : 0,
              }) as unknown as IntersectionObserverEntry,
          );
          if (entries.length > 0) {
            instance.callback(entries, {} as IntersectionObserver);
          }
        }
      });
    },
    restore() {
      globalThis.IntersectionObserver = previous;
    },
  };
}

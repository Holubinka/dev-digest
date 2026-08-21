/**
 * FirstTasksSection — the cards, the control one of them carries, and the URL
 * that decides which window is open.
 *
 * THE NAVIGATION MOCK IS REACTIVE ON PURPOSE. The open task is derived from
 * `?task=` during render and is held nowhere else, so a `useRouter().replace`
 * that only records its argument would leave the section drawing the same thing
 * forever and no test here could open anything. `replace` therefore rewrites the
 * search params the way Next does and re-renders the tree, which is what makes
 * "click, then Esc, then focus is back on the title" one assertion about the real
 * loop rather than three about its pieces.
 *
 * `fireEvent`, not `userEvent`, which is not a dependency here
 * (`client/INSIGHTS.md`). Every query inside the window is scoped with
 * `within(screen.getByRole("dialog"))`: the card and the window draw the same
 * title and the same path.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingTask, OnboardingTaskComplexity } from "@/lib/types";
import { FirstTasksSection } from "./FirstTasksSection";

/* Opening the window must cost nothing: the details were generated in the tour's
   own single model call and saved with it (AC-10, AC-11). The check is
   structural — reaching for any export of the tour's data hooks throws, so a
   `useOnboardingTour()` added to this subtree later fails this file rather than
   quietly issuing a request on every click. */
vi.mock("@/lib/hooks/onboarding", () => {
  const forbidden = new Set([
    "useOnboardingTour",
    "useGenerateOnboardingTour",
    "onboardingQueryKey",
  ]);
  return new Proxy({} as Record<string, unknown>, {
    get: (target, prop) => {
      if (typeof prop === "string" && forbidden.has(prop)) {
        throw new Error(`the first-tasks section must reach no data hook: ${prop}`);
      }
      return Reflect.get(target, prop);
    },
  });
});

const PATHNAME = "/repos/repo-1/onboarding";
let notify: (() => void) | null = null;

const nav = {
  params: new URLSearchParams(),
  replace: vi.fn((url: string) => {
    nav.params = new URLSearchParams(new URL(url, "http://localhost").search);
    notify?.();
  }),
};

vi.mock("next/navigation", () => ({
  usePathname: () => PATHNAME,
  useSearchParams: () => nav.params,
  useRouter: () => ({ replace: nav.replace }),
}));

afterEach(cleanup);
beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.replace.mockClear();
  window.location.hash = "";
});

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";

const task = (i: number, over: Partial<OnboardingTask> = {}): OnboardingTask => ({
  title: `Task ${i}`,
  path: `src/task-${i}.ts`,
  why: `Because ${i}`,
  complexity: "low",
  steps: [{ text: `Step of ${i}`, path: null, command: null }],
  impact: `Impact ${i}`,
  verification: `Verification ${i}`,
  ...over,
});

/** The re-render Next performs after a `replace`, which the mock cannot do alone. */
function Section({
  tasks,
  indexSha = SHA,
}: {
  tasks: OnboardingTask[];
  indexSha?: string | null;
}) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    notify = force;
    return () => {
      notify = null;
    };
  }, []);
  return <FirstTasksSection tasks={tasks} repoFullName={REPO} indexSha={indexSha} />;
}

const render = (tasks: OnboardingTask[], indexSha: string | null = SHA) =>
  renderWithProviders(<Section tasks={tasks} indexSha={indexSha} />, { onboarding: messages });

/* `focus()` and then click, because jsdom moves focus on neither. A browser
   focuses a button when it is activated by keyboard or (outside Safari) by
   pointer, and that focused element is what the trap records and returns to
   (AC-14) — a `fireEvent.click` alone would leave `document.activeElement` on
   `<body>` and make the restore assertion vacuous. */
/** `noUncheckedIndexedAccess` is on: name the missing control rather than `!`. */
function at(list: HTMLElement[], index: number): HTMLElement {
  const found = list.at(index);
  if (!found) throw new Error(`the window has no focusable at ${index}`);
  return found;
}

const open = (title: string) => {
  const control = screen.getByRole("button", { name: title });
  control.focus();
  fireEvent.click(control);
  return control;
};

describe("FirstTasksSection", () => {
  it("draws every task the tour carries, with no disclosure left to press", () => {
    const { container } = render(Array.from({ length: 9 }, (_, i) => task(i + 1)));

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(9);
    expect(screen.queryByText(/more task/i)).toBeNull();
    // The section's own collapsible frame is the only <details> left on screen.
    expect(container.querySelectorAll("details")).toHaveLength(1);
  });

  it("says so when there is no task, and never renders a zero", () => {
    render([]);

    expect(screen.getByText(messages.empty.first_tasks)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: messages.section.firstTasks })).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("keeps a task whose complexity is outside the three, without a badge", () => {
    render([task(1, { complexity: "trivial" as OnboardingTaskComplexity }), task(2)]);

    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getAllByText(/complexity/i)).toHaveLength(1);
  });

  it("leaves every path as text when there is no sha", () => {
    render([task(1)], "");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/task-1.ts")).toBeInTheDocument();
  });

  it("draws the three things the design draws, and not the model's reason", () => {
    render([task(1)]);

    expect(screen.getByRole("heading", { level: 3, name: "Task 1" })).toBeInTheDocument();
    expect(screen.getByText("src/task-1.ts")).toBeInTheDocument();
    expect(screen.getByText(messages.complexity.low)).toBeInTheDocument();
    // The mockup's card has no fourth line; `why` is in the window instead.
    expect(screen.queryByText("Because 1")).toBeNull();
  });

  it("offers nothing that creates, sends or registers a task", () => {
    const { container } = render([task(1)]);

    // The page's whole claim about a task is that the file it names exists. The
    // one control is the title, and it only opens what is already saved.
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(
      Array.from(container.querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["Task 1"]);
  });

  it("opens the window of the task whose title was pressed", () => {
    render([task(1), task(2)]);

    open("Task 2");

    expect(screen.getByRole("dialog", { name: "Task 2" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Because 2")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Impact 2")).toBeInTheDocument();
  });

  it("names the open task in the URL, by path, with replace and the fragment kept", () => {
    window.location.hash = "#first-tasks";
    render([task(1)]);

    open("Task 1");

    expect(nav.replace).toHaveBeenCalledWith(
      `${PATHNAME}?task=src%2Ftask-1.ts#first-tasks`,
      { scroll: false },
    );
  });

  it("opens the window named by the URL on the first render, with nothing pressed", () => {
    nav.params = new URLSearchParams("task=src/task-2.ts");
    render([task(1), task(2)]);

    expect(screen.getByRole("dialog", { name: "Task 2" })).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("shows the tour with no window and no error when the URL names a task that is gone", () => {
    nav.params = new URLSearchParams("task=src/deleted.ts");
    render([task(1), task(2)]);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("offers no control at all on a task that carries no step", () => {
    render([task(1, { steps: [] }), task(2)]);

    expect(screen.getByRole("heading", { level: 3, name: "Task 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Task 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Task 2" })).toBeInTheDocument();
  });

  it("closes on Esc and gives focus back to the title that opened it", () => {
    render([task(1)]);
    const title = screen.getByRole("button", { name: "Task 1" });

    open("Task 1");
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(title);
    expect(nav.replace).toHaveBeenLastCalledWith(`${PATHNAME}`, { scroll: false });
  });

  it("closes from the window's own Close control, and comes back on a second press", () => {
    render([task(1)]);

    open("Task 1");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: messages.task.close }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    open("Task 1");
    expect(screen.getByRole("dialog", { name: "Task 1" })).toBeInTheDocument();
  });

  it("keeps Tab inside the window", () => {
    render([task(1, { steps: [{ text: "Run it", path: null, command: "pnpm test" }] })]);

    open("Task 1");
    const dialog = screen.getByRole("dialog");
    // The ring the trap itself walks: the task's own path link is on it too, and
    // it is the first stop in DOM order.
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button"));
    const [first, last] = [at(stops, 0), at(stops, -1)];

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("asks the server for nothing when a window is opened", async () => {
    const hooks = await import("@/lib/hooks/onboarding");
    expect(() => hooks.useOnboardingTour).toThrow();
    const fetchSpy = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      render([task(1)]);
      open("Task 1");

      expect(screen.getByRole("dialog", { name: "Task 1" })).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

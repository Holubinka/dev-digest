/**
 * TaskDetailDialog — what the window carries, and what it refuses to invent.
 *
 * Every inner query is scoped with `within(screen.getByRole("dialog"))`: the
 * window draws the task's path and the section behind it draws the same path on
 * the card, and an unscoped `getByText` cannot tell which one it found
 * (`client/INSIGHTS.md`, the two-Cancels entry). Here the section is not
 * rendered, so the scope is habit rather than necessity — and habit is the point,
 * because `FirstTasksSection.test.tsx` renders both.
 *
 * `fireEvent`, not `userEvent`, which is not a dependency here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingTask, OnboardingTaskStep } from "@/lib/types";
import { TaskDetailDialog } from "./TaskDetailDialog";

afterEach(cleanup);

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";

const step = (over: Partial<OnboardingTaskStep> = {}): OnboardingTaskStep => ({
  text: "Add the route",
  path: null,
  command: null,
  ...over,
});

const task = (over: Partial<OnboardingTask> = {}): OnboardingTask => ({
  title: "Add a readiness probe",
  path: "src/health.ts",
  why: "The deployment has no way to say it is ready",
  complexity: "low",
  steps: [step()],
  impact: "One new route and its test",
  verification: "curl localhost:3001/health answers 200",
  ...over,
});

const render = (over: Partial<OnboardingTask> = {}, onClose = () => {}) =>
  renderWithProviders(
    <TaskDetailDialog
      task={task(over)}
      repoFullName={REPO}
      indexSha={SHA}
      onClose={onClose}
    />,
    { onboarding: messages },
  );

const dialog = () => within(screen.getByRole("dialog"));

describe("TaskDetailDialog", () => {
  it("is named by the task, not by the kind of element", () => {
    render();

    expect(screen.getByRole("dialog", { name: "Add a readiness probe" })).toBeInTheDocument();
  });

  it("carries the six things the criteria list, and each one once", () => {
    render({
      steps: [step({ text: "Add the handler" }), step({ text: "Wire it into the module" })],
    });
    const d = dialog();

    expect(d.getByRole("heading", { name: "Add a readiness probe" })).toBeInTheDocument();
    expect(d.getByRole("link", { name: "src/health.ts" })).toBeInTheDocument();
    expect(d.getByText(messages.complexity.low)).toBeInTheDocument();
    expect(d.getByText("The deployment has no way to say it is ready")).toBeInTheDocument();
    expect(d.getByText("One new route and its test")).toBeInTheDocument();
    expect(d.getByText("curl localhost:3001/health answers 200")).toBeInTheDocument();

    const steps = d.getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent("Add the handler");
    expect(steps[1]).toHaveTextContent("Wire it into the module");
  });

  it("puts the steps in an ordered list, so their order is the answer's order", () => {
    render();

    expect(dialog().getByRole("list").tagName).toBe("OL");
  });

  it("draws a step's path as a link and its command as a copyable code line", () => {
    render({ steps: [step({ path: "src/routes.ts", command: "pnpm test" })] });
    const d = dialog();

    expect(d.getByRole("link", { name: "src/routes.ts" })).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${SHA}/src/routes.ts`,
    );
    expect(d.getByText("pnpm test").tagName).toBe("CODE");
    expect(d.getByRole("button", { name: "Copy the command pnpm test" })).toBeInTheDocument();
  });

  it("leaves a step with no path and no command as plain text", () => {
    render({ steps: [step({ text: "Add a guard to the error handler" })] });
    const d = dialog();

    expect(d.getByText("Add a guard to the error handler")).toBeInTheDocument();
    // The task's own path is still linked; the step contributes no second one,
    // and no <code> at all.
    expect(d.getAllByRole("link")).toHaveLength(1);
    expect(document.querySelectorAll("code")).toHaveLength(0);
  });

  it("draws no empty heading for a statement the model did not make", () => {
    render({ why: "", impact: "", verification: "", steps: [] });
    const d = dialog();

    expect(d.queryByText(messages.task.why)).toBeNull();
    expect(d.queryByText(messages.task.steps)).toBeNull();
    expect(d.queryByText(messages.task.impact)).toBeNull();
    expect(d.queryByText(messages.task.verification)).toBeNull();
    // What is left is the task itself, which always exists.
    expect(d.getByRole("heading", { name: "Add a readiness probe" })).toBeInTheDocument();
  });

  it("closes from its own control", () => {
    const onClose = vi.fn();
    render({}, onClose);

    fireEvent.click(dialog().getByRole("button", { name: messages.task.close }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The scrim is the one surface a reader can press that is inside the window's
   * own tree and outside the trap. jsdom runs none of the browser's focusing
   * steps for a pointer press, so the loss they cause is staged by hand:
   * measured in Chrome 151 on 2026-08-19 against this overlay/dialog shape, a
   * press on the scrim while a control held focus leaves
   * `document.activeElement` as `<body>`, after which neither Esc nor Tab
   * reaches the trap again. Pressing the scrim still does not close the window
   * — that divergence is deliberate — it only must not disarm the keyboard.
   */
  it("keeps Esc working after a press on the scrim", () => {
    const onClose = vi.fn();
    render({}, onClose);
    const surface = screen.getByRole("dialog");
    const scrim = surface.parentElement;
    if (!scrim) throw new Error("the window is rendered without a scrim");

    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.mouseDown(scrim);
    expect(surface.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the model's text as text, never as markup", () => {
    render({
      impact: "<img src=x onerror=alert(1)>",
      steps: [step({ text: "Open <script>alert(1)</script> and read it" })],
    });
    const d = dialog();

    expect(d.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(d.getByText("Open <script>alert(1)</script> and read it")).toBeInTheDocument();
    expect(document.querySelectorAll("img, script")).toHaveLength(0);
  });

  it("offers nothing that runs what it shows", () => {
    render({ steps: [step({ command: "pnpm dev" })] });

    // Copy and Close, and nothing that executes: the page has never had a run
    // control and this window does not add one.
    const names = dialog()
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual(["Close", "Copy the command pnpm dev"]);
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * The drawer is the shell's only piece of view state, and the one that can
 * strand a user: below 900px the sidebar is an overlay, so a nav link that
 * leaves it open covers the page it just navigated to.
 */

const nav = vi.hoisted(() => ({ pathname: "/skills" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/** The frame is the design system; this test is about what AppShell hands it. */
vi.mock("@devdigest/ui", () => ({
  AppFrame: ({
    ctx,
    children,
  }: {
    ctx: { sidebarOpen?: boolean; onToggleSidebar?: () => void };
    children: React.ReactNode;
  }) => (
    <div>
      <span data-testid="open">{String(ctx.sidebarOpen)}</span>
      <button onClick={ctx.onToggleSidebar}>toggle</button>
      {children}
    </div>
  ),
  CommandPalette: () => null,
  ShortcutsHelp: () => null,
}));

vi.mock("./hooks", () => ({
  useGlobalShortcuts: () => {},
  useShellCommands: () => [],
  useShellContext: (opts: Record<string, unknown>) => opts,
}));

import { AppShell } from "./AppShell";

beforeEach(() => {
  nav.pathname = "/skills";
});
afterEach(cleanup);

describe("AppShell drawer", () => {
  it("starts closed and opens on the toggle", () => {
    render(<AppShell>page</AppShell>);
    expect(screen.getByTestId("open")).toHaveTextContent("false");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("open")).toHaveTextContent("true");
  });

  it("closes when the route changes", () => {
    const { rerender } = render(<AppShell>page</AppShell>);
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("open")).toHaveTextContent("true");

    nav.pathname = "/agents";
    rerender(<AppShell>page</AppShell>);
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });
});

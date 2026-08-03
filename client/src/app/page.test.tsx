import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en/home.json";

const hooks = vi.hoisted(() => ({
  useRepos: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("../lib/hooks", () => ({ useRepos: hooks.useRepos }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hooks.push, replace: hooks.replace }),
}));
// The real shell mounts the command palette and the repo context, which want a
// QueryClient. The landing branches are what is under test, not the chrome.
vi.mock("../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import HomePage from "./page";

beforeEach(() => {
  hooks.useRepos.mockReset();
  hooks.push.mockReset();
  hooks.replace.mockReset();
});
afterEach(cleanup);

function mockRepos(state: Record<string, unknown>) {
  hooks.useRepos.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  });
}

/** The real `messages/en/home.json`, so the assertions below stay the copy a
    reader actually sees rather than a fixture that can drift from it. */
function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ home: messages }}>
      <HomePage />
    </NextIntlClientProvider>,
  );
}

describe("HomePage", () => {
  it("shows skeletons while the repo list loads, and commits to no other branch", () => {
    mockRepos({ isLoading: true });
    const { container } = renderHome();
    expect(container.querySelectorAll(".skeleton").length).toBe(3);
    expect(screen.queryByText("No repositories yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers to add a repository when there genuinely are none", () => {
    mockRepos({ data: [] });
    renderHome();
    expect(screen.getByText("No repositories yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add repository"));
    expect(hooks.push).toHaveBeenCalledWith("/onboarding");
  });

  /**
   * `isError` used to share the empty branch, so an unreachable API told the
   * reader their workspace was empty and invited them to import a repo they
   * already had.
   */
  it("reports a failed load as an error, not as an empty workspace", () => {
    mockRepos({ isError: true, error: new Error("boom") });
    renderHome();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your repositories")).toBeInTheDocument();
    expect(screen.queryByText("No repositories yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Add repository")).not.toBeInTheDocument();
  });

  it("retries the query from the error state", () => {
    const refetch = vi.fn();
    mockRepos({ isError: true, error: new Error("boom"), refetch });
    renderHome();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("redirects to the first repo once the list arrives", () => {
    mockRepos({ data: [{ id: "repo-1", full_name: "acme/payments-api" }] });
    renderHome();
    expect(hooks.replace).toHaveBeenCalledWith("/repos/repo-1/pulls");
    expect(screen.getByText("Open acme/payments-api")).toBeInTheDocument();
  });
});

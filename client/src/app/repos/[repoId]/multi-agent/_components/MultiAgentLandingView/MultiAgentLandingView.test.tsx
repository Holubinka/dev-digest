import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runs from "@/../messages/en/runs.json";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

const latest = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useLatestMultiAgentRun: () => latest.value,
}));
vi.mock("@/lib/repo-context", () => ({ useRepoNotFound: () => false }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));

import { MultiAgentLandingView } from "./MultiAgentLandingView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs }}>
      <MultiAgentLandingView repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.replace.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

describe("MultiAgentLandingView", () => {
  /* `null` is the answer for a repo that has never been compared, and it is an
     ABSENCE rather than an error — the empty state is the page, not a fallback
     for a failed request (AC-94). */
  it("offers Configure run when the repo has no comparison yet", () => {
    latest.value = { data: null, isLoading: false, isError: false, refetch: vi.fn() };
    renderView();

    expect(screen.getByText(runs.page.empty.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure run" }));
    expect(nav.push).toHaveBeenCalledWith("/repos/repo-1/multi-agent/configure");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  /* The address bar has to end on the comparison's own permanent link, not on a
     route whose meaning changes with the next run — so it REPLACES rather than
     pushes, and shows no empty state on the way. */
  it("replaces itself with the latest comparison's own URL", () => {
    latest.value = {
      data: { id: "mr-7", pr_id: "pr-1", pr_number: 482, ran_at: "2026-08-26T10:00:00.000Z" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderView();

    expect(nav.replace).toHaveBeenCalledWith("/repos/repo-1/multi-agent/mr-7");
    expect(screen.queryByText(runs.page.empty.title)).not.toBeInTheDocument();
  });

  it("surfaces a failed read as an error rather than as an empty repo", () => {
    latest.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      refetch: vi.fn(),
    };
    renderView();

    expect(screen.getByText(runs.page.loadFailed.title)).toBeInTheDocument();
    expect(screen.queryByText(runs.page.empty.title)).not.toBeInTheDocument();
  });
});

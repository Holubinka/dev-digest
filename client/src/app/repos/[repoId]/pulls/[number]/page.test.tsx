import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrDetail } from "@/lib/types";

/**
 * What is under test here is the PAGE's URL writing, and nothing else. Every
 * tab, the header and the shell are stand-ins: they have their own tests, and
 * rendering the real ones would make an assertion about `router.replace` depend
 * on all of them.
 *
 * The assertion that matters is a CALL COUNT. A cross-tab jump writes two query
 * keys, and writing them with two `setParam` calls looks correct in a snapshot
 * of the final URL while actually racing — each call builds its params from the
 * same captured `search`, so the last write wins and the other vanishes
 * (`client/INSIGHTS.md:585-592`).
 */
const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(""),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1", number: "12" }),
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const hooks = vi.hoisted(() => ({
  usePulls: vi.fn(),
  usePullDetail: vi.fn(),
}));

vi.mock("../../../../../lib/hooks", () => ({
  usePulls: hooks.usePulls,
  usePullDetail: hooks.usePullDetail,
}));
vi.mock("../../../../../lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div /> }));
vi.mock("./_components/PrDetailHeader", () => ({ PrDetailHeader: () => <div /> }));
vi.mock("./_components/FindingsTab", () => ({ FindingsTab: () => <div /> }));
vi.mock("./_components/RunTraceDrawer", () => ({ default: () => <div /> }));
// The two that carry the jump: one end sends a path up, the other receives it.
vi.mock("./_components/OverviewTab", () => ({
  OverviewTab: ({ onOpenFile }: { onOpenFile: (path: string) => void }) => (
    <button onClick={() => onOpenFile(TARGET)}>focus item</button>
  ),
}));
vi.mock("./_components/DiffTab", () => ({
  DiffTab: ({ targetFile }: { targetFile?: string | null }) => (
    <div data-testid="diff-tab" data-target-file={String(targetFile)} />
  ),
}));

import PRDetailPage from "./page";

const TARGET = "server/src/modules/brief/service.ts";

const PR = {
  id: "pr-1",
  number: 12,
  title: "Add the Risk Brief",
  body: null,
  status: "open",
  head_sha: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
  files_count: 1,
  files: [{ path: TARGET, additions: 210, deletions: 0, patch: null }],
  commits: [],
} as unknown as PrDetail;

beforeEach(() => {
  nav.replace.mockReset();
  nav.params = new URLSearchParams("");
  hooks.usePulls.mockReturnValue({ data: [{ number: 12, id: "pr-1" }], isLoading: false });
  hooks.usePullDetail.mockReturnValue({
    data: PR,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PRDetailPage />
    </QueryClientProvider>,
  );
}

describe("PR detail — the jump from a review-focus item to Files changed", () => {
  it("writes the tab and the file in ONE router.replace", () => {
    renderPage();
    fireEvent.click(screen.getByText("focus item"));

    // The count IS the assertion. Two `setParam` calls would also produce a URL
    // carrying `file=…` — the one that happened to be written last — and this
    // is the only thing that tells them apart.
    expect(nav.replace).toHaveBeenCalledTimes(1);

    const url = new URL(nav.replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.pathname).toBe("/repos/repo-1/pulls/12");
    expect(url.searchParams.get("tab")).toBe("diff");
    expect(url.searchParams.get("file")).toBe(TARGET);
  });

  it("hands the file in the URL to the Files changed tab as its target", () => {
    nav.params = new URLSearchParams(`tab=diff&file=${encodeURIComponent(TARGET)}`);
    renderPage();

    expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-file", TARGET);
  });

  it("passes no target when the URL names no file", () => {
    nav.params = new URLSearchParams("tab=diff");
    renderPage();

    expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-file", "null");
  });
});

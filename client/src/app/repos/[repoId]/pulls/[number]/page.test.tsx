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
  useLatestMultiAgentRunForPull: vi.fn(),
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
vi.mock("@/lib/hooks/multi-agent", () => ({
  useLatestMultiAgentRunForPull: hooks.useLatestMultiAgentRunForPull,
}));
vi.mock("../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div /> }));
// The header only has to be able to say "a run just started, here is its id" —
// the picker itself is tested next door.
vi.mock("./_components/PrDetailHeader", () => ({
  PrDetailHeader: ({
    onRunStart,
    onRunsStarted,
  }: {
    onRunStart: () => void;
    onRunsStarted: (started: { multiRunId: string; runIds: string[] }) => void;
  }) => (
    <button
      onClick={() => {
        onRunStart();
        onRunsStarted({ multiRunId: "mr-fresh", runIds: ["run-1"] });
      }}
    >
      start multi-run
    </button>
  ),
}));
// A real anchor, built from the href the PAGE resolved — the stand-in adds no
// logic of its own, so what is asserted below is the page's answer.
vi.mock("./_components/FindingsTab", () => ({
  FindingsTab: ({ multiRunHref }: { multiRunHref?: string | null }) =>
    multiRunHref ? <a href={multiRunHref}>Open the multi-agent comparison</a> : <div />,
}));
vi.mock("@/components/run-trace-drawer", () => ({ default: () => <div /> }));
// The two that carry the jump: one end sends a path up, the other receives it.
vi.mock("./_components/OverviewTab", () => ({
  OverviewTab: ({ onOpenFile }: { onOpenFile: (path: string, line?: number) => void }) => (
    <>
      <button onClick={() => onOpenFile(TARGET)}>focus item</button>
      <button onClick={() => onOpenFile(TARGET, 12)}>focus item with line</button>
    </>
  ),
}));
vi.mock("./_components/DiffTab", () => ({
  DiffTab: ({ targetFile, targetLine }: { targetFile?: string | null; targetLine?: number | null }) => (
    <div
      data-testid="diff-tab"
      data-target-file={String(targetFile)}
      data-target-line={String(targetLine)}
    />
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
  hooks.useLatestMultiAgentRunForPull.mockReturnValue({ data: null });
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
    expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-line", "null");
  });
});

describe("PR detail — the line the jump carries", () => {
  it("writes the tab, the file AND the line in ONE router.replace", () => {
    renderPage();
    fireEvent.click(screen.getByText("focus item with line"));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const url = new URL(nav.replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.get("tab")).toBe("diff");
    expect(url.searchParams.get("file")).toBe(TARGET);
    expect(url.searchParams.get("line")).toBe("12");
  });

  it("CLEARS a stale line when the next reference names none", () => {
    // Left behind, the reader would land on a line the reference they just
    // pressed never named — which is worse than not jumping at all.
    nav.params = new URLSearchParams("tab=overview&line=12");
    renderPage();
    fireEvent.click(screen.getByText("focus item"));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const url = new URL(nav.replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.get("file")).toBe(TARGET);
    expect(url.searchParams.has("line")).toBe(false);
  });

  it("hands a usable line in the URL to the Files changed tab", () => {
    nav.params = new URLSearchParams(`tab=diff&file=${encodeURIComponent(TARGET)}&line=12`);
    renderPage();

    expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-line", "12");
  });

  /**
   * `?line=` is a string someone can type. `Number.parseInt` reads the first
   * three of these as 12, 1 and 12 respectively, and it has no upper bound —
   * which is exactly why the whole string is matched against a pattern instead.
   * The jump still lands on the FILE in every case: it degrades, it does not
   * disappear.
   */
  it.each(["12abc", "1e3", " 12", "0", "-1", "99999999", "", "1.5", "0x0c", "١٢"])(
    "ignores the unusable line %j and still targets the file",
    (raw) => {
      nav.params = new URLSearchParams(
        `tab=diff&file=${encodeURIComponent(TARGET)}&line=${encodeURIComponent(raw)}`,
      );
      renderPage();

      expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-line", "null");
      expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-file", TARGET);
    },
  );

  it.each(["1", "12", "9999999"])("accepts the usable line %j", (raw) => {
    nav.params = new URLSearchParams(
      `tab=diff&file=${encodeURIComponent(TARGET)}&line=${raw}`,
    );
    renderPage();

    expect(screen.getByTestId("diff-tab")).toHaveAttribute("data-target-line", raw);
  });
});

/**
 * R54 — the link back to this PR's multi-agent comparison.
 *
 * The case that matters is the RELOAD: a reader who opens the PR tomorrow started
 * nothing in this session, so an implementation holding the id in page state (or
 * in a query parameter) shows them nothing, and a comparison that exists becomes
 * unreachable from the only page that would send anyone looking for it. AC-88
 * does not cover this — it speaks about the moment of launch.
 */
describe("PR detail — the way back to the multi-agent comparison", () => {
  const MULTI_RUN_TAB = "tab=findings";

  it("shows the link from the SERVER read alone, with no run started in this session", () => {
    hooks.useLatestMultiAgentRunForPull.mockReturnValue({
      data: { id: "mr-yesterday", pr_id: "pr-1", pr_number: 12, ran_at: "2026-08-25T10:00:00.000Z" },
    });
    nav.params = new URLSearchParams(MULTI_RUN_TAB);
    renderPage();

    expect(screen.getByRole("link", { name: /multi-agent comparison/i })).toHaveAttribute(
      "href",
      "/repos/repo-1/multi-agent/mr-yesterday",
    );
  });

  it("shows no link when the PR has never been compared", () => {
    nav.params = new URLSearchParams(MULTI_RUN_TAB);
    renderPage();

    expect(screen.queryByRole("link", { name: /multi-agent comparison/i })).toBeNull();
  });

  /**
   * Precedence. The server was asked before the new run existed, so answering
   * from it would point at the PREVIOUS comparison for as long as the invalidated
   * query takes to come back — a link that is wrong exactly when it is pressed.
   */
  it("prefers the run just started over the older one the server knows about", () => {
    hooks.useLatestMultiAgentRunForPull.mockReturnValue({
      data: { id: "mr-yesterday", pr_id: "pr-1", pr_number: 12, ran_at: "2026-08-25T10:00:00.000Z" },
    });
    nav.params = new URLSearchParams(MULTI_RUN_TAB);
    renderPage();

    fireEvent.click(screen.getByText("start multi-run"));

    expect(screen.getByRole("link", { name: /multi-agent comparison/i })).toHaveAttribute(
      "href",
      "/repos/repo-1/multi-agent/mr-fresh",
    );
  });

  /**
   * The id is NOT in the URL, and starting a run stays a single write. Two
   * `setParam` calls race — each builds from the same captured `search` — which
   * is what the page's own comment at :90-94 records.
   */
  it("writes the tab and nothing else when a run starts", () => {
    renderPage();
    fireEvent.click(screen.getByText("start multi-run"));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const url = new URL(nav.replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.get("tab")).toBe("findings");
    expect(url.searchParams.has("multiRun")).toBe(false);
    expect([...url.searchParams.keys()]).toEqual(["tab"]);
  });
});

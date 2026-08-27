/**
 * CiRunsPage — the runs ingested from other repositories' GitHub Actions.
 *
 * The two hooks are mocked at the module boundary, so each test states what the
 * server answered and asserts what the reader sees. `AppShell` is mocked away:
 * it is the nav, the command palette and the global shortcuts, none of which
 * this screen is about, and mounting it drags every hook domain into the test.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/ci.json";
import type { CiRun } from "@/lib/types";
import type { CiRunsPage as CiRunsPageData } from "@/lib/hooks/ci";

const refreshMutate = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: () => runsQuery,
  useRefreshCiRuns: () => refreshMutation,
}));

let runsQuery: {
  data: CiRunsPageData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};
let refreshMutation: {
  mutate: typeof refreshMutate;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const { CiRunsPage } = await import("./CiRunsPage");

afterEach(() => {
  cleanup();
  refreshMutate.mockClear();
});

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    id: "r1",
    ci_installation_id: "ci1",
    pr_number: 42,
    ran_at: "2026-08-26T09:00:00.000Z",
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.0412,
    github_url: "https://github.com/acme/payments-api/actions/runs/900",
    source: "ci",
    agent: "Security Reviewer",
    duration_s: 47,
    repo: "acme/payments-api",
    workflow_run_id: 900,
    head_sha: "d227ec8",
    bundle_version: "1.0.0",
    verdict: "request_changes",
    ...over,
  };
}

function renderPage({
  runs = [run()],
  lastPolled = "2026-08-26T09:05:00.000Z" as string | null,
  errors = [] as { repo: string; reason: string }[],
  isLoading = false,
  isError = false,
  refreshError = null as unknown,
}: Partial<{
  runs: CiRun[];
  lastPolled: string | null;
  errors: { repo: string; reason: string }[];
  isLoading: boolean;
  isError: boolean;
  refreshError: unknown;
}> = {}) {
  runsQuery = {
    data: isLoading ? undefined : { runs, last_polled_at: lastPolled, errors },
    isLoading,
    isError,
    error: new Error("Network down"),
    refetch: () => {},
  };
  refreshMutation = {
    mutate: refreshMutate,
    isPending: false,
    isError: refreshError != null,
    error: refreshError,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiRunsPage />
    </NextIntlClientProvider>,
  );
}

describe("CiRunsPage — the eight columns (AC-79, AC-80, AC-81)", () => {
  it("shows every value AC-79 names, and the job link leaves the app safely", () => {
    renderPage();

    for (const header of [
      "Repository",
      "Pull request",
      "Agent",
      "Verdict",
      "Findings",
      "Cost",
      "Duration",
      "Job",
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // `formatCost` scales precision to magnitude: three decimals under $1.
    expect(screen.getByText("$0.041")).toBeInTheDocument();
    expect(screen.getByText("47s")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /View/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/actions/runs/900");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a null cost as an em-dash and a real zero as a cost (AC-80)", () => {
    renderPage({ runs: [run({ id: "r1", cost_usd: null }), run({ id: "r2", cost_usd: 0 })] });

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
    // A free model genuinely cost nothing; that is not missing data.
    expect(screen.getByText("$0.0000")).toBeInTheDocument();
  });

  it("leaves the verdict cell empty for a run that produced none (AC-118)", () => {
    // An artifact from an older bundle: no verdict, no run state.
    renderPage({ runs: [run({ verdict: null, status: null, findings_count: null })] });
    expect(screen.queryByText("Request changes")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders artifact-derived text as text, never as markup (AC-77)", () => {
    renderPage({ runs: [run({ agent: "<img src=x onerror=alert(1)>" })] });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("CiRunsPage — no runs (AC-82)", () => {
  it("shows an empty state and not one invented row", () => {
    renderPage({ runs: [], lastPolled: null });

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Never polled")).toBeInTheDocument();
  });
});

describe("CiRunsPage — polling (AC-68, AC-83, AC-84)", () => {
  it("names the last successful poll", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    renderPage({ lastPolled: fiveMinutesAgo });
    expect(screen.getByText("Last polled 5m ago")).toBeInTheDocument();
  });

  it("asks for a forced poll when Refresh is pressed", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it("names a repository that could not be polled and LEAVES the rows in place (AC-83)", () => {
    renderPage({
      errors: [{ repo: "acme/billing-worker", reason: "Resource not accessible by integration" }],
    });

    const banner = screen.getByRole("alert");
    expect(within(banner).getByText("Some repositories could not be polled")).toBeInTheDocument();
    expect(
      within(banner).getByText(
        "acme/billing-worker — Resource not accessible by integration",
      ),
    ).toBeInTheDocument();

    // The whole point of AC-83: the previously fetched run is still on screen.
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View/ })).toBeInTheDocument();
  });

  it("keeps the rows when the forced refresh itself fails", () => {
    renderPage({ refreshError: new Error("Network down") });

    expect(screen.getByRole("alert")).toHaveTextContent("Network down");
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });
});

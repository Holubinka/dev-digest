/**
 * CITab — the agent's CI deployment.
 *
 * The hooks are mocked at the module boundary, so each test states what the
 * SERVER said and asserts what the reader sees. `fireEvent`, not `userEvent`:
 * `@testing-library/user-event` is not a dependency of this package
 * (`client/INSIGHTS.md`).
 *
 * `@/lib/hooks/ci` is mocked ONCE with every export the rendered tree needs —
 * CITab reads `useCiInstallations`, and the wizard it can open reads the other
 * two. A second `vi.mock` for the same module would replace this factory rather
 * than merge with it (`client/INSIGHTS.md`).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "@/../messages/en/ci.json";
import type { CiInstallationListItem } from "@/lib/types";

const updateAgent = vi.fn();

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => saveMutation,
}));
vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => installsQuery,
  useExportCi: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useDownloadCiZip: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: REPOS, reposLoaded: true, activeRepo: REPOS[0] }),
}));

/** The workspace the wizard's Target step selects from. Hoisted so the factory
 *  above can close over it — `vi.mock` factories run before the module body. */
const REPOS = vi.hoisted(() =>
  ["acme/payments-api", "acme/billing-worker"].map((full_name, i) => ({
    id: `r${i + 1}`,
    workspace_id: "w1",
    owner: full_name.split("/")[0]!,
    name: full_name.split("/")[1]!,
    full_name,
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  })),
);

// Assigned per test, read by the factories above.
let installsQuery: {
  data: CiInstallationListItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};
let saveMutation: {
  mutate: typeof updateAgent;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  variables?: { id: string; patch: { ci_fail_on?: string } };
};

const { CITab } = await import("./CITab");

afterEach(() => {
  cleanup();
  updateAgent.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function install(over: Partial<CiInstallationListItem> = {}): CiInstallationListItem {
  return {
    id: "ci1",
    agent_id: "ag1",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-08-20T10:00:00.000Z",
    agent_version: 3,
    last_run_status: "succeeded",
    last_run_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    stale: false,
    // The default is the CONFIRMED installation: the last poll found this
    // agent's workflow in the repository, so `unconfirmed_reason` is null and
    // the row counts towards "Active in N repos" (AC-85).
    workflow_path: ".github/workflows/devdigest-review-security-reviewer.yml",
    unconfirmed_reason: null,
    observed_agent: null,
    ...over,
  };
}

function renderTab({
  agent = AGENT,
  installs = [install()],
  isLoading = false,
  isError = false,
  save = {},
}: Partial<{
  agent: Agent;
  installs: CiInstallationListItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  save: Partial<typeof saveMutation>;
}> = {}) {
  installsQuery = {
    data: installs,
    isLoading,
    isError,
    error: new Error("403 Forbidden"),
    refetch: () => {},
  };
  saveMutation = {
    mutate: updateAgent,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    ...save,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CITab agent={agent} />
    </NextIntlClientProvider>,
  );
}

describe("CITab — no installations (AC-2, AC-3)", () => {
  it("offers exactly one action, and it opens the wizard on Target", () => {
    renderTab({ installs: [] });

    expect(screen.getByText("Not in CI yet")).toBeInTheDocument();
    // One action, so no Fail CI on control and no repository rows.
    expect(screen.queryByRole("button", { name: "Critical" })).toBeNull();
    expect(screen.queryByText("Add repository")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add to CI" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Export to CI")).toBeInTheDocument();
    // Step 1 of the wizard: the four target cards.
    expect(within(dialog).getByText("GitHub Actions")).toBeInTheDocument();
  });
});

describe("CITab — the Fail CI on control (AC-87, AC-88, AC-94, AC-101, AC-102)", () => {
  it("offers exactly three options, highlights the stored one and saves the click", () => {
    renderTab();

    const options = ["Critical", "Warning +", "Never"];
    for (const label of options) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // No fourth button offering `any`.
    expect(screen.queryByRole("button", { name: /^any$/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Critical" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Warning +" }));
    expect(updateAgent).toHaveBeenCalledWith({ id: "ag1", patch: { ci_fail_on: "warning" } });
  });

  it("names a stored `any` and highlights none of the three (AC-102)", () => {
    renderTab({ agent: { ...AGENT, ci_fail_on: "any" } });

    expect(screen.getByText("Current value: any")).toBeInTheDocument();
    for (const label of ["Critical", "Warning +", "Never"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("reverts to the stored value and names the cause when the save fails (AC-94)", () => {
    // The save was for `never`; it failed, so the control must still read the
    // value the database holds.
    renderTab({
      save: {
        isError: true,
        error: new Error("Agent is read-only"),
        variables: { id: "ag1", patch: { ci_fail_on: "never" } },
      },
    });

    expect(screen.getByRole("button", { name: "Critical" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Never" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save: Agent is read-only");
  });

  it("confirms a save that succeeded (AC-88)", () => {
    renderTab({ save: { isSuccess: true } });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("explains that the change reaches CI only after a republish (AC-89)", () => {
    renderTab();
    expect(screen.getByText(/only after the bundle is republished/)).toBeInTheDocument();
  });
});

describe("CITab — the installation rows (AC-85, AC-86, AC-90, AC-91)", () => {
  it("counts the confirmed installations in the badge and shows repo, target, status and age", () => {
    renderTab({ installs: [install(), install({ id: "ci2", repo: "acme/billing-worker" })] });

    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getAllByText("GitHub Actions")).toHaveLength(2);
    // The catalogue is the contract: the badge shows the LABEL, never the
    // column value the API sends.
    expect(screen.getAllByText("Succeeded")).toHaveLength(2);
    expect(screen.getAllByText("4m ago")).toHaveLength(2);
  });

  it("marks an installation deployed from an older agent version, naming both numbers", () => {
    // `stale` is the server's comparison; the row states what it compared.
    renderTab({ installs: [install({ agent_version: 1, stale: true })] });

    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText("deployed from v1, current is v3")).toBeInTheDocument();
  });

  it("opens the wizard prefilled with THAT row's repository (AC-91)", () => {
    renderTab({
      installs: [install(), install({ id: "ci2", repo: "acme/billing-worker", stale: true })],
    });

    fireEvent.click(screen.getByLabelText("Update CI config for acme/billing-worker"));
    const dialog = screen.getByRole("dialog");
    // The wizard opened on the repo the row named, not the first installation.
    expect(within(dialog).getByText(/acme\/billing-worker already runs this agent/)).toBeInTheDocument();
  });

  it("says a repository has no runs rather than inventing a status", () => {
    renderTab({ installs: [install({ last_run_status: null, last_run_at: null })] });
    expect(screen.getByText("no runs yet")).toBeInTheDocument();
    expect(screen.queryByText("Succeeded")).toBeNull();
  });
});


describe("CITab — installations that cannot be confirmed (AC-85, AC-147, AC-148, AC-149)", () => {
  const WORKFLOW = ".github/workflows/devdigest-review-security-reviewer.yml";

  it("keeps a repo whose workflow Actions cannot find out of the badge, and names the file", () => {
    // TWO ROWS, ONE BADGE OF ONE. This is the whole point of AC-85's rewrite:
    // the second row exists in `ci_installations` and its file does not exist in
    // the repository, which is exactly the state the old "count the rows" badge
    // reported as two active agents.
    renderTab({
      installs: [
        install(),
        install({ id: "ci2", repo: "acme/billing-worker", unconfirmed_reason: "workflow_missing" }),
      ],
    });

    expect(screen.getByText("Active in 1 repo")).toBeInTheDocument();
    expect(screen.getByText("not confirmed")).toBeInTheDocument();
    // AC-147: the expected path, so the reader can go and look for it.
    const path = screen.getByText(WORKFLOW);
    expect(path.parentElement).toHaveTextContent("GitHub Actions has no");
  });

  it("does not claim a never-polled installation is running (AC-148)", () => {
    // Published a moment ago and never polled since: nothing is known, so
    // nothing is asserted — and the badge counts none of it.
    renderTab({
      installs: [install({ last_run_status: null, last_run_at: null, unconfirmed_reason: "never_polled" })],
    });

    expect(screen.getByText("Active in 0 repos")).toBeInTheDocument();
    expect(screen.getByText("not confirmed")).toBeInTheDocument();
    expect(screen.getByText(WORKFLOW).parentElement).toHaveTextContent("Not checked yet");
  });

  it("names the agent the file really runs (AC-149)", () => {
    renderTab({
      installs: [
        install({ unconfirmed_reason: "other_agent", observed_agent: "general-reviewer" }),
      ],
    });

    expect(screen.getByText("Active in 0 repos")).toBeInTheDocument();
    expect(screen.getByText("not confirmed")).toBeInTheDocument();
    // The agent NAMED, not just "someone else": it is what tells the reader
    // which of their agents overwrote this one.
    expect(screen.getByText(WORKFLOW).parentElement).toHaveTextContent(
      "is running general-reviewer, not this agent",
    );
  });
});

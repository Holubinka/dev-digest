import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runs from "@/../messages/en/runs.json";
import prReview from "@/../messages/en/prReview.json";

/* Configure run as a reader uses it: pick a PR, see the agents, watch the CTA
   and the estimate follow the ticks. The arithmetic itself is pinned in
   `helpers.test.ts` — what is asserted here is that the screen asks for the
   right numbers and gates the run on the right two things. */

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(""),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.params,
}));

const data = vi.hoisted(() => ({
  pulls: [] as unknown[],
  agents: [] as unknown[],
  lastRuns: [] as unknown[],
  create: { mutate: vi.fn(), isPending: false, isError: false, error: null },
}));
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => ({ data: data.pulls }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: data.agents }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useLastSuccessfulRuns: () => ({ data: data.lastRuns }),
  useCreateMultiAgentRun: () => data.create,
}));
vi.mock("@/lib/repo-context", () => ({ useRepoNotFound: () => false }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));

import { ConfigureRunView } from "./ConfigureRunView";

const OPEN_PR = {
  id: "pr-482",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  status: "open",
};
const MERGED_PR = { id: "pr-401", number: 401, title: "Cache the price book", status: "merged" };

const SECURITY = {
  id: "a1",
  name: "Security",
  description: "Secrets, injection and auth mistakes.",
  enabled: true,
};
const PERF = { id: "a2", name: "Performance", description: "N+1 queries.", enabled: true };
const RETIRED = { id: "a3", name: "Architecture", description: "", enabled: false };

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs, prReview }}>
      <ConfigureRunView repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.replace.mockReset();
  nav.push.mockReset();
  nav.params = new URLSearchParams("");
  data.pulls = [OPEN_PR, MERGED_PR];
  data.agents = [SECURITY, PERF, RETIRED];
  data.lastRuns = [
    { agent_id: "a1", duration_ms: 8200, cost_usd: 0.06, ran_at: "2026-08-26T10:00:00.000Z" },
    { agent_id: "a2", duration_ms: 7400, cost_usd: null, ran_at: "2026-08-26T10:00:00.000Z" },
  ];
  data.create.mutate.mockReset();
  // The mutation calls back with what the server created; the view is what turns
  // that into the address of the new comparison.
  data.create.mutate.mockImplementation(
    (_vars: unknown, opts?: { onSuccess?: (d: { id: string }) => void }) =>
      opts?.onSuccess?.({ id: "mr-9" }),
  );
});
afterEach(cleanup);

describe("ConfigureRunView — step 1", () => {
  it("asks for a PR before anything else, and keeps the run disabled until there is one", () => {
    renderView();

    expect(screen.getByText("Run a Multi-Agent Review")).toBeInTheDocument();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    // No agent list yet — the cards are what the empty state replaces (AC-2).
    expect(screen.queryByText("Security")).not.toBeInTheDocument();

    // The label still follows the ticks, and the button is disabled whatever it
    // says (AC-3) — exactly what `…-configure-empty.png` draws.
    const cta = screen.getByRole("button", { name: /Run multi-agent review/ });
    expect(cta).toBeDisabled();
  });

  it("lists every PR including a merged one, and picking one writes ?pr", () => {
    renderView();

    fireEvent.click(screen.getByText("Select a pull request…"));
    expect(screen.getByText(/#482 · Add rate limiting/)).toBeInTheDocument();
    // AC-4: a merged PR is listed, and its state is said out loud rather than
    // being hidden the way `screen.jsx:113` hides `stale`.
    const merged = screen.getByText(/#401 · Cache the price book · merged/);

    fireEvent.click(merged);
    expect(nav.replace).toHaveBeenCalledWith("/repos/repo-1/multi-agent/configure?pr=pr-401");
  });

  it("warns without blocking on a merged PR, in the PR page's own words (AC-5)", () => {
    nav.params = new URLSearchParams("pr=pr-401");
    renderView();

    expect(screen.getByText(prReview.runReview.mergedWarning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run multi-agent review/ })).toBeEnabled();
  });

  it("says so when the repository has no PRs at all (AC-6)", () => {
    data.pulls = [];
    renderView();

    fireEvent.click(screen.getByText("Select a pull request…"));
    expect(screen.getByText(runs.page.configure.noPulls)).toBeInTheDocument();
  });
});

describe("ConfigureRunView — step 2", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams("pr=pr-482");
  });

  it("shows one card per agent with its DESCRIPTION, pre-ticking the enabled ones", () => {
    renderView();

    // AC-7: the description, not a past run's summary — the mockup's second line
    // was resolved against the spec by the human on 2026-08-26.
    expect(screen.getByText("Secrets, injection and auth mistakes.")).toBeInTheDocument();

    const ticks = screen.getAllByRole("checkbox");
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toBeChecked();
    expect(ticks[1]).toBeChecked();
    // AC-8/AC-9: the disabled agent is marked, unticked, and still selectable.
    expect(ticks[2]).not.toBeChecked();
    expect(screen.getByText("disabled")).toBeInTheDocument();

    fireEvent.click(ticks[2]!);
    expect(screen.getAllByRole("checkbox")[2]).toBeChecked();
  });

  it("flips Select all to Clear all and back, over the ENABLED agents (AC-10, AC-11)", () => {
    renderView();

    // Two of three are ticked by default, and those two ARE every enabled agent.
    expect(screen.getByText("Clear all")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear all"));
    expect(screen.getAllByRole("checkbox").some((c) => c.getAttribute("aria-checked") === "true")).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Select agents" })).toBeDisabled();

    fireEvent.click(screen.getByText("Select all"));
    const after = screen.getAllByRole("checkbox");
    expect(after[0]).toBeChecked();
    expect(after[1]).toBeChecked();
    expect(after[2]).not.toBeChecked();
  });

  it("moves the CTA through its three labels as the count changes (AC-13…AC-15)", () => {
    renderView();

    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeEnabled();

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByRole("button", { name: "Run 1 agent" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByRole("button", { name: "Select agents" })).toBeDisabled();
  });

  it("estimates from the chosen agents and says who is missing from a sum", () => {
    renderView();

    /* max(8.2s, 7.4s) and 0.06 alone: Performance has no cost on record, and it
       still counts toward the time (AC-17, AC-18, AC-21). Three decimals is
       `formatCost`'s own rule — precision scaled to magnitude — and reusing it
       is what stops this screen and the PR list from disagreeing to the digit;
       the mockup prints two. */
    expect(screen.getByText(/≈ 8\.2s · \$0\.060 · in-process fan-out/)).toBeInTheDocument();
    expect(screen.getByText("1 agent not in the cost estimate")).toBeInTheDocument();
    expect(screen.queryByText(/not in the time estimate/)).not.toBeInTheDocument();

    // Ticking the agent with no measured run at all pulls it out of both (AC-20, AC-22).
    fireEvent.click(screen.getAllByRole("checkbox")[2]!);
    expect(screen.getByText("1 agent not in the time estimate")).toBeInTheDocument();
    expect(screen.getByText("2 agents not in the cost estimate")).toBeInTheDocument();
  });

  it("shows an em dash, never a zero, when nothing was ever measured (AC-23)", () => {
    data.lastRuns = [];
    renderView();

    expect(screen.getByText(/≈ — · — · in-process fan-out/)).toBeInTheDocument();
  });

  it("sends the chosen set and moves to the comparison it created", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));

    expect(data.create.mutate).toHaveBeenCalledWith(
      { prId: "pr-482", agentIds: ["a1", "a2"] },
      expect.anything(),
    );
    expect(nav.push).toHaveBeenCalledWith("/repos/repo-1/multi-agent/mr-9");
  });

  it("sends people to the agents screen when the workspace has none (AC-12)", () => {
    data.agents = [];
    renderView();

    expect(screen.getByText(runs.page.configure.noAgents.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(nav.push).toHaveBeenCalledWith("/agents");
  });
});

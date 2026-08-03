import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import agentMessages from "../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";
import { ApiError } from "../../../../../lib/api";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const shell = vi.hoisted(() => ({ crumb: [] as Array<{ label: string }> }));
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb: Array<{ label: string }>; children: React.ReactNode }) => {
    shell.crumb = crumb;
    return <div>{children}</div>;
  },
}));

/** The view reaches this module relatively and SkillsTab through `@/`; both
    resolve to the same file, so one mock covers the whole tree. */
const hooks = vi.hoisted(() => ({ useAgent: vi.fn(), useAgents: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: hooks.useAgent,
  useAgents: hooks.useAgents,
  useUpdateAgent: () => ({ mutate: hooks.update, isPending: false, isSuccess: false }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [] }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({ useSkills: () => ({ data: [] }) }));

import { AgentEditorView } from "./AgentEditorView";

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "Reviews the tests, not the code",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You review tests.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: false,
  enabled: true,
  version: 1,
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentMessages, skills: skillMessages }}>
      <ToastProvider>
        <AgentEditorView id="ag1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
  shell.crumb = [];
  hooks.useAgents.mockReturnValue({ data: [AGENT] });
  hooks.useAgent.mockReturnValue({ data: AGENT, isLoading: false, isError: false });
});
afterEach(cleanup);

describe("AgentEditorView", () => {
  it("heads the pane with the agent and the model it runs on", () => {
    renderView();
    expect(screen.getAllByText("Test Quality Reviewer").length).toBeGreaterThan(0);
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
  });

  it("names the open agent in the breadcrumb", () => {
    renderView();
    expect(shell.crumb.map((c) => c.label)).toEqual([
      "Skills Lab",
      "Agents",
      "Test Quality Reviewer",
    ]);
  });

  /** The tab belongs in the URL, and switching must not drop whatever else
      the query string carries. */
  it("keeps the open tab in the URL", () => {
    renderView();
    fireEvent.click(screen.getByText("Skills"));
    expect(nav.replace).toHaveBeenCalledWith("/agents/ag1?tab=skills");
  });

  it("falls back to Config when ?tab= names something that does not exist", () => {
    nav.params = new URLSearchParams("tab=nonsense");
    renderView();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("opens the tab the URL asks for", () => {
    nav.params = new URLSearchParams("tab=skills");
    renderView();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });

  it("shows why it failed rather than an empty editor", () => {
    hooks.useAgent.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("No such agent", 404, "not_found"),
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText("No such agent")).toBeInTheDocument();
  });
});

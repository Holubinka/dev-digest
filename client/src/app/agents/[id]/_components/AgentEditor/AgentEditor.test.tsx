import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
// ConfigTab reaches this module relatively and SkillsTab through `@/`; both
// resolve to the same file, so one mock covers both tabs.
const setSkills = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [{ agent_id: "ag1", skill_id: "sk1", order: 0 }] }),
  useSetAgentSkills: () => ({ mutate: setSkills, isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [skill({ id: "sk1", name: "uncovered-branch-rubric", description: "", version: 1, agent_count: 1 })],
  }),
}));

import { AgentEditor } from "./AgentEditor";
import { skill } from "../../../../../test/skills";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  /** The tab dispatch is the only thing making the per-agent Skills tab
      reachable; SkillsTab's own test mounts it directly and cannot see this. */
  it("renders the Skills tab instead of Config when the URL asks for it", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    expect(screen.getByText("uncovered-branch-rubric")).toBeInTheDocument();
  });

  it("offers both tabs whichever one is open", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    // The tab and the pane's own heading both read "Skills".
    expect(screen.getAllByText("Skills").length).toBeGreaterThan(0);
  });

  it("reports the tab change rather than routing itself", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getAllByText("Skills")[0]!);
    expect(onTab).toHaveBeenCalledWith("skills");
  });
});

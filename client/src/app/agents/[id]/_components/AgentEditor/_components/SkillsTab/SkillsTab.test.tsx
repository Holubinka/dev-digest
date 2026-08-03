import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, SkillListItem } from "@devdigest/shared";
import agentMessages from "../../../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../../../messages/en/skills.json";

const hooks = vi.hoisted(() => ({
  useSkills: vi.fn(),
  useAgentSkills: vi.fn(),
  setSkills: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/skills", () => ({ useSkills: hooks.useSkills }));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkills: hooks.useAgentSkills,
  useSetAgentSkills: () => ({ mutate: hooks.setSkills, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

const AGENT = { id: "ag1", name: "Test Quality Reviewer" } as Agent;

const skill = (id: string, over: Partial<SkillListItem> = {}): SkillListItem => ({
  id,
  name: id,
  description: "",
  type: "rubric",
  source: "manual",
  body: "#",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 1,
  injection: [],
  ...over,
});

const ALL = [skill("alpha"), skill("beta"), skill("gamma")];
const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "alpha", order: 0 },
  { agent_id: "ag1", skill_id: "beta", order: 1 },
];

beforeEach(() => {
  hooks.setSkills.mockReset();
  hooks.useSkills.mockReturnValue({ data: ALL });
  hooks.useAgentSkills.mockReturnValue({ data: LINKS });
});
afterEach(cleanup);

function renderTab() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agents: agentMessages, skills: skillMessages }}
    >
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

/**
 * Drag is not exercised: jsdom has no DataTransfer. The arrows call the same
 * `moveAt` and commit the same request, so covering them covers the behaviour.
 */
describe("SkillsTab", () => {
  it("lists every skill in one list, bound first, and counts what is on", () => {
    renderTab();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
    // One flat list: bound in prompt order, then the rest.
    const names = screen.getAllByText(/^(alpha|beta|gamma)$/).map((n) => n.textContent);
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  it("only offers reordering on the rows that are actually bound", () => {
    renderTab();
    expect(screen.getAllByLabelText("Move up")).toHaveLength(2);
    expect(screen.getAllByLabelText("Move down")).toHaveLength(2);
  });

  it("refuses to bind a skill whose body trips the injection detector", () => {
    hooks.useSkills.mockReturnValue({
      data: [
        skill("alpha"),
        skill("beta"),
        skill("gamma", {
          injection: [
            { rule: "override_instructions", reason: "Tries to cancel", line: 2, excerpt: "x" },
          ],
        }),
      ],
    });
    renderTab();
    expect(screen.getByText("injection — cannot be used")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox").at(-1)!);
    expect(hooks.setSkills, "a flagged skill must not become bindable").not.toHaveBeenCalled();
  });

  it("moving a skill down sends the whole set in the new order", () => {
    renderTab();
    fireEvent.click(screen.getAllByLabelText("Move down")[0]!);
    expect(hooks.setSkills).toHaveBeenCalledWith({
      agentId: "ag1",
      skillIds: ["beta", "alpha"],
    });
  });

  it("the first row cannot move up, and the last cannot move down", () => {
    renderTab();
    expect(screen.getAllByLabelText("Move up")[0]).toBeDisabled();
    expect(screen.getAllByLabelText("Move down")[1]).toBeDisabled();
  });

  it("unticking a bound skill sends the set without it", () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(hooks.setSkills).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["beta"] });
  });

  it("ticking an available skill appends it, so it lands last in the prompt", () => {
    renderTab();
    const gammaBox = screen.getAllByRole("checkbox").at(-1)!;
    fireEvent.click(gammaBox);
    expect(hooks.setSkills).toHaveBeenCalledWith({
      agentId: "ag1",
      skillIds: ["alpha", "beta", "gamma"],
    });
  });

  it("warns that a globally-disabled skill will not reach the model", () => {
    hooks.useSkills.mockReturnValue({
      data: [skill("alpha", { enabled: false }), skill("beta"), skill("gamma")],
    });
    renderTab();
    expect(screen.getByText("disabled — will not enter the prompt")).toBeInTheDocument();
  });

  it("says what to do when the workspace has no skills at all", () => {
    hooks.useSkills.mockReturnValue({ data: [] });
    hooks.useAgentSkills.mockReturnValue({ data: [] });
    renderTab();
    expect(screen.getByText("No skills yet. Create one in the Skills Lab.")).toBeInTheDocument();
  });
});

describe("SkillsTab when the data does not arrive", () => {
  it("says the load failed instead of claiming the agent has no skills", () => {
    hooks.useSkills.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() });
    hooks.useAgentSkills.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("Could not load the skills for this agent.")).toBeInTheDocument();
    expect(screen.queryByText(/No skills yet/)).not.toBeInTheDocument();
  });

  it("retries both queries, since either one can be the one that failed", () => {
    const refetchSkills = vi.fn();
    const refetchLinks = vi.fn();
    hooks.useSkills.mockReturnValue({ data: undefined, isError: true, refetch: refetchSkills });
    hooks.useAgentSkills.mockReturnValue({ data: LINKS, isError: false, refetch: refetchLinks });
    renderTab();

    fireEvent.click(screen.getByText("Retry"));
    expect(refetchSkills).toHaveBeenCalled();
    expect(refetchLinks).toHaveBeenCalled();
  });

  it("does not flash the empty state while the first request is in flight", () => {
    hooks.useSkills.mockReturnValue({ data: undefined, isLoading: true });
    hooks.useAgentSkills.mockReturnValue({ data: undefined, isLoading: true });
    renderTab();
    expect(screen.queryByText(/No skills yet/)).not.toBeInTheDocument();
  });

  it("still says so when the workspace genuinely has none", () => {
    hooks.useSkills.mockReturnValue({ data: [], isLoading: false, isError: false });
    hooks.useAgentSkills.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderTab();
    expect(screen.getByText(/No skills yet/)).toBeInTheDocument();
  });
});


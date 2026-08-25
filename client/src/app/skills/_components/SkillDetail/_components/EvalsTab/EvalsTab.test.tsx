import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import type { SkillEvalCaseRow, SkillEvalCaseSet } from "@/lib/types";
import messages from "../../../../../../../messages/en/skills.json";

const hooks = vi.hoisted(() => ({ useSkillEvalCases: vi.fn() }));
vi.mock("@/lib/hooks/eval", () => ({ useSkillEvalCases: hooks.useSkillEvalCases }));

import { EvalsTab } from "./EvalsTab";

const SKILL = { id: "sk1", name: "attack-surface-inventory" } as Skill;

const row = (over: Partial<SkillEvalCaseRow> = {}): SkillEvalCaseRow => ({
  id: "c1",
  name: "stripe-key-leak",
  owner_kind: "agent",
  owner_id: "ag1",
  agent_name: "Security Reviewer",
  notes: null,
  expected_count: 1,
  last_run: {
    ran_at: "2026-08-23T09:14:00.000Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    findings_count: 1,
    skills: [{ id: "sk1", name: "attack-surface-inventory" }],
  },
  ...over,
});

function renderTab(data: SkillEvalCaseSet | undefined, rest: Record<string, unknown> = {}) {
  hooks.useSkillEvalCases.mockReturnValue({ data, isLoading: false, isError: false, ...rest });
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <EvalsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => hooks.useSkillEvalCases.mockReset());
afterEach(cleanup);

describe("EvalsTab (skill) — the reciprocal of the agent's own tab", () => {
  it("lists a case with its agent name, pass mark and the passing badge", () => {
    renderTab({ cases: [row()], passing: 1, total: 1 });
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 passing")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 1")).toBeInTheDocument();
    expect(screen.getByLabelText("passed")).toBeInTheDocument();
  });

  it("marks a failing case distinctly from a passing one", () => {
    renderTab({
      cases: [row({ id: "c2", last_run: { ...row().last_run!, pass: false, findings_count: 0 } })],
      passing: 0,
      total: 1,
    });
    expect(screen.getByLabelText("failed")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 0")).toBeInTheDocument();
  });

  it("links each row to that case inside its own agent's Evals tab", () => {
    renderTab({ cases: [row()], passing: 1, total: 1 });
    const link = screen.getByText("stripe-key-leak").closest("a");
    expect(link).toHaveAttribute("href", "/agents/ag1?tab=evals&case=c1");
  });

  it("explains itself when no case has this skill active yet, and shows no badge", () => {
    renderTab({ cases: [], passing: 0, total: 0 });
    expect(
      screen.getByText("No eval case has this skill active in its last run yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
  });

  it("offers a retry rather than an empty pane when the request failed", () => {
    renderTab(undefined, { isError: true, refetch: vi.fn() });
    expect(screen.getByText("Could not load this skill's eval cases.")).toBeInTheDocument();
  });
});

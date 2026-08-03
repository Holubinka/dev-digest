import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

const hooks = vi.hoisted(() => ({ useSkillStats: vi.fn() }));
vi.mock("../../../../../../lib/hooks/skills", () => ({ useSkillStats: hooks.useSkillStats }));

import { StatsTab } from "./StatsTab";

const SKILL = { id: "sk1", name: "rubric" } as Skill;

const stats = (over: Partial<SkillStats> = {}): SkillStats => ({
  agents: 2,
  runs: 9,
  findings: 14,
  accepted: 7,
  dismissed: 3,
  accept_rate: 0.7,
  body_tokens: 412,
  ...over,
});

function renderStats(data: SkillStats | undefined, rest: Record<string, unknown> = {}) {
  hooks.useSkillStats.mockReturnValue({ data, isLoading: false, isError: false, ...rest });
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => hooks.useSkillStats.mockReset());
afterEach(cleanup);

describe("StatsTab", () => {
  it("shows the counts the server actually returned", () => {
    renderStats(stats());
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("412 tok")).toBeInTheDocument();
  });

  /** The repo has been burned by demo data before: an unused skill reports
      zeros and says why, rather than a plausible-looking rate. */
  it("prints zeros and names the reason when no agent binds the skill", () => {
    renderStats(stats({ agents: 0, runs: 0, findings: 0, accepted: 0, dismissed: 0, accept_rate: null }));
    expect(
      screen.getByText("No agent binds this skill yet, so there is nothing to count."),
    ).toBeInTheDocument();
    expect(screen.getByText("nothing judged yet")).toBeInTheDocument();
  });

  it("does not invent a rate out of an empty denominator", () => {
    renderStats(stats({ accepted: 0, dismissed: 0, accept_rate: null }));
    expect(screen.getByText("nothing judged yet")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("offers a retry rather than an empty pane when the request failed", () => {
    renderStats(undefined, { isError: true, refetch: vi.fn() });
    expect(screen.getByText("Could not load the stats.")).toBeInTheDocument();
  });
});

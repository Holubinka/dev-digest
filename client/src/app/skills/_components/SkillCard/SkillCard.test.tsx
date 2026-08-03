import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillListItem } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillListItem = {
  id: "sk1",
  name: "uncovered-branch-rubric",
  description: "List every branch the diff adds and name the test covering it.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 2,
  injection: [],
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard", () => {
  it("shows the name, its type, where it came from, and who binds it", () => {
    renderWithIntl(<SkillCard sk={SKILL} />);
    expect(screen.getByText("uncovered-branch-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
  });

  it("says so plainly when no agent binds it", () => {
    renderWithIntl(<SkillCard sk={{ ...SKILL, agent_count: 0 }} />);
    expect(screen.getByText("No agents")).toBeInTheDocument();
  });

  it("labels an imported skill by where it came from", () => {
    renderWithIntl(<SkillCard sk={{ ...SKILL, source: "imported_url" }} />);
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("toggles without also selecting the card", () => {
    const onToggle = vi.fn();
    const onClick = vi.fn();
    renderWithIntl(<SkillCard sk={SKILL} onToggle={onToggle} onClick={onClick} />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick, "the toggle must not open the skill").not.toHaveBeenCalled();
  });
});

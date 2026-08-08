import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import messages from "../../../../../messages/en/skills.json";
import { skill } from "../../../../test/skills";
import { renderWithProviders } from "../../../../test/render";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL = skill();

describe("SkillCard", () => {
  it("shows the name, its type, where it came from, and who binds it", () => {
    renderWithProviders(<SkillCard sk={SKILL} />, { skills: messages });
    expect(screen.getByText("uncovered-branch-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
  });

  it("says so plainly when no agent binds it", () => {
    renderWithProviders(<SkillCard sk={{ ...SKILL, agents: 0 }} />, { skills: messages });
    expect(screen.getByText("No agents")).toBeInTheDocument();
  });

  it("labels an imported skill by where it came from", () => {
    renderWithProviders(<SkillCard sk={{ ...SKILL, source: "imported_url" }} />, { skills: messages });
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("toggles without also selecting the card", () => {
    const onToggle = vi.fn();
    const onClick = vi.fn();
    renderWithProviders(<SkillCard sk={SKILL} onToggle={onToggle} onClick={onClick} />, { skills: messages });

    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick, "the toggle must not open the skill").not.toHaveBeenCalled();
  });
});

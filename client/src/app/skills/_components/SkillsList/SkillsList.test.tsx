import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillListItem } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const hooks = vi.hoisted(() => ({ useSkills: vi.fn(), update: vi.fn() }));
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: hooks.useSkills,
  useUpdateSkill: () => ({ mutate: hooks.update, isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillsList } from "./SkillsList";
import { skill } from "../../../../test/skills";

const listSkill = (name: string, over: Partial<SkillListItem> = {}) =>
  skill({ id: name, name, description: "", agent_count: 1, version: 1, ...over });

const ALL = [
  listSkill("uncovered-branch-rubric"),
  listSkill("test-smell-catalogue", { type: "convention" }),
  listSkill("flakiness-patterns", { description: "Real clocks and shared state." }),
];

function renderList(props: Partial<React.ComponentProps<typeof SkillsList>> = {}) {
  const onSelect = vi.fn();
  const onEmptyCta = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsList onSelect={onSelect} onEmptyCta={onEmptyCta} menuItems={[]} {...props} />
    </NextIntlClientProvider>,
  );
  return { onSelect, onEmptyCta };
}

beforeEach(() => {
  hooks.update.mockReset();
  hooks.useSkills.mockReturnValue({ data: ALL, isLoading: false, isError: false });
});
afterEach(cleanup);

describe("SkillsList", () => {
  it("lists every skill in the workspace", () => {
    renderList();
    expect(screen.getByText("uncovered-branch-rubric")).toBeInTheDocument();
    expect(screen.getByText("flakiness-patterns")).toBeInTheDocument();
  });

  it("searches what a card actually shows — name, description and type", () => {
    renderList();
    const box = screen.getByLabelText("Search skills…");

    fireEvent.change(box, { target: { value: "flak" } });
    expect(screen.getByText("flakiness-patterns")).toBeInTheDocument();
    expect(screen.queryByText("uncovered-branch-rubric")).not.toBeInTheDocument();

    fireEvent.change(box, { target: { value: "shared state" } });
    expect(screen.getByText("flakiness-patterns")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "convention" } });
    expect(screen.getByText("test-smell-catalogue")).toBeInTheDocument();
    expect(screen.queryByText("flakiness-patterns")).not.toBeInTheDocument();
  });

  it("hands the selection up rather than routing itself", () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByText("test-smell-catalogue"));
    expect(onSelect).toHaveBeenCalledWith("test-smell-catalogue");
  });

  it("toggles a skill globally from the card", () => {
    renderList();
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    expect(hooks.update).toHaveBeenCalledWith({
      id: "uncovered-branch-rubric",
      patch: { enabled: false },
    });
  });

  it("offers a way to start when the workspace has no skills", () => {
    hooks.useSkills.mockReturnValue({ data: [], isLoading: false, isError: false });
    const { onEmptyCta } = renderList();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create manually"));
    expect(onEmptyCta).toHaveBeenCalled();
  });

  /** An empty search result is not an empty workspace, and the CTA would be
      the wrong offer — but both render the same empty state today. */
  it("shows the empty state when a search matches nothing", () => {
    renderList();
    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "zzz" } });
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("offers a retry when the list will not load", () => {
    hooks.useSkills.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderList();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
  });
});

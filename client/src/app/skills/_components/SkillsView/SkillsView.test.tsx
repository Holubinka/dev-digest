import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillListItem } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** The shell needs the repo context and the whole nav; this test is about the
    two columns inside it. Its crumb is asserted through what it is handed. */
const shell = vi.hoisted(() => ({ crumb: [] as Array<{ label: string }> }));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb: Array<{ label: string }>; children: React.ReactNode }) => {
    shell.crumb = crumb;
    return <div>{children}</div>;
  },
}));

const hooks = vi.hoisted(() => ({ useSkills: vi.fn(), useSkill: vi.fn() }));
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: hooks.useSkills,
  useSkill: hooks.useSkill,
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkillFile: () => ({ mutate: vi.fn(), isPending: false }),
  useImportSkillUrl: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillStats: () => ({ data: undefined, isLoading: true, isError: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillsView } from "./SkillsView";

const SKILL: SkillListItem = {
  id: "sk1",
  name: "uncovered-branch-rubric",
  description: "List every branch.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 1,
  injection: [],
};

function renderView(selectedId?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsView {...(selectedId ? { selectedId } : {})} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  shell.crumb = [];
  hooks.useSkills.mockReturnValue({ data: [SKILL], isLoading: false, isError: false });
  hooks.useSkill.mockReturnValue({ data: SKILL, isLoading: false, isError: false });
});
afterEach(cleanup);

describe("SkillsView", () => {
  it("asks for a selection when the route names no skill", () => {
    renderView();
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
    expect(screen.queryByText("Save skill")).not.toBeInTheDocument();
  });

  it("keeps the same list and opens the detail beside it once one is selected", () => {
    renderView("sk1");
    expect(screen.queryByText("Select a skill")).not.toBeInTheDocument();
    expect(screen.getByText("Save skill")).toBeInTheDocument();
    // The list is still there — the two routes differ only in the right pane.
    expect(screen.getByLabelText("Search skills…")).toBeInTheDocument();
  });

  it("routes to the skill it was told about rather than re-fetching", () => {
    renderView();
    fireEvent.click(screen.getByText("uncovered-branch-rubric"));
    expect(nav.push).toHaveBeenCalledWith("/skills/sk1?tab=config");
  });

  /** The name comes from the list query the left column already holds, so
      naming the crumb costs no second request. */
  it("names the open skill in the breadcrumb", () => {
    renderView("sk1");
    expect(shell.crumb.map((c) => c.label)).toEqual([
      "Skills Lab",
      "Skills",
      "uncovered-branch-rubric",
    ]);
  });

  it("opens the manual editor from the Add menu", () => {
    renderView();
    fireEvent.click(screen.getByText("Add Skill"));
    fireEvent.click(screen.getByText("Create manually"));
    expect(screen.getByText("Create a skill")).toBeInTheDocument();
  });

  it("opens the importer on the tab the menu item names", () => {
    renderView();
    fireEvent.click(screen.getByText("Add Skill"));
    fireEvent.click(screen.getByText("Import from URL"));
    expect(screen.getByPlaceholderText("https://example.com/skills/flakiness.md")).toBeInTheDocument();
  });
});

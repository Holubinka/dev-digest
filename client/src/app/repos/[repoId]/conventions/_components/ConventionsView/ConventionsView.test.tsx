import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { ConventionsResponse } from "@devdigest/shared";
import messages from "@/../messages/en/conventions.json";
import skillsMessages from "@/../messages/en/skills.json";
import { renderWithProviders } from "@/test/render";
import { convention } from "@/test/conventions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ repoId: "repo-1" }),
}));

/** The shell needs the whole nav and the repo context; this test is the list. */
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "Holubinka/dev-digest" } }),
  useRepoNotFound: () => false,
}));

const hooks = vi.hoisted(() => ({
  useConventions: vi.fn(),
  extract: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: hooks.useConventions,
  useExtractConventions: () => ({ mutate: hooks.extract, isPending: false }),
  useUpdateConvention: () => ({ mutate: hooks.update, isPending: false }),
}));

import { ConventionsView } from "./ConventionsView";

const SCAN: ConventionsResponse["scan"] = {
  id: "scan-1",
  repo_id: "repo-1",
  head_sha: "d227ec8",
  model: "gpt-4o-mini",
  sample_files: 14,
  candidates_returned: 9,
  candidates_kept: 3,
  created_at: "2026-08-03T12:00:00.000Z",
};

/** `skills` rides along because the merge modal reuses the skill body editor. */
function renderView() {
  return renderWithProviders(<ConventionsView repoId="repo-1" />, {
    conventions: messages,
    skills: skillsMessages,
  });
}

function loaded(candidates = [convention()], scan = SCAN) {
  hooks.useConventions.mockReturnValue({
    data: { scan, candidates },
    isLoading: false,
    isError: false,
  });
}

beforeEach(() => {
  hooks.extract.mockReset();
  hooks.update.mockReset();
  loaded();
});
afterEach(cleanup);

describe("ConventionsView", () => {
  it("names the repo and what the last scan read", () => {
    renderView();
    expect(screen.getByText("Holubinka/dev-digest")).toBeInTheDocument();
    expect(screen.getByText(/Detected from 14 sample files/)).toBeInTheDocument();
  });

  it("offers a first run before any scan exists, and a re-scan after one", () => {
    hooks.useConventions.mockReturnValue({
      data: { scan: null, candidates: [] },
      isLoading: false,
      isError: false,
    });
    renderView();
    expect(screen.getAllByRole("button", { name: "Run extraction" }).length).toBeGreaterThan(0);

    cleanup();
    loaded();
    renderView();
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeInTheDocument();
  });

  it("runs a scan on demand", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(hooks.extract).toHaveBeenCalled();
  });

  it("counts what has been accepted", () => {
    loaded([
      convention({ id: "a", status: "accepted" }),
      convention({ id: "b" }),
      convention({ id: "c", status: "rejected" }),
    ]);
    renderView();
    expect(screen.getByText("1 of 3 accepted")).toBeInTheDocument();
  });

  it("refuses to build a skill until something is accepted", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();

    cleanup();
    loaded([convention({ status: "accepted" })]);
    renderView();
    expect(screen.getByRole("button", { name: "Create skill" })).not.toBeDisabled();
  });

  it("opens the merge modal with the accepted rules in it", () => {
    loaded([convention({ status: "accepted" })]);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Merged from 1 accepted convention/)).toBeInTheDocument();
  });

  it("accepts a candidate through the card", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(hooks.update).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });
  });

  it("returns every accepted candidate to pending on deselect all", () => {
    loaded([
      convention({ id: "a", status: "accepted" }),
      convention({ id: "b", status: "accepted" }),
    ]);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));

    expect(hooks.update.mock.calls.map(([arg]) => arg)).toEqual([
      { id: "a", patch: { status: "pending" } },
      { id: "b", patch: { status: "pending" } },
    ]);
  });

  it("says so when there is nothing to show", () => {
    hooks.useConventions.mockReturnValue({
      data: { scan: null, candidates: [] },
      isLoading: false,
      isError: false,
    });
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
  });
});

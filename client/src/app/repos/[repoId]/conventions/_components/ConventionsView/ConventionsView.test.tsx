import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import type { ConventionsResponse } from "@devdigest/shared";
import messages from "@/../messages/en/conventions.json";
import skillsMessages from "@/../messages/en/skills.json";
import { ApiError } from "@/lib/api";
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
  refetch: vi.fn(),
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
    refetch: hooks.refetch,
  });
}

/** The query failed. `error` is what the view decides the body from. */
function failed(error: unknown) {
  hooks.useConventions.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    error,
    refetch: hooks.refetch,
  });
}

/** The `onError` the view handed `extract.mutate`, or a failure saying so. */
function extractOnError(): (e: unknown) => void {
  const handler = hooks.extract.mock.calls[0]?.[1]?.onError;
  expect(typeof handler, "runScan must pass the mutation an onError").toBe("function");
  return handler;
}

beforeEach(() => {
  hooks.extract.mockReset();
  hooks.update.mockReset();
  hooks.refetch.mockReset();
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

    // The banner emphasises the count and the repo, so the sentence is split
    // across elements — assert on what the dialog reads as, not on one node.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Merged from 1 accepted convention in Holubinka/dev-digest.",
    );
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

  it("offers a retry instead of a blank screen when the list fails to load", () => {
    failed(new ApiError("repo-intel has no clone for this repo yet", 409));
    renderView();

    // The server's own message is the body, so a 409 the user can act on is not
    // flattened into the generic title.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load conventions.");
    expect(alert).toHaveTextContent("repo-intel has no clone for this repo yet");
    expect(screen.queryByText("No conventions extracted yet")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(hooks.refetch).toHaveBeenCalled();
  });

  it("reports a failed extraction in a toast, with the server's message when there is one", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    act(() => extractOnError()(new ApiError("no clone to scan", 409)));

    expect(within(screen.getByRole("status")).getByText("no clone to scan")).toBeInTheDocument();

    // A transport failure carries nothing worth showing a user, so the generic
    // line stands in for it rather than leaking `socket hang up` into the UI.
    cleanup();
    hooks.extract.mockReset();
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    act(() => extractOnError()(new Error("socket hang up")));

    const toasts = screen.getByRole("status");
    expect(within(toasts).getByText("Extraction failed")).toBeInTheDocument();
    expect(within(toasts).queryByText("socket hang up")).not.toBeInTheDocument();
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

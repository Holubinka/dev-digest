/**
 * ContextDocList — the kind badge (AC-10) and the preview control (AC-53/54).
 *
 * `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
 * dependency of this project (client/INSIGHTS.md), and the other 40-odd test
 * files here are written the same way.
 *
 * `useContextDoc` is mocked at the module boundary, so a test states what the
 * SERVER said about one document and asserts what the reader sees — the whole
 * point of the preview being that it renders text nobody has attached yet.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ApiError } from "@/lib/api";
import type { AttachedContextDoc, SpecFile } from "@/lib/types";
import messages from "../../../messages/en/context.json";

vi.mock("@/lib/hooks/context", () => ({ useContextDoc: () => docQuery }));

// Assigned per test, read by the mock above.
let docQuery: {
  data: SpecFile | undefined;
  error: unknown;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
};

const { ContextDocList } = await import("./ContextDocList");

afterEach(cleanup);

const doc = (path: string, kind: SpecFile["kind"]): SpecFile => ({
  path,
  content: null,
  size: 120,
  updated_at: null,
  root: path.split("/")[0]!,
  kind,
  tokens: 40,
  used_by_agents: 0,
});

const DOCS = [
  doc("specs/public-api.md", "specs"),
  doc("docs/architecture.md", "docs"),
  doc("insights/perf-budget.md", "insights"),
];

const READ = (content: string): typeof docQuery => ({
  data: { ...doc("docs/architecture.md", "docs"), content },
  error: null,
  isError: false,
  isSuccess: true,
  refetch: () => {},
});

const FAILED = (code: string): typeof docQuery => ({
  data: undefined,
  error: new ApiError("nope", 404, code),
  isError: true,
  isSuccess: false,
  refetch: () => {},
});

function renderList({
  scanned = DOCS,
  attached = [
    { path: "specs/public-api.md", position: 0, tokens: 40, missing: false },
  ] as AttachedContextDoc[],
  onCommit = vi.fn(),
  disabled = false,
  read = READ("# Architecture\n\nHow the pieces fit together."),
} = {}) {
  docQuery = read;
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocList
        repoId="repo-1"
        scanned={scanned}
        attached={attached}
        disabled={disabled}
        onCommit={onCommit}
      />
    </NextIntlClientProvider>,
  );
  return { onCommit };
}

const row = (path: string) => screen.getByTitle(path).closest("div")!;

describe("ContextDocList — the kind badge", () => {
  it("badges EVERY row with its own kind, attached or not", () => {
    renderList();
    // AC-10 since the first increment, and no row had ever rendered one.
    expect(within(row("specs/public-api.md")).getByText("specs")).toBeInTheDocument();
    expect(within(row("docs/architecture.md")).getByText("docs")).toBeInTheDocument();
    expect(within(row("insights/perf-budget.md")).getByText("insights")).toBeInTheDocument();
  });

  it("puts the badge in the right-hand group, immediately before Preview", () => {
    // Design screens 2 and 3. `within(row)` alone cannot see this: the badge is
    // inside the row wherever in it it sits, so an assertion that only looks it
    // up by text stays green through the move it was meant to pin.
    renderList();
    for (const [path, kind] of [
      ["specs/public-api.md", "specs"],
      ["docs/architecture.md", "docs"],
      ["insights/perf-budget.md", "insights"],
    ]) {
      const badge = within(row(path!)).getByText(kind!);
      const preview = within(row(path!)).getByLabelText(`Preview ${path}`);
      expect(badge.nextElementSibling).toBe(preview);
      expect(badge.parentElement).toBe(preview.parentElement);
    }
  });

  it("gives no kind to a saved path the scan no longer holds, but still previews it", () => {
    renderList({
      scanned: [doc("specs/public-api.md", "specs")],
      attached: [{ path: "docs/gone.md", position: 0, tokens: null, missing: true }],
      read: FAILED("doc_missing"),
    });
    const gone = row("docs/gone.md");
    expect(within(gone).getByText("not in the clone")).toBeInTheDocument();
    // Nobody has classified this document: there is no scan row behind it.
    for (const kind of ["specs", "docs", "insights", "other"]) {
      expect(within(gone).queryByText(kind)).toBeNull();
    }

    fireEvent.click(within(gone).getByLabelText("Preview docs/gone.md"));
    // The reason, in the run's own word, instead of a blank pane.
    expect(
      screen.getByText("missing — this document is not in the clone"),
    ).toBeInTheDocument();
  });
});

describe("ContextDocList — reordering while a save is in flight", () => {
  const TWO = [
    { path: "specs/public-api.md", position: 0, tokens: 40, missing: false },
    { path: "docs/architecture.md", position: 1, tokens: 40, missing: false },
  ] as AttachedContextDoc[];

  it("moves an attached document with the arrows when nothing is in flight", () => {
    const { onCommit } = renderList({ attached: TWO });
    fireEvent.click(within(row("specs/public-api.md")).getByLabelText("Move down"));
    expect(onCommit).toHaveBeenCalledWith(["docs/architecture.md", "specs/public-api.md"]);
  });

  /**
   * `disabled` is `save.isPending` in both callers, and there is no optimistic
   * update: until the response lands the row still renders at index 0, so a
   * second click recomputes the SAME move, sends an identical PUT, and the
   * user's second move is silently lost. The checkbox and the drag handle have
   * always honoured `disabled`; the arrows are the keyboard path to the same
   * action and must honour it too.
   */
  it("takes no reorder from the arrows while a save is in flight", () => {
    const { onCommit } = renderList({ attached: TWO, disabled: true });

    const down = within(row("specs/public-api.md")).getByLabelText("Move down");
    const up = within(row("docs/architecture.md")).getByLabelText("Move up");
    expect(down).toBeDisabled();
    expect(up).toBeDisabled();

    fireEvent.click(down);
    fireEvent.click(up);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("ContextDocList — the preview control", () => {
  it("reads an UNATTACHED document and leaves the attachment set alone", () => {
    const { onCommit } = renderList();

    // The row that is NOT attached: deciding whether to attach it is the whole
    // reason this control exists, so a preview limited to attached documents
    // would answer the question one step too late.
    const unattached = row("docs/architecture.md");
    expect(within(unattached).getByRole("checkbox")).not.toBeChecked();

    fireEvent.click(within(unattached).getByLabelText("Preview docs/architecture.md"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(within(dialog).getByText("How the pieces fit together.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Opening and closing a preview is a read: no save, and the boxes stand.
    expect(onCommit).not.toHaveBeenCalled();
    const [first, second, third] = screen.getAllByRole("checkbox");
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
    expect(third).not.toBeChecked();
  });

  it("names the document in the control's accessible name, on every row", () => {
    renderList();
    for (const path of DOCS.map((d) => d.path)) {
      expect(screen.getByLabelText(`Preview ${path}`)).toBeInTheDocument();
    }
  });
});

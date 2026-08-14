/**
 * ContextTab — the agent's project-context attachments.
 *
 * `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
 * dependency of this project, and the rest of the suite is written the same way.
 *
 * The hooks are mocked at the module boundary rather than at `fetch`, so the
 * test states what the SERVER said and asserts what the user sees — the token
 * total above all, which is the one number the run and the editor must agree on.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "@/../messages/en/context.json";
import type { AgentContextDocs, ContextDocsPage, SpecFile } from "@/lib/types";

const save = vi.fn();
const readDoc = vi.fn();

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "repo-1" }) }));
vi.mock("@/lib/hooks/context", () => ({
  useContextDocs: () => pageQuery,
  useAgentContextDocs: () => docsQuery,
  useSetAgentContextDocs: () => ({ mutate: save, isPending: false }),
  // The preview reads one document. Mocked here rather than in a second
  // `vi.mock` for the same module: the later factory would replace this one and
  // take the two exports above with it (client/INSIGHTS.md).
  useContextDoc: (repoId: string, path: string) => {
    readDoc(repoId, path);
    return {
      data: { ...doc(path, 10), content: "# Read me" },
      error: null,
      isError: false,
      isSuccess: true,
      refetch: () => {},
    };
  },
}));

// Assigned per test, read by the mocks above.
let pageQuery: { data: ContextDocsPage | undefined; isError: boolean; refetch: () => void };
let docsQuery: { data: AgentContextDocs | undefined; isError: boolean; refetch: () => void };

const { ContextTab } = await import("./ContextTab");

afterEach(() => {
  cleanup();
  save.mockClear();
  readDoc.mockClear();
});

const doc = (path: string, tokens: number): SpecFile => ({
  path,
  content: null,
  size: 100,
  updated_at: null,
  root: path.split("/")[0]!,
  kind: "docs",
  tokens,
  used_by_agents: 0,
});

const AGENT: Agent = {
  id: "a1",
  name: "Security",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
} as unknown as Agent;

function renderTab({
  documents = [doc("docs/a.md", 100), doc("docs/b.md", 40), doc("docs/c.md", 25)],
  budget = 1000,
  attached = [{ path: "docs/a.md", position: 0, tokens: 100, missing: false }],
  inherited = [] as AgentContextDocs["inherited"],
  strategy = "single-pass",
}: Partial<{
  documents: SpecFile[];
  budget: number;
  attached: AgentContextDocs["attached"];
  inherited: AgentContextDocs["inherited"];
  strategy: string;
}> = {}) {
  pageQuery = {
    data: {
      state: "scanned",
      roots: ["docs"],
      budget_tokens: budget,
      file_count: documents.length,
      bounded: false,
      scanned_at: "2026-08-13T00:00:00.000Z",
      last_error: null,
      last_error_at: null,
      documents,
    },
    isError: false,
    refetch: () => {},
  };
  docsQuery = {
    data: { repo_id: "repo-1", attached, inherited },
    isError: false,
    refetch: () => {},
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTab agent={{ ...AGENT, strategy } as Agent} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab — the badge and the list", () => {
  it("counts OWN attachments in the badge, and lists attached documents first", () => {
    renderTab({
      attached: [
        { path: "docs/b.md", position: 0, tokens: 40, missing: false },
        { path: "docs/a.md", position: 1, tokens: 100, missing: false },
      ],
      inherited: [
        {
          path: "docs/c.md",
          tokens: 25,
          skill_id: "s1",
          skill_name: "House rules",
          also_attached: false,
        },
      ],
    });
    // 2, not 3: the inherited document has its own counter below.
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();

    const paths = screen.getAllByTitle(/^docs\//).map((el) => el.textContent);
    expect(paths.slice(0, 2)).toEqual(["docs/b.md", "docs/a.md"]);
  });

  it("saves the whole ordered array when a box is ticked", () => {
    renderTab();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]!); // docs/b.md — the first unattached row
    expect(save).toHaveBeenCalledWith({
      agentId: "a1",
      repoId: "repo-1",
      paths: ["docs/a.md", "docs/b.md"],
    });
  });

  it("moves a document with the arrow keys — the keyboard path for reordering", () => {
    renderTab({
      attached: [
        { path: "docs/a.md", position: 0, tokens: 100, missing: false },
        { path: "docs/b.md", position: 1, tokens: 40, missing: false },
      ],
    });
    fireEvent.click(screen.getAllByLabelText("Move up")[1]!);
    expect(save).toHaveBeenCalledWith({
      agentId: "a1",
      repoId: "repo-1",
      paths: ["docs/b.md", "docs/a.md"],
    });
  });

  it("passes the ACTIVE repository down, so a preview asks for THIS repo's document", () => {
    // The prop is typed on both sides; only a render proves it is actually
    // passed — a preview that asked for `undefined/…` would typecheck.
    renderTab({
      inherited: [
        {
          path: "docs/skill-only.md",
          tokens: 25,
          skill_id: "s1",
          skill_name: "House rules",
          also_attached: false,
        },
      ],
    });

    fireEvent.click(screen.getByLabelText("Preview docs/b.md"));
    expect(readDoc).toHaveBeenCalledWith("repo-1", "docs/b.md");
    fireEvent.click(screen.getByLabelText("Close"));

    // And from the read-only inherited group, which passes it too.
    fireEvent.click(screen.getByLabelText("Preview docs/skill-only.md"));
    expect(readDoc).toHaveBeenCalledWith("repo-1", "docs/skill-only.md");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps an attachment whose file left the clone, and marks it", () => {
    renderTab({
      documents: [doc("docs/a.md", 100)],
      attached: [{ path: "docs/gone.md", position: 0, tokens: null, missing: true }],
    });
    expect(screen.getByTitle("docs/gone.md")).toBeInTheDocument();
    expect(screen.getByText("not in the clone")).toBeInTheDocument();
  });
});

describe("ContextTab — the inherited group", () => {
  const inherited: AgentContextDocs["inherited"] = [
    {
      path: "docs/shared.md",
      tokens: 60,
      skill_id: "s1",
      skill_name: "House rules",
      also_attached: true,
    },
    {
      path: "docs/only-skill.md",
      tokens: 30,
      skill_id: "s1",
      skill_name: "House rules",
      also_attached: false,
    },
  ];

  it("is read-only: no checkbox and no drag handle on an inherited row", () => {
    renderTab({
      documents: [doc("docs/shared.md", 60)],
      attached: [{ path: "docs/shared.md", position: 0, tokens: 60, missing: false }],
      inherited,
    });
    // One editable row → one checkbox. The two inherited rows add none.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    const row = screen.getByText("docs/only-skill.md").closest("div")!;
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).queryByLabelText("Move up")).toBeNull();
    expect(within(row).queryByLabelText("Move down")).toBeNull();
  });

  it("names the source skill on every row, and marks one the agent already attaches", () => {
    renderTab({
      documents: [doc("docs/shared.md", 60)],
      attached: [{ path: "docs/shared.md", position: 0, tokens: 60, missing: false }],
      inherited,
    });
    expect(screen.getAllByText("from House rules")).toHaveLength(2);
    expect(screen.getByText("already attached")).toBeInTheDocument();
    expect(screen.getByText("2 inherited")).toBeInTheDocument();
  });
});

describe("ContextTab — the budget footer", () => {
  it("sums own + inherited AFTER dedupe, so a shared document counts once", () => {
    renderTab({
      documents: [doc("docs/shared.md", 60), doc("docs/only-skill.md", 30)],
      attached: [{ path: "docs/shared.md", position: 0, tokens: 60, missing: false }],
      inherited: [
        {
          path: "docs/shared.md",
          tokens: 60,
          skill_id: "s1",
          skill_name: "House rules",
          also_attached: true,
        },
        {
          path: "docs/only-skill.md",
          tokens: 30,
          skill_id: "s1",
          skill_name: "House rules",
          also_attached: false,
        },
      ],
    });
    // 90, not 150: `docs/shared.md` is sent once, so it is counted once.
    expect(screen.getByText("≈ 90 tokens")).toBeInTheDocument();
    expect(screen.queryByText("≈ 150 tokens")).toBeNull();
  });

  it("uses the SERVER's token counts, not a local ceil(length/4) estimate", () => {
    // 777 is not derivable from any string on this page — it can only have come
    // from the `tokens` field the server sent. That is the whole of AC-20: the
    // editor's figure has to be the counter the run measures the budget with.
    renderTab({
      documents: [doc("docs/a.md", 777)],
      attached: [{ path: "docs/a.md", position: 0, tokens: 777, missing: false }],
    });
    // Scoped to the footer — the row shows the same number, and the assertion
    // that matters is the TOTAL.
    const footer = screen.getByText("of 1000").parentElement!;
    expect(within(footer).getByText("≈ 777 tokens")).toBeInTheDocument();
  });

  it("warns with the overage when the effective set is over budget, and does not disable anything", () => {
    renderTab({
      documents: [doc("docs/a.md", 100)],
      budget: 60,
      attached: [{ path: "docs/a.md", position: 0, tokens: 100, missing: false }],
    });
    expect(screen.getByText(/Over budget by 40 tokens/)).toBeInTheDocument();
    // Saving stays available: over budget is a decision, not an error.
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeDisabled();
  });

  it("trips the warning on INHERITED documents alone", () => {
    renderTab({
      documents: [doc("docs/only-skill.md", 500)],
      budget: 100,
      attached: [],
      inherited: [
        {
          path: "docs/only-skill.md",
          tokens: 500,
          skill_id: "s1",
          skill_name: "House rules",
          also_attached: false,
        },
      ],
    });
    expect(screen.getByText(/Over budget by 400 tokens/)).toBeInTheDocument();
  });

  it("states the per-prompt rule for a non-single-pass agent, and names no total", () => {
    renderTab({ strategy: "map-reduce" });
    const note = screen.getByText(/Counted once per prompt/);
    expect(note).toHaveTextContent("map-reduce");
    expect(note).toHaveTextContent("assembled again for every changed file");
    // No product against an imagined PR: the editor knows no pull request.
    expect(note.textContent).not.toMatch(/\d+\s*(files|×|x)\s*\d+/);
  });

  it("says nothing about chunking for a single-pass agent", () => {
    renderTab({ strategy: "single-pass" });
    expect(screen.queryByText(/Counted once per prompt/)).toBeNull();
  });
});

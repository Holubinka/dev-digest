/**
 * ProjectContextView — the four scan states, the grouped list, the write
 * controls, and the two things a document from an imported public repository
 * must not be able to do.
 *
 * `fireEvent`, not `userEvent`: the latter is not a dependency of this project.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MAX_DOC_CHARS } from "@devdigest/shared";
import messages from "@/../messages/en/context.json";
import { ApiError } from "@/lib/api";
import type { ContextDocsPage, SpecFile } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => new URLSearchParams(selectedDoc ? `doc=${selectedDoc}` : ""),
  useParams: () => ({ repoId: "repo-1" }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/repo-context", () => ({
  useRepoNotFound: () => false,
  useActiveRepo: () => ({ activeRepo: { default_branch: "main" } }),
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextDocs: () => pageQuery,
  useRescanContextDocs: () => ({ mutate: rescanMutate, isPending: false }),
  useContextDoc: () => docQuery,
  useCreateContextDoc: () => ({ mutateAsync: createMutate, isPending: false }),
  useUploadContextDoc: () => ({ mutateAsync: uploadMutate, isPending: false }),
  useCreateContextFolder: () => ({ mutateAsync: folderMutate, isPending: false }),
  useSaveContextDoc: () => ({ mutateAsync: saveMutate, isPending: false }),
}));

let pageQuery: { data: ContextDocsPage | undefined; isError: boolean; refetch: () => void };
let docQuery: {
  data: SpecFile | undefined;
  isError: boolean;
  error?: unknown;
  refetch: () => void;
};
let selectedDoc: string | null = null;
const rescanMutate = vi.fn();
const createMutate = vi.fn(async () => {});
const uploadMutate = vi.fn(async () => {});
const folderMutate = vi.fn(async () => {});
const saveMutate = vi.fn(async () => {});

const { ProjectContextView } = await import("./ProjectContextView");

afterEach(() => {
  cleanup();
  selectedDoc = null;
  rescanMutate.mockClear();
  createMutate.mockClear();
  uploadMutate.mockClear();
  folderMutate.mockClear();
  saveMutate.mockClear();
});

const doc = (
  path: string,
  kind: SpecFile["kind"] = "docs",
  usedBy = 0,
  root = path.split("/")[0]!,
  extra: Partial<SpecFile> = {},
): SpecFile => ({
  path,
  content: null,
  size: 100,
  updated_at: null,
  root,
  kind,
  tokens: 10,
  used_by_agents: usedBy,
  ...extra,
});

function renderView(
  page: Partial<ContextDocsPage>,
  content?: string,
  selected?: SpecFile,
  readError?: unknown,
) {
  pageQuery = {
    data: {
      state: "scanned",
      roots: ["specs", "docs", "insights"],
      budget_tokens: 16000,
      file_count: 0,
      bounded: false,
      scanned_at: null,
      last_error: null,
      last_error_at: null,
      documents: [],
      ...page,
    },
    isError: false,
    refetch: () => {},
  };
  docQuery = {
    data: content === undefined ? undefined : { ...(selected ?? doc("docs/a.md")), content },
    isError: readError !== undefined,
    error: readError,
    refetch: () => {},
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView — the four states, none masking another", () => {
  it("no_clone shows the clone-preparing state with a retry, never an empty list", () => {
    renderView({ state: "no_clone" });
    expect(screen.getByText("Preparing the clone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // Not the "no documents found" state, which would blame the repository.
    expect(screen.queryByText("No .md documents found")).toBeNull();
  });

  /**
   * R25: the write controls are UNAVAILABLE with the clone-preparing
   * explanation, not absent and not answering with a write error. A control that
   * vanishes tells the user nothing about why.
   */
  it("no_clone disables all four controls and says why", () => {
    renderView({ state: "no_clone" });
    for (const name of ["New document", "New folder", "Upload .md", "Rescan"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText(/still preparing the clone of this repository/)).toBeInTheDocument();
  });

  it("scanning shows its own state, naming the roots being searched", () => {
    renderView({ state: "scanning" });
    expect(screen.getByText("Scanning the clone")).toBeInTheDocument();
    expect(screen.getByText(/specs, docs, insights/)).toBeInTheDocument();
    expect(screen.queryByText("Preparing the clone")).toBeNull();
    expect(screen.queryByText("No .md documents found")).toBeNull();
  });

  /**
   * `scanning` is the state a stranded claim can sit in for up to ten minutes —
   * the job queue is in-memory and nothing recovers it on boot — and the server
   * documents Rescan as the retry for exactly that row. A button disabled by the
   * state is a retry that is absent whenever it is needed.
   */
  it("keeps Rescan reachable while a scan is in flight", () => {
    renderView({ state: "scanning" });
    const rescan = screen.getByRole("button", { name: "Rescan" });
    expect(rescan).toBeEnabled();
    fireEvent.click(rescan);
    expect(rescanMutate).toHaveBeenCalledWith("repo-1");
  });

  it("scanned with nothing found names the roots that were searched", () => {
    renderView({ state: "scanned", file_count: 0, scanned_at: "2026-08-13T00:00:00.000Z" });
    expect(screen.getByText("No .md documents found")).toBeInTheDocument();
    expect(screen.getByText(/Nothing under specs, docs, insights/)).toBeInTheDocument();
    expect(screen.queryByText("Preparing the clone")).toBeNull();
    // The footer is still there: 0 documents, and when they were counted.
    expect(screen.getByText("0 documents")).toBeInTheDocument();
  });

  it("failed keeps the previous result and shows the failed attempt beside it", () => {
    renderView({
      state: "failed",
      documents: [doc("docs/a.md")],
      file_count: 3,
      scanned_at: "2026-08-12T00:00:00.000Z",
      last_error: "clone path vanished",
      last_error_at: "2026-08-13T00:00:00.000Z",
    });
    expect(screen.getByText(/The last scan failed/)).toBeInTheDocument();
    // The previous result is NOT replaced.
    expect(screen.getByTitle("docs/a.md")).toBeInTheDocument();
    expect(screen.getByText("3 documents")).toBeInTheDocument();
    expect(screen.getByText(/Last attempt failed/)).toBeInTheDocument();
  });
});

describe("ProjectContextView — the list, grouped by root", () => {
  const GROUPED = {
    state: "scanned" as const,
    file_count: 4,
    scanned_at: "2026-08-13T00:00:00.000Z",
    roots: ["docs", "docs/adr", ".devdigest"],
    documents: [
      doc("docs/architecture.md", "docs", 0, "docs"),
      doc("docs/adr/0001-choice.md", "docs", 0, "docs/adr"),
      doc(".devdigest/specs/public-api.md", "specs", 2, ".devdigest"),
      doc(".devdigest/notes.md", "other", 0, ".devdigest"),
    ],
  };

  it("prints each root once as a group header and each row relative to it", () => {
    renderView(GROUPED);

    // One header per DISTINCT root, not one per document.
    expect(screen.getAllByTitle(/^Found under the/)).toHaveLength(3);
    expect(screen.getAllByText(".devdigest")).toHaveLength(1);

    // A row carries the path BELOW its group's root — never the root again, and
    // never the whole path, which is what made a document in `docs/` read
    // "docs · docs/architecture.md · docs".
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("0001-choice.md")).toBeInTheDocument();
    expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
    expect(screen.queryByText("docs/architecture.md")).toBeNull();
    expect(screen.queryByText("docs/adr/0001-choice.md")).toBeNull();

    // The nested root claims its document exactly once: `docs/adr/0001.md` is
    // NOT also a row of the `docs` group.
    expect(screen.getAllByTitle("docs/adr/0001-choice.md")).toHaveLength(1);
  });

  it("badges the kind on the group when the root decides it, and on the row when it cannot", () => {
    renderView(GROUPED);

    // `.devdigest` is a container: the segment below it names the kind, so its
    // two documents differ and the header cannot speak for both.
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();

    // An ordinary root labels all of its documents, so the badge is on the
    // header and the rows carry nothing but their name.
    const docsHeader = screen.getByTitle("Found under the docs root").parentElement!;
    expect(docsHeader).toHaveTextContent("docs");
    expect(screen.getByTitle("docs/architecture.md")).toHaveTextContent(/^architecture\.md$/);
  });

  /**
   * The list is a PANEL, not loose text beside the reader: the toolbar, the rows
   * and the scan footer are all inside the one bounded column. The footer used to
   * be a sibling of `.dd-context-panes` and stretched under both of them.
   */
  it("keeps the toolbar, the rows and the footer inside the one list panel", () => {
    renderView(GROUPED);

    const panel = screen.getByTitle("docs/architecture.md").closest(".dd-context-list");
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole("button", { name: "Rescan" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("4 documents");
    expect(panel).toHaveTextContent("Last scanned");
  });

  it("gives every row a document icon", () => {
    renderView(GROUPED);
    for (const path of ["docs/architecture.md", "docs/adr/0001-choice.md", ".devdigest/notes.md"]) {
      expect(screen.getByTitle(path).querySelector("svg")).toBeInTheDocument();
    }
  });

  it("marks a locally written document and one a sync erased, in the list and in the panel", () => {
    selectedDoc = "docs/a.md";
    const selected = doc("docs/a.md", "docs", 0, "docs", { stale: true });
    renderView(
      {
        state: "scanned",
        file_count: 2,
        scanned_at: "2026-08-13T00:00:00.000Z",
        roots: ["docs", ".devdigest"],
        documents: [selected, doc(".devdigest/mine.md", "other", 0, ".devdigest", { local: true })],
      },
      "text",
      selected,
    );

    // The badges are on the rows…
    expect(screen.getAllByText("Local to this machine")).toHaveLength(1);
    expect(screen.getAllByText("Erased by a sync")).toHaveLength(2); // row + panel notice

    // …and the panel explains what the badge on the selected document means.
    expect(screen.getByText(/The text shown here came from the branch/)).toBeInTheDocument();
    expect(screen.queryByText(/it is not in the repository/)).toBeNull();
  });
});

describe("ProjectContextView — the action bar is the only place this page writes", () => {
  const PAGE = {
    state: "scanned" as const,
    file_count: 1,
    scanned_at: "2026-08-13T00:00:00.000Z",
    documents: [doc("docs/a.md")],
  };

  it("offers exactly four controls, and the page carries no header of its own", () => {
    renderView(PAGE);
    for (const name of ["New document", "New folder", "Upload .md", "Rescan"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    // One rescan on the page, in the action bar — there is no second one above it.
    expect(screen.getAllByRole("button", { name: "Rescan" })).toHaveLength(1);
    // The design gives this screen no page header at all: the list panel's own
    // `PROJECT CONTEXT` label names it, and the breadcrumb carries the title.
    expect(screen.queryByRole("heading", { name: "Project Context" })).toBeNull();
  });

  it("has no rename and no delete anywhere", () => {
    renderView(PAGE);
    const names = screen
      .getAllByRole("button")
      .map((b) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`);
    expect(names.join(" ")).not.toMatch(/rename|delete|remove/i);
  });

  it("creates a document under .devdigest/ from the new-document dialog", async () => {
    renderView(PAGE);
    fireEvent.click(screen.getByRole("button", { name: "New document" }));

    const field = screen.getByRole("textbox", { name: "Path" });
    expect(field).toHaveValue(".devdigest/");
    fireEvent.change(field, { target: { value: ".devdigest/specs/new.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(createMutate).toHaveBeenCalledWith({
      repoId: "repo-1",
      path: ".devdigest/specs/new.md",
      content: "",
    });
    // The dialog closes only once the write came back: a refusal has to leave
    // the typed path on screen, because nothing else holds it.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says a new folder holds no .md rather than leaving the list unchanged", async () => {
    renderView(PAGE);
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder" }), {
      target: { value: ".devdigest/specs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(folderMutate).toHaveBeenCalledWith({ repoId: "repo-1", path: ".devdigest/specs" });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Folder created. It holds no .md yet",
    );
  });
});

describe("ProjectContextView — reading, editing, and the warning before a tracked save", () => {
  const tracked = doc("docs/a.md", "docs", 3, "docs");
  const own = doc(".devdigest/mine.md", "other", 0, ".devdigest", { local: true });

  const PAGE = {
    state: "scanned" as const,
    file_count: 2,
    scanned_at: "2026-08-13T00:00:00.000Z",
    roots: ["docs", ".devdigest"],
    documents: [tracked, own],
  };

  it("opens on Preview, with the selected document's own used-by count", () => {
    selectedDoc = "docs/a.md";
    renderView(PAGE, "# Title", tracked);

    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();

    // "Used by N agents" is the SELECTED document's, in the panel — it left the
    // list rows, where it was repeated on every one of them.
    expect(screen.getAllByText("Used by 3 agents")).toHaveLength(1);
  });

  it("warns before saving over a git-tracked document, and writes only after confirm", async () => {
    selectedDoc = "docs/a.md";
    renderView(PAGE, "old text", tracked);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The dialog names the mechanism, with this repository's default branch.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "git reset --hard origin/main",
    );
    // NOTHING has been written yet: the warning is worth nothing after the fact.
    expect(saveMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(saveMutate).toHaveBeenCalledWith({
      repoId: "repo-1",
      path: "docs/a.md",
      content: "new text",
    });
    // A saved document is read again, not left in the editor.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("cancelling the warning writes nothing and keeps the draft", () => {
    selectedDoc = "docs/a.md";
    renderView(PAGE, "old text", tracked);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The dialog's Cancel, not the editor's: both are on screen while it is open.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("new text");
  });

  it("saves a document under .devdigest/ with no warning — git does not track it", async () => {
    selectedDoc = ".devdigest/mine.md";
    renderView(PAGE, "mine", own);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "mine, edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveMutate).toHaveBeenCalledWith({
      repoId: "repo-1",
      path: ".devdigest/mine.md",
      content: "mine, edited",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  /**
   * `invalid_path` on a SAVE is not the create surface's `invalid_path`. The
   * document was opened from the list, so nobody typed a path: the only way this
   * comes back is a document whose root has left `context_scan_roots`.
   */
  it("explains a refused save in its own terms, not in the create dialog's", async () => {
    selectedDoc = ".devdigest/mine.md";
    saveMutate.mockRejectedValueOnce(new ApiError("nope", 400, "invalid_path"));
    renderView(PAGE, "mine", own);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "mine, edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not one of the scanned roots any more/);
    // Advice about a path the user never typed, for a document they opened.
    expect(alert).not.toHaveTextContent(/Use a relative path under \.devdigest\//);
    // The draft is the only copy of the text, so Edit mode stays open.
    expect(screen.getByRole("textbox")).toHaveValue("mine, edited");
  });

  /**
   * A read failure is a property of the DOCUMENT, in the run's own three words,
   * not a network error the reader can retry away — and the scan row survives
   * it, so the header still knows what the document is used by.
   */
  it("shows the run's own word for a document it could not read, not the content", () => {
    selectedDoc = "docs/a.md";
    renderView(PAGE, undefined, tracked, new ApiError("gone", 404, "doc_missing"));

    expect(screen.getByText(/missing — this document is not in the clone/)).toBeInTheDocument();
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
    // Nothing to seed a draft from, so Edit would save an empty file over it.
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  });
});

/**
 * The reader serves a document WHOLE up to 400 KB; a write is refused above
 * `MAX_DOC_CHARS`. Everything between the two caps is listed and opens, and used
 * to offer an Edit whose every Save came back `400 too_large` — 3 of the 30
 * documents under this repository's own scan roots are in that band.
 */
describe("ProjectContextView — the cap a save refuses on, said before the attempt", () => {
  const over = doc("docs/over.md", "docs", 0, "docs");
  const atCap = doc(".devdigest/at-cap.md", "other", 0, ".devdigest");
  const PAGE = {
    state: "scanned" as const,
    file_count: 2,
    scanned_at: "2026-08-13T00:00:00.000Z",
    roots: ["docs", ".devdigest"],
    documents: [over, atCap],
  };

  it("offers no Edit for a document a save would refuse, and gives the reason", () => {
    selectedDoc = "docs/over.md";
    renderView(PAGE, "x".repeat(MAX_DOC_CHARS + 1), over);

    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByText(/Longer than 40 000 characters/)).toBeInTheDocument();
    // Reading is untouched: the cap is on what a save can write, not on what the
    // reader may show.
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
  });

  it("still edits and saves a document exactly at the cap", async () => {
    selectedDoc = ".devdigest/at-cap.md";
    renderView(PAGE, "x".repeat(MAX_DOC_CHARS), atCap);

    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit).toBeEnabled();
    expect(screen.queryByText(/Longer than 40 000 characters/)).toBeNull();

    fireEvent.click(edit);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "shorter" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).toHaveBeenCalledWith({
      repoId: "repo-1",
      path: ".devdigest/at-cap.md",
      content: "shorter",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });
});

describe("ProjectContextView — an untrusted document cannot execute", () => {
  const PAGE = {
    state: "scanned" as const,
    file_count: 1,
    scanned_at: "2026-08-13T00:00:00.000Z",
    documents: [doc("docs/a.md")],
  };

  it("renders embedded HTML as TEXT — no element, no onerror attribute", () => {
    selectedDoc = "docs/a.md";
    const { container } = renderView(PAGE, 'Before <img src=x onerror="alert(1)"> after');
    // react-markdown v9 escapes raw HTML unless `rehype-raw` is added, and that
    // plugin is deliberately not a dependency. So the tag arrives as TEXT: no
    // element is created and no handler attribute exists. `onerror` DOES appear
    // in `innerHTML` — escaped, inside a text node — which is the proof rather
    // than the problem, so the assertion is on the DOM, not on the string.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.innerHTML).toContain("&lt;img src=x onerror=");
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
  });

  it("never puts a javascript: URL in an href, and the text still reads", () => {
    selectedDoc = "docs/a.md";
    const { container } = renderView(PAGE, "[click me](javascript:alert(1))");
    // THREE layers refuse this, and this assertion cannot tell them apart:
    // `react-markdown` v9's default `urlTransform` rewrites the URL to `""`,
    // React blocks a `javascript:` href at the DOM, and `isSafeUrl` at the call
    // site renders no anchor at all. That is why `isSafeUrl` has its own unit
    // test in `components/context-doc-view/helpers.test.ts` — breaking it leaves
    // THIS test green.
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("still renders an ordinary https link as a link", () => {
    selectedDoc = "docs/a.md";
    renderView(PAGE, "[docs](https://example.com/x)");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com/x",
    );
  });

  it("renders no image element for a data: source", () => {
    selectedDoc = "docs/a.md";
    const { container } = renderView(PAGE, "![alt](data:text/html;base64,PHNjcmlwdD4=)");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("alt")).toBeInTheDocument();
  });
});

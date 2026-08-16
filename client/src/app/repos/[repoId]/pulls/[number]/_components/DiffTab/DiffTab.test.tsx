import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

/**
 * DiffTab is the only way a reviewer reaches Smart Diff, so what is tested here
 * is the orchestration and nothing else: which viewer renders, what the toggle
 * reports, and that a request in flight does not empty the tab.
 *
 * Both viewers are mocked. Their own behaviour has its own tests, and rendering
 * the real ones would make every assertion here depend on them.
 */
const smartDiffData = vi.hoisted(() => ({ current: undefined as SmartDiff | undefined }));

vi.mock("@/lib/hooks/core", () => ({
  useSmartDiff: () => ({ data: smartDiffData.current }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// Both stand-ins reproduce the one thing DiffTab reaches into the DOM for: a
// `data-file-path` on every rendered card. The real attribute lives on
// `FileCard`, which BOTH viewers render — which is precisely why the jump has
// to care about which of the two trees is on screen when it runs.
vi.mock("@/components/diff-viewer", () => ({
  DiffViewer: ({ files }: { files: PrFile[] }) => (
    <div data-testid="plain-viewer">
      {files.length} files
      {files.map((f) => (
        <div key={f.path} data-file-path={f.path} />
      ))}
    </div>
  ),
}));
vi.mock("../SmartDiffViewer", () => ({
  SmartDiffViewer: ({
    onOpenFinding,
    openFile,
    files,
  }: {
    onOpenFinding?: (id: string) => void;
    openFile?: string;
    files: PrFile[];
  }) => (
    <div data-testid="smart-viewer" data-open-file={String(openFile)}>
      <button onClick={() => onOpenFinding?.("f-42")}>chip</button>
      {files.map((f) => (
        <div key={f.path} data-file-path={f.path} />
      ))}
    </div>
  ),
}));

import { DiffTab } from "./DiffTab";

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: null },
  { path: "package-lock.json", additions: 92, deletions: 24, patch: null },
];

const SMART_DIFF: SmartDiff = {
  groups: [],
  split_suggestion: { too_big: false, total_lines: 200, proposed_splits: [] },
};

const FINDINGS: FindingRecord[] = [];

beforeEach(() => {
  smartDiffData.current = SMART_DIFF;
});
afterEach(cleanup);

type TabProps = Partial<React.ComponentProps<typeof DiffTab>>;

function tabTree(props: TabProps, onSmartOrderChange: (next: boolean) => void) {
  return (
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <DiffTab
        prId="pr1"
        filesCount={FILES.length}
        files={FILES}
        findings={FINDINGS}
        smartOrder
        onSmartOrderChange={onSmartOrderChange}
        {...props}
      />
    </NextIntlClientProvider>
  );
}

function renderTab(props: TabProps = {}) {
  const onSmartOrderChange = vi.fn();
  const utils = render(tabTree(props, onSmartOrderChange));
  return {
    ...utils,
    onSmartOrderChange,
    /** Re-render in place — how a resolving query, or a toggled order, arrives. */
    rerenderTab: (patch: TabProps = {}) =>
      utils.rerender(tabTree({ ...props, ...patch }, onSmartOrderChange)),
  };
}

describe("DiffTab — which viewer renders", () => {
  it("shows the grouped viewer in smart order once the grouping has arrived", () => {
    renderTab();
    expect(screen.getByTestId("smart-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("plain-viewer")).not.toBeInTheDocument();
    expect(screen.getByText("Reviewer-ordered diff")).toBeInTheDocument();
  });

  it("falls back to the plain viewer while the request is in flight", () => {
    // The regression this guards: `showSmart` keyed on `smartOrder` alone renders
    // SmartDiffViewer with an undefined contract, and the tab comes up empty.
    smartDiffData.current = undefined;
    renderTab();
    expect(screen.getByTestId("plain-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("smart-viewer")).not.toBeInTheDocument();
    expect(screen.getByText("Files changed · 2 files")).toBeInTheDocument();
  });

  it("shows the plain viewer in original order even when the grouping is loaded", () => {
    renderTab({ smartOrder: false });
    expect(screen.getByTestId("plain-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("smart-viewer")).not.toBeInTheDocument();
  });
});

describe("DiffTab — the order toggle", () => {
  it("reports the choice upward rather than holding it", () => {
    // Held locally it would reset on every tab switch, because this component
    // unmounts when the reader follows a chip to Agent runs and comes back.
    const { onSmartOrderChange } = renderTab({ smartOrder: true });
    fireEvent.click(screen.getByText("Original order"));
    expect(onSmartOrderChange).toHaveBeenCalledWith(false);
  });

  it("reports true when Smart order is clicked from original order", () => {
    const { onSmartOrderChange } = renderTab({ smartOrder: false });
    fireEvent.click(screen.getByText("Smart order"));
    expect(onSmartOrderChange).toHaveBeenCalledWith(true);
  });

  it("offers both orders whichever one is active", () => {
    renderTab({ smartOrder: false });
    expect(screen.getByText("Smart order")).toBeInTheDocument();
    expect(screen.getByText("Original order")).toBeInTheDocument();
  });
});

describe("DiffTab — pass-through and totals", () => {
  it("hands a finding id up to the page", () => {
    const onOpenFinding = vi.fn();
    renderTab({ onOpenFinding });
    fireEvent.click(screen.getByText("chip"));
    expect(onOpenFinding).toHaveBeenCalledWith("f-42");
  });

  it("sums the totals from the files it renders, not from filesCount", () => {
    // filesCount comes off PrDetail and can disagree with the list when GitHub
    // truncated it; the line under the list must describe the list.
    renderTab({ filesCount: 99 });
    expect(screen.getByText("+176")).toBeInTheDocument();
    expect(screen.getByText("−24")).toBeInTheDocument();
  });
});

/**
 * The far end of the trip a Risk Brief review-focus item starts: the page put
 * the path in `?file=`, switched to this tab, and the reader has to land on the
 * file rather than at the top of a 40-file diff.
 */
describe("DiffTab — arriving from a review-focus item", () => {
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrolled.length = 0;
    // jsdom has no scrollIntoView at all.
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("scrolls to the targeted card and hands the path down so it opens", () => {
    renderTab({ targetFile: "package-lock.json" });

    const card = document.querySelector('[data-file-path="package-lock.json"]');
    expect(card).not.toBeNull();
    expect(scrolled).toEqual([card]);
    // Passed on, because a boilerplate file starts collapsed and a jump that
    // lands on a closed card has landed nowhere.
    expect(screen.getByTestId("smart-viewer")).toHaveAttribute(
      "data-open-file",
      "package-lock.json",
    );
  });

  it("survives a path that would otherwise end the attribute selector", () => {
    // A path is GitHub-supplied text. Interpolated raw, this one closes the
    // selector early and `querySelector` throws a SyntaxError out of the effect
    // — which is why the query goes through `CSS.escape`.
    const HOSTILE = 'src/we"ird].ts';
    renderTab({
      files: [{ path: HOSTILE, additions: 1, deletions: 0, patch: null }],
      targetFile: HOSTILE,
    });

    const card = document.querySelector(`[data-file-path="${CSS.escape(HOSTILE)}"]`);
    expect(card).not.toBeNull();
    expect(scrolled).toEqual([card]);
  });

  it("scrolls nowhere when the URL names no file", () => {
    renderTab();
    expect(scrolled).toEqual([]);
  });

  it("scrolls again once the grouping arrives and replaces the tree", () => {
    // The cold path, and the one this jump is normally taken on: the reader
    // follows a review-focus item before GET /smart-diff has answered, so the
    // first scroll happens inside the PLAIN viewer and the whole list is
    // re-ordered under them a moment later. Scroll only once and the card is
    // open, just far off-screen — silent, because nothing errors.
    smartDiffData.current = undefined;
    const { rerenderTab } = renderTab({ targetFile: "package-lock.json" });
    expect(screen.getByTestId("plain-viewer")).toBeInTheDocument();

    smartDiffData.current = SMART_DIFF;
    rerenderTab();

    // The last scroll must be the one inside the risk-ordered tree, not the
    // now-detached card of the list it replaced.
    const landed = scrolled.at(-1) as HTMLElement;
    expect(landed).toHaveAttribute("data-file-path", "package-lock.json");
    expect(screen.getByTestId("smart-viewer")).toContainElement(landed);
  });

  it("leaves the reader where they are when the order is toggled later", () => {
    // `?file=` is never cleared, so the target outlives the arrival. Each
    // (viewer, file) pair is scrolled to once: toggling the order minutes into
    // the visit must not drag the reader back to the brief's file.
    smartDiffData.current = undefined;
    const { rerenderTab } = renderTab({ targetFile: "package-lock.json" });
    smartDiffData.current = SMART_DIFF;
    rerenderTab();
    const afterArrival = scrolled.length;

    rerenderTab({ smartOrder: false });
    rerenderTab({ smartOrder: true });

    expect(scrolled).toHaveLength(afterArrival);
  });
});

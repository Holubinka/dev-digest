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
vi.mock("@/components/diff-viewer", () => ({
  DiffViewer: ({ files }: { files: PrFile[] }) => (
    <div data-testid="plain-viewer">{files.length} files</div>
  ),
}));
vi.mock("../SmartDiffViewer", () => ({
  SmartDiffViewer: ({ onOpenFinding }: { onOpenFinding?: (id: string) => void }) => (
    <div data-testid="smart-viewer">
      <button onClick={() => onOpenFinding?.("f-42")}>chip</button>
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

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  const onSmartOrderChange = vi.fn();
  const utils = render(
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
    </NextIntlClientProvider>,
  );
  return { ...utils, onSmartOrderChange };
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

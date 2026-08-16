import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { lineDomId } from "@/components/diff-viewer";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

const RATELIMIT_PATCH = `@@ -0,0 +26,4 @@
+  const key = bucketKey(req);
+  const count = await redis.incr(key);
+  if (count === 1) await redis.expire(key, 3600);
+  return next();`;

const LOCK_PATCH = `@@ -1204,0 +1204,2 @@
+      "version": "5.4.1",
+      "resolved": "https://registry.npmjs.org/ioredis/-/ioredis-5.4.1.tgz",`;

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 4, deletions: 0, patch: RATELIMIT_PATCH },
  { path: "src/config.ts", additions: 4, deletions: 0, patch: null },
  { path: "package-lock.json", additions: 2, deletions: 0, patch: LOCK_PATCH },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [28, 29],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/config.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 2,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 10, proposed_splits: [] },
};

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "bug",
    title: "Key never expires when the process dies mid-request",
    file: "src/middleware/ratelimit.ts",
    start_line: 28,
    end_line: 28,
    rationale: "expire is only set on the first hit.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

const BLOCKER = finding({ id: "f-blocker" });
const SUGGESTION = finding({
  id: "f-suggestion",
  severity: "SUGGESTION",
  title: "Prefer SET NX EX over INCR then EXPIRE",
  start_line: 29,
  end_line: 29,
});

function renderViewer(props?: Partial<React.ComponentProps<typeof SmartDiffViewer>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer
        smartDiff={SMART_DIFF}
        files={FILES}
        findings={[BLOCKER, SUGGESTION]}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders the groups in risk order, with their hints", () => {
    const { container } = renderViewer();
    const headers = [...container.querySelectorAll("section > header")];
    expect(headers.map((h) => h.textContent)).toEqual([
      "Core logicThe substance of the change — review closely1 files",
      "WiringHooks the core into the app1 files",
      "BoilerplateGenerated / mechanical — skim1 files",
    ]);
  });

  it("expands a core file but leaves the lock file collapsed on mount", () => {
    renderViewer();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeTruthy();
    expect(screen.getByText("package-lock.json")).toBeTruthy();
    expect(screen.queryByText(/const count = await redis.incr/)).toBeTruthy();
    expect(screen.queryByText(/registry.npmjs.org/)).toBeNull();
  });

  it("opens the lock file when its header is clicked", () => {
    renderViewer();
    fireEvent.click(screen.getByText("package-lock.json"));
    expect(screen.queryByText(/registry.npmjs.org/)).toBeTruthy();
  });

  it("puts a severity chip on the cited line, labelled by severity", () => {
    const { container } = renderViewer();
    // Line 28 carries the CRITICAL finding, line 29 the SUGGESTION.
    const rows = [...container.querySelectorAll("[id^='diff-line-']")];
    const line28 = rows.find((r) => r.id.endsWith("-28"))!;
    const line29 = rows.find((r) => r.id.endsWith("-29"))!;

    expect(within(line28 as HTMLElement).getByText("blocker")).toBeTruthy();
    expect(within(line29 as HTMLElement).getByText("suggestion")).toBeTruthy();
    expect(within(line28 as HTMLElement).queryByText("suggestion")).toBeNull();
  });

  it("opens the finding behind the chip, by id", () => {
    const onOpenFinding = vi.fn();
    renderViewer({ onOpenFinding });

    fireEvent.click(screen.getByText("blocker"));
    expect(onOpenFinding).toHaveBeenCalledWith("f-blocker");

    fireEvent.click(screen.getByText("suggestion"));
    expect(onOpenFinding).toHaveBeenLastCalledWith("f-suggestion");
  });

  it("badges the file with the number of FINDINGS, not the number of lines", () => {
    renderViewer();
    expect(screen.getAllByTitle("This file has findings")).toHaveLength(1);
    // Two findings across two lines. The contract's finding_lines is also 2 here,
    // so assert the shape that distinguishes them: a third line cited by the
    // SAME finding must not move the badge.
    expect(screen.getByText("2 findings")).toBeTruthy();

    cleanup();
    renderViewer({
      findings: [{ ...BLOCKER, start_line: 26, end_line: 29 }],
    });
    expect(screen.getByText("1 findings")).toBeTruthy();
  });

  it("scrolls the diff to the file's first cited line when the badge is clicked", () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });

    try {
      renderViewer();
      fireEvent.click(screen.getByTitle("Scroll to the first finding in this file"));
      const target = document.getElementById(
        lineDomId("src/middleware/ratelimit.ts", 28),
      );
      expect(target).not.toBeNull();
      expect(scrolled).toEqual([target]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("opens a collapsed file and scrolls to the line, not merely opens it", () => {
    // Asserting only that the file opened would leave the real risk untested:
    // the scroll runs in an effect after the expanding commit, so if it fired
    // in the click handler instead it would find nothing and silently no-op.
    // Capturing `this` is what proves the target existed by the time it ran.
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    try {
      // Put the finding on the lock file, which starts collapsed.
      renderViewer({
        findings: [{ ...BLOCKER, file: "package-lock.json", start_line: 1204, end_line: 1204 }],
      });
      expect(screen.queryByText(/registry.npmjs.org/)).toBeNull();
      fireEvent.click(screen.getByTitle("Scroll to the first finding in this file"));

      expect(screen.queryByText(/registry.npmjs.org/)).toBeTruthy();
      const target = document.getElementById(lineDomId("package-lock.json", 1204));
      expect(target).not.toBeNull();
      expect(scrolled).toEqual([target]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  /**
   * The receiving half of a Risk Brief review-focus jump. The lock file is the
   * case worth pinning: its role starts it collapsed, so a jump that only
   * scrolled would land the reader on a closed card.
   */
  it("opens the jump target on mount even when its role starts it collapsed", () => {
    renderViewer({ openFile: "package-lock.json" });
    expect(screen.queryByText(/registry.npmjs.org/)).toBeTruthy();
  });

  it("scrolls to the jump target's LINE, inside a card its role started collapsed", () => {
    // The scroll runs in an effect after the expanding commit. Capturing `this`
    // is what proves the line existed by the time it ran — asserting only that
    // the card opened would leave the real risk untested.
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    try {
      renderViewer({ openFile: "package-lock.json", openLine: 1204 });

      const target = document.getElementById(lineDomId("package-lock.json", 1204));
      expect(target).not.toBeNull();
      expect(scrolled).toEqual([target]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("scrolls nowhere on mount when the jump carried no line", () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    try {
      renderViewer({ openFile: "package-lock.json" });
      expect(scrolled).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("leaves every other file's role default alone when a jump target is set", () => {
    renderViewer({ openFile: "src/middleware/ratelimit.ts" });
    expect(screen.queryByText(/registry.npmjs.org/)).toBeNull();
  });

  it("carries each file's path on its card, which is how a jump finds it", () => {
    renderViewer();
    const paths = [...document.querySelectorAll("[data-file-path]")].map((el) =>
      el.getAttribute("data-file-path"),
    );
    expect(paths).toEqual([
      "src/middleware/ratelimit.ts",
      "src/config.ts",
      "package-lock.json",
    ]);
  });

  it("renders no chips and no marker before a review has run", () => {
    const clean: SmartDiff = {
      ...SMART_DIFF,
      groups: SMART_DIFF.groups.map((g) => ({
        ...g,
        files: g.files.map((f) => ({ ...f, finding_lines: [] })),
      })),
    };
    renderViewer({ smartDiff: clean, findings: [] });
    expect(screen.queryByText("blocker")).toBeNull();
    expect(screen.queryAllByTitle("This file has findings")).toHaveLength(0);
    expect(screen.queryByText(/\d+ findings/)).toBeNull();
    // …but the grouping still works, which is the point of ordering before review.
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeTruthy();
  });

  it("ignores a dismissed finding", () => {
    renderViewer({ findings: [{ ...BLOCKER, dismissed_at: "2026-08-07T00:00:00Z" }] });
    expect(screen.queryByText("blocker")).toBeNull();
  });

  it("caps a runaway finding range instead of hanging the render", () => {
    // start_line/end_line arrive unvalidated (lib/api.ts does not parse), and
    // this expansion runs in a useMemo DURING render — unbounded, it throws
    // inside render and takes the whole route down. Timed for that reason.
    const started = performance.now();
    renderViewer({
      findings: [{ ...BLOCKER, start_line: 1, end_line: 2_147_483_647 }],
    });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(screen.getByText(/findings/)).toBeTruthy();
  });

  it("shows the split suggestion only when the PR is too big", () => {
    const { unmount } = renderViewer();
    expect(screen.queryByText(/This PR is large/)).toBeNull();
    unmount();

    renderViewer({
      smartDiff: {
        ...SMART_DIFF,
        split_suggestion: {
          too_big: true,
          total_lines: 812,
          proposed_splits: [{ name: "Core logic", files: ["a.ts", "b.ts"] }],
        },
      },
    });
    expect(screen.getByText(/This PR is large \(812 changed lines\)/)).toBeTruthy();
    expect(screen.getByText(/Core logic — 2 files/)).toBeTruthy();
  });
});

/**
 * `severity` is a plain `text` column with no enum constraint, so a value
 * outside the contract can reach the chip. Two things must not happen: a
 * missing i18n key (next-intl throws) and an `undefined` icon component (React's
 * "Element type is invalid", which takes the route down — see INSIGHTS.md).
 */
describe("SmartDiffViewer with a severity outside the contract", () => {
  const ROGUE = ["INFO", "high", "constructor", "__proto__", "toString", ""];

  ROGUE.forEach((severity) => {
    it(`renders a chip instead of throwing for ${JSON.stringify(severity)}`, () => {
      expect(() =>
        renderViewer({ findings: [finding({ id: "f-rogue", severity } as never)] }),
      ).not.toThrow();
      // Falls back to the warning chip rather than rendering nothing at all: the
      // reader must still see that this line carries a finding.
      expect(screen.getByText("warning")).toBeTruthy();
    });
  });

  it("still opens the right finding from a fallback chip", () => {
    const onOpenFinding = vi.fn();
    renderViewer({
      findings: [finding({ id: "f-rogue", severity: "INFO" } as never)],
      onOpenFinding,
    });
    fireEvent.click(screen.getByText("warning"));
    expect(onOpenFinding).toHaveBeenCalledWith("f-rogue");
  });
});

/**
 * One finding, one chip — however many lines it spans.
 *
 * The gutter still marks the whole range, because that is how the reader sees
 * how far the finding reaches. The CHIP is a control, and repeating the same
 * control on every line of a block says "several problems" where there is one,
 * and gives the reader several identical things to click.
 */
describe("SmartDiffViewer chip placement for a multi-line finding", () => {
  const SPAN = finding({
    id: "f-span",
    severity: "CRITICAL",
    title: "Forwards to a caller-supplied URL with the account token",
    start_line: 28,
    end_line: 30,
  });

  it("renders exactly one chip for a finding spanning three lines", () => {
    renderViewer({ findings: [SPAN] });
    expect(screen.getAllByText("blocker")).toHaveLength(1);
  });

  it("anchors that chip to the first line of the range", () => {
    const { container } = renderViewer({ findings: [SPAN] });
    const row = container.querySelector<HTMLElement>("[id$='-28']")!;
    expect(within(row).getByText("blocker")).toBeTruthy();
    const later = container.querySelector<HTMLElement>("[id$='-29']");
    if (later) expect(within(later).queryByText("blocker")).toBeNull();
  });

  it("still marks every line of the range in the gutter", () => {
    const { container } = renderViewer({ findings: [SPAN] });
    const marked = [...container.querySelectorAll<HTMLElement>("[id^='diff-line-']")].filter(
      (el) => el.style.boxShadow !== "",
    );
    expect(marked.length).toBeGreaterThan(1);
  });

  it("keeps one chip per finding when two of them overlap", () => {
    renderViewer({
      findings: [SPAN, finding({ id: "f-other", severity: "SUGGESTION", start_line: 29, end_line: 29 })],
    });
    expect(screen.getAllByText("blocker")).toHaveLength(1);
    expect(screen.getAllByText("suggestion")).toHaveLength(1);
  });
});

describe("SmartDiffViewer chip anchoring when the range starts outside the hunk", () => {
  it("puts the chip on the first line the card actually draws", () => {
    // The fixture hunk starts at 26. A finding citing 20-28 has most of its
    // range off-screen; anchoring rigidly to start_line would render no chip at
    // all, on a file that demonstrably has a finding.
    const { container } = renderViewer({
      findings: [finding({ id: "f-early", start_line: 20, end_line: 28 })],
    });
    expect(screen.getAllByText("blocker")).toHaveLength(1);
    const first = container.querySelector<HTMLElement>("[id$='-26']")!;
    expect(within(first).getByText("blocker")).toBeTruthy();
  });
});

describe("SmartDiffViewer with two findings anchored on one line", () => {
  it("renders both chips on that row, worst first", () => {
    const { container } = renderViewer({
      findings: [
        finding({ id: "f-warn", severity: "WARNING", title: "Off-by-one on the limit" }),
        finding({ id: "f-crit", severity: "CRITICAL", title: "Key never expires" }),
      ],
    });
    const row = container.querySelector<HTMLElement>("[id$='-28']")!;
    const labels = [...row.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["blocker", "warning"]);
  });

  it("opens the right finding from each of them", () => {
    const onOpenFinding = vi.fn();
    renderViewer({
      findings: [
        finding({ id: "f-warn", severity: "WARNING" }),
        finding({ id: "f-crit", severity: "CRITICAL" }),
      ],
      onOpenFinding,
    });
    fireEvent.click(screen.getByText("warning"));
    expect(onOpenFinding).toHaveBeenLastCalledWith("f-warn");
    fireEvent.click(screen.getByText("blocker"));
    expect(onOpenFinding).toHaveBeenLastCalledWith("f-crit");
  });

  it("takes the gutter colour from the worse of the two", () => {
    const { container } = renderViewer({
      findings: [
        finding({ id: "f-sugg", severity: "SUGGESTION" }),
        finding({ id: "f-crit", severity: "CRITICAL" }),
      ],
    });
    const both = container.querySelector<HTMLElement>("[id$='-28']")!;
    const critOnly = renderViewer({ findings: [finding({ id: "x", severity: "CRITICAL" })] })
      .container.querySelector<HTMLElement>("[id$='-28']")!;
    expect(both.style.boxShadow).toBe(critOnly.style.boxShadow);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing client test uses `fireEvent`.
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, ReviewFocusItem, RiskBriefInput, RiskBriefRefLine } from "@/lib/types";
import messages from "@/../messages/en/brief.json";
import { ReviewFocusSection } from "./ReviewFocusSection";

/**
 * REVIEW FOCUS is presentational — `OverviewTab` owns the query — so this file
 * needs `NextIntlClientProvider` and nothing else.
 *
 * The `PrBriefCard.test.tsx` cases this file inherits are the two about what may
 * become a control (a changed file may, an endpoint label may not) and the
 * provenance list, all of which lived on the deleted card.
 */
afterEach(cleanup);

const INDEX = "1122334455667788990011223344556677889900";
const HEAD = "9a1c4d70bb2e5f3a6c8d90e1f2a3b4c5d6e7f809";

const ITEMS: ReviewFocusItem[] = [
  {
    ref: "src/config.ts",
    kind: "file",
    reason: "live Stripe key (sk_live_…) committed in plaintext",
  },
  {
    ref: "src/api/users.ts",
    kind: "file",
    reason: "N+1 query — one posts lookup per user, hit harder under the new limiter",
  },
  {
    ref: "POST /pulls/:id/brief",
    kind: "endpoint",
    reason: "The route that spends money.",
  },
];

/** Only `src/config.ts` came through the blast answer. */
const REF_LINES: RiskBriefRefLine[] = [
  { ref: "src/config.ts", line: 12, source: "blast_symbol" },
];

const FILES: PrFile[] = [
  { path: "src/config.ts", additions: 4, deletions: 0, patch: null },
  { path: "src/api/users.ts", additions: 12, deletions: 2, patch: null },
];

const INPUTS: RiskBriefInput[] = [
  { id: "diff_stats", status: "included", tokens: 180, detail: "12 files" },
  { id: "intent", status: "included", tokens: 320, detail: "high confidence" },
  { id: "blast", status: "truncated", tokens: 900, detail: "30 symbols, 12 shown" },
  { id: "pr_text", status: "included", tokens: 640, detail: null },
  { id: "linked_issue", status: "missing", tokens: 0, detail: "no linked issue" },
  { id: "specs", status: "dropped", tokens: 0, detail: "did not fit the budget" },
];

function renderSection(props: Partial<React.ComponentProps<typeof ReviewFocusSection>> = {}) {
  const onOpenFile = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocusSection
        items={ITEMS}
        refLines={REF_LINES}
        linkSha={INDEX}
        headSha={HEAD}
        indexMatchesHead
        prFiles={FILES}
        onOpenFile={onOpenFile}
        inputs={INPUTS}
        costUsd={0.014}
        tokensIn={2101}
        isLoading={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onOpenFile };
}

describe("ReviewFocusSection — the heading the design promises", () => {
  it("uses the design's own words and a badge carrying the full list length", () => {
    renderSection();

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    // "Where to look first" is a different sentence, and it is not what the
    // reader was promised (`client/AGENTS.md` names this exact pair).
    expect(screen.queryByText("Where to look first")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("keeps the section, the count 0 and an explicit sentence for an empty list", () => {
    renderSection({ items: [] });

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    // The count is drawn through a ternary, so an empty list renders "0" in the
    // badge — and never a stray literal `0` from `{items.length && …}`.
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing was singled out for this state of the pull request."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem").filter((li) => li.textContent?.includes("—")))
      .toHaveLength(0);
  });
});

describe("ReviewFocusSection — the rows", () => {
  it("shows every reason without anything being opened", () => {
    renderSection();

    for (const item of ITEMS) {
      expect(screen.getByText(`— ${item.reason}`)).toBeInTheDocument();
    }
    // A section called "read these first" whose reasons need a click has
    // cancelled itself (AC-56): no reason may sit inside a disclosure.
    for (const item of ITEMS) {
      expect(screen.getByText(`— ${item.reason}`).closest("details")).toBeNull();
    }
  });

  it("opens a changed file at the line the brief measured, in one call", () => {
    const { onOpenFile } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "src/config.ts:12" }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts", 12);
  });

  it("opens a changed file with no line when the brief measured none", () => {
    const { onOpenFile } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "src/api/users.ts" }));
    // The path ALONE — not `undefined` smuggled in as a second argument that
    // then reaches the URL as the string "undefined".
    expect(onOpenFile).toHaveBeenCalledWith("src/api/users.ts");
    expect(onOpenFile.mock.calls[0]).toHaveLength(1);
  });

  it("renders a reference outside the PR's files as text, never a dead control", () => {
    renderSection();

    // An endpoint label is grounded — the server allows it — and is still not a
    // file this PR changed, so there is nothing for a click to open (AC-6).
    expect(screen.getByText("POST /pulls/:id/brief")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "POST /pulls/:id/brief" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["a dot segment", "src/../../../etc/passwd"],
    ["a control character", `src/config${String.fromCodePoint(9)}.ts`],
    ["a scheme", "javascript:alert(1)"],
  ])("refuses to make a ref carrying %s a control, even inside the PR", (_label, ref) => {
    // Membership is granted deliberately: this is the case where grounding says
    // yes and the URL rules must still say no (AC-15).
    renderSection({
      items: [{ ref, kind: "file", reason: "hostile" }],
      prFiles: [...FILES, { path: ref, additions: 1, deletions: 0, patch: null }],
    });

    expect(screen.queryByRole("button", { name: ref })).not.toBeInTheDocument();
    expect(screen.getByText(ref, { normalizer: (value) => value })).toBeInTheDocument();
  });

  it("carries no line, in the text or in the jump, when the index is behind the head", () => {
    const { onOpenFile } = renderSection({ indexMatchesHead: false });

    expect(screen.queryByText("src/config.ts:12")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "src/config.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts");
  });
});

describe("ReviewFocusSection — the truncation is never silent", () => {
  it("shows ten rows plus a disclosure carrying 2, while the badge still reads 12", () => {
    // The server caps `review_focus` at 10 today, so this fixture is hand-written
    // on purpose: the cap is a server constant one commit away from changing.
    const twelve: ReviewFocusItem[] = Array.from({ length: 12 }, (_, i) => ({
      ref: `src/file-${i + 1}.ts`,
      kind: "file",
      reason: `reason ${i + 1}`,
    }));
    renderSection({ items: twelve, prFiles: [], refLines: [] });

    const open = screen.getByText("— reason 1").closest("ul") as HTMLElement;
    expect(within(open).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("2 more to read")).toBeInTheDocument();
    // The badge reports the FULL list, which is what makes the truncation loud.
    expect(screen.getByText("12")).toBeInTheDocument();
    // The last two are on the page, behind the disclosure — never dropped.
    expect(screen.getByText("— reason 12")).toBeInTheDocument();
    expect(screen.getByText("— reason 12").closest("details")).not.toBeNull();
    expect(screen.getByText("— reason 1").closest("details")).toBeNull();
  });
});

describe("ReviewFocusSection — provenance", () => {
  it("lists every input the brief was built from, with its status", () => {
    renderSection();
    const rows = within(screen.getByText("Built from").parentElement as HTMLElement)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain("diff_stats");
    expect(rows[0]).toContain("included");
    expect(rows[2]).toContain("truncated");
    expect(rows[4]).toContain("missing");
    expect(rows[5]).toContain("dropped");
  });

  it("labels the brief's own cost as the brief's, beside its token count", () => {
    renderSection();

    // Its own place and its own label, so the two costs on this screen can never
    // read as one number (AC-70).
    expect(screen.getByText("Brief cost")).toBeInTheDocument();
    // The existing formatter, shared with four other surfaces, and not a second
    // one: three decimals at this magnitude is what the PR list already shows.
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText(/tokens in$/)).toHaveTextContent(/2,?101 tokens in/);
  });

  it("shows an em dash rather than a zero when the brief's cost is unknown", () => {
    renderSection({ costUsd: null });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("ReviewFocusSection — the states that are not a list", () => {
  it("keeps the section and its heading while the brief is being computed", () => {
    const { container } = renderSection({ items: null, inputs: null, isLoading: true });

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("keeps the section and says the brief is missing when there is none", () => {
    renderSection({ items: null, inputs: null });

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("The brief for this state has not been computed.")).toBeInTheDocument();
    expect(screen.queryByText("Built from")).not.toBeInTheDocument();
  });
});

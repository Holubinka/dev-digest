import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { FindingsCell } from "./FindingsCell";
import { shortPath } from "./helpers";

afterEach(cleanup);

const BASE: PrMeta = {
  id: "pr1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit-public",
  base: "main",
  head_sha: "a1b2c3d",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: null,
  updated_at: null,
  score: 61,
  cost_usd: null,
  findings_critical: null,
  findings_warning: null,
  findings_suggestion: null,
  findings_top: null,
};

const finding = (id: string, severity: string, title: string) => ({
  id,
  severity,
  category: "security",
  title,
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  confidence: 0.98,
  rationale: "Line 12 contains a literal sk_live_ Stripe key.",
});

/** Reviewed PR: 1 critical + 1 warning, both previewed. */
const REVIEWED: PrMeta = {
  ...BASE,
  findings_critical: 1,
  findings_warning: 1,
  findings_suggestion: 0,
  findings_top: [
    finding("f1", "CRITICAL", "Hardcoded Stripe secret key"),
    finding("f2", "WARNING", "N+1 query in user list endpoint"),
  ],
};

/** Reviewed PR the agents approved — the column's normal state here. */
const CLEAN: PrMeta = {
  ...BASE,
  findings_critical: 0,
  findings_warning: 0,
  findings_suggestion: 0,
  findings_top: [],
};

function renderCell(pr: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsCell pr={pr} />
    </NextIntlClientProvider>,
  );
}

describe("FindingsCell", () => {
  it("shows one count per severity for a reviewed PR", () => {
    renderCell(REVIEWED);
    expect(screen.getByLabelText("1 critical, 1 warning, 0 suggestion")).toBeInTheDocument();
  });

  it("shows zeros when the agents reviewed the PR and found nothing", () => {
    renderCell(CLEAN);
    expect(screen.getByLabelText("0 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("shows a dash when the PR was never reviewed", () => {
    renderCell(BASE);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("lists the findings on hover, under a header carrying the total", () => {
    renderCell(REVIEWED);
    fireEvent.mouseEnter(screen.getByLabelText("1 critical, 1 warning, 0 suggestion"));
    expect(screen.getByText("2 finding(s)")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
  });

  it("opens the same card on keyboard focus", () => {
    renderCell(REVIEWED);
    fireEvent.focus(screen.getByLabelText("1 critical, 1 warning, 0 suggestion"));
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("hides the card again on mouse leave", () => {
    renderCell(REVIEWED);
    const cell = screen.getByLabelText("1 critical, 1 warning, 0 suggestion");
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("opens no card when there is nothing to list", () => {
    renderCell(CLEAN);
    fireEvent.mouseEnter(screen.getByLabelText("0 critical, 0 warning, 0 suggestion"));
    expect(screen.queryByText("0 finding(s)")).not.toBeInTheDocument();
  });

  it("elides a long path from the left so it stays inside the card", () => {
    const long = "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx";
    renderCell({
      ...REVIEWED,
      findings_top: [{ ...finding("f1", "WARNING", "focusIdx not reset"), file: long, start_line: 30, end_line: 45 }],
    });
    fireEvent.mouseEnter(screen.getByLabelText("1 critical, 1 warning, 0 suggestion"));
    // The full path stays reachable as the tooltip; the visible text is elided
    // from the left and keeps both the filename and the line reference.
    const shown = screen.getByTitle(`${long}:30-45`);
    expect(shown.textContent).toBe("…/_components/FindingsPanel/FindingsPanel.tsx:30-45");
    expect(shown.textContent!.length).toBeLessThan(long.length);
  });
});

describe("shortPath", () => {
  it("leaves a path that already fits", () => {
    expect(shortPath("src/config.ts", 46)).toBe("src/config.ts");
  });

  it("keeps the filename and as many trailing folders as fit in the budget", () => {
    const out = shortPath("client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx", 46);
    expect(out).toBe("…/_components/FindingsCell/FindingsCell.tsx");
    expect(out.length).toBeLessThanOrEqual(46);
  });

  it("drops a folder that would blow the budget", () => {
    expect(shortPath("client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx", 34)).toBe(
      "…/FindingsCell/FindingsCell.tsx",
    );
  });

  it("keeps the filename even when the filename alone is too long", () => {
    expect(shortPath("a/b/an-extremely-long-file-name-that-alone-exceeds-the-budget.ts", 20)).toBe(
      "…/an-extremely-long-file-name-that-alone-exceeds-the-budget.ts",
    );
  });
});

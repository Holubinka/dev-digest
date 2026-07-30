import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunFindings } from "./RunFindings";
import { topFindings } from "./helpers";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal sk_live_ Stripe key.",
    confidence: 0.9,
    ...over,
  } as FindingRecord;
}

function renderRunFindings(findings: FindingRecord[], blockers: number | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunFindings findings={findings} blockers={blockers} />
    </NextIntlClientProvider>,
  );
}

describe("RunFindings", () => {
  it("counts this run's findings by severity, worst first", () => {
    renderRunFindings([
      finding({ id: "a", severity: "CRITICAL" }),
      finding({ id: "b", severity: "WARNING" }),
      finding({ id: "c", severity: "WARNING" }),
    ]);
    expect(screen.getByLabelText("1 critical, 2 warning, 0 suggestion")).toBeInTheDocument();
  });

  it("shows dimmed zeros for a run that found nothing, and opens no card", () => {
    renderRunFindings([]);
    const group = screen.getByLabelText("0 critical, 0 warning, 0 suggestion");
    fireEvent.mouseEnter(group);
    expect(screen.queryByText("0 finding(s) in this run")).not.toBeInTheDocument();
  });

  it("heads the card with this run's total, not the previewed slice", () => {
    renderRunFindings([
      finding({ id: "a", severity: "CRITICAL" }),
      finding({ id: "b", severity: "WARNING" }),
      finding({ id: "c", severity: "WARNING" }),
      finding({ id: "d", severity: "SUGGESTION" }),
    ]);
    fireEvent.mouseEnter(screen.getByLabelText("1 critical, 2 warning, 1 suggestion"));
    expect(screen.getByText("4 finding(s) in this run")).toBeInTheDocument();
  });

  it("shows the blockers chip only when the CI gate tripped", () => {
    renderRunFindings([finding()], 2);
    expect(
      screen.getByLabelText("1 critical, 0 warning, 0 suggestion, 2 blockers"),
    ).toBeInTheDocument();
  });

  it("shows no blockers chip at zero or null", () => {
    renderRunFindings([finding()], 0);
    expect(screen.getByLabelText("1 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
    cleanup();
    renderRunFindings([finding()], null);
    expect(screen.getByLabelText("1 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
  });

  it("ignores a severity outside the contract instead of throwing", () => {
    expect(() =>
      renderRunFindings([finding({ id: "x", severity: "BOGUS" as FindingRecord["severity"] })]),
    ).not.toThrow();
    expect(screen.getByLabelText("0 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
  });
});

describe("topFindings", () => {
  it("ranks worst severity first, then most confident", () => {
    const out = topFindings(
      [
        finding({ id: "sugg", severity: "SUGGESTION", confidence: 0.99 }),
        finding({ id: "warn-low", severity: "WARNING", confidence: 0.2 }),
        finding({ id: "warn-high", severity: "WARNING", confidence: 0.8 }),
        finding({ id: "crit", severity: "CRITICAL", confidence: 0.1 }),
      ],
      10,
    );
    expect(out.map((f) => f.id)).toEqual(["crit", "warn-high", "warn-low", "sugg"]);
  });

  it("caps the list at the limit", () => {
    const many = Array.from({ length: 9 }, (_, i) => finding({ id: `f${i}` }));
    expect(topFindings(many, 3)).toHaveLength(3);
  });

  it("drops a severity outside the contract rather than ranking it last", () => {
    const out = topFindings(
      [finding({ id: "bad", severity: "BOGUS" as FindingRecord["severity"] })],
      3,
    );
    expect(out).toEqual([]);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunFindings } from "./RunFindings";

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

  it("lists every finding in the run, not just the worst few", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      finding({ id: `f${i}`, title: `Finding ${i}`, severity: "WARNING" }),
    );
    renderRunFindings(many);
    fireEvent.mouseEnter(screen.getByLabelText("0 critical, 6 warning, 0 suggestion"));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("links a finding to its file when the repo and head sha are known", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunFindings
          findings={[finding()]}
          blockers={null}
          repoFullName="acme/dev-digest"
          headSha="abc123"
        />
      </NextIntlClientProvider>,
    );
    fireEvent.mouseEnter(screen.getByLabelText("1 critical, 0 warning, 0 suggestion"));
    expect(screen.getByTitle("src/config.ts:12")).toHaveAttribute(
      "href",
      "https://github.com/acme/dev-digest/blob/abc123/src/config.ts#L12",
    );
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { SeverityFilterBar } from "./SeverityFilterBar";
import { countBySeverity } from "./helpers";

afterEach(cleanup);

/** A finding carrying only what the counter cares about. */
function finding(id: string, severity: string): FindingRecord {
  return {
    id,
    severity: severity as FindingRecord["severity"],
    category: "bug",
    title: `finding ${id}`,
    file: "src/index.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  };
}

const FINDINGS: FindingRecord[] = [
  finding("f1", "CRITICAL"),
  finding("f2", "CRITICAL"),
  finding("f3", "WARNING"),
];

function renderBar(
  props: Partial<React.ComponentProps<typeof SeverityFilterBar>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <SeverityFilterBar
        findings={FINDINGS}
        active={null}
        onChange={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("countBySeverity", () => {
  it("counts each contract level", () => {
    expect(countBySeverity(FINDINGS)).toEqual({
      CRITICAL: 2,
      WARNING: 1,
      SUGGESTION: 0,
    });
  });

  it("ignores a severity outside the contract", () => {
    expect(countBySeverity([...FINDINGS, finding("f4", "MAJOR")])).toEqual({
      CRITICAL: 2,
      WARNING: 1,
      SUGGESTION: 0,
    });
  });
});

describe("SeverityFilterBar", () => {
  it("shows a count for every level", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "2 CRITICAL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 WARNING" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 SUGGESTION" })).toBeInTheDocument();
  });

  it("disables a level with no findings", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "0 SUGGESTION" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2 CRITICAL" })).toBeEnabled();
  });

  it("selects a level on click", () => {
    const onChange = vi.fn();
    renderBar({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "2 CRITICAL" }));
    expect(onChange).toHaveBeenCalledWith("CRITICAL");
  });

  it("clears the filter when the active level is clicked again", () => {
    const onChange = vi.fn();
    renderBar({ active: "CRITICAL", onChange });
    fireEvent.click(screen.getByRole("button", { name: "2 CRITICAL" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("marks the active level as pressed", () => {
    renderBar({ active: "WARNING" });
    expect(screen.getByRole("button", { name: "1 WARNING" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "2 CRITICAL" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders a finding with an unknown severity nowhere", () => {
    renderBar({ findings: [...FINDINGS, finding("f4", "MAJOR")] });
    expect(screen.getByRole("button", { name: "2 CRITICAL" })).toBeInTheDocument();
    expect(screen.queryByText(/MAJOR/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "@/../messages/en/runs.json";
import { FindingsSection } from "./FindingsSection";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "SUGGESTION",
  category: "style",
  title: "Prefer a named export here",
  file: "src/lib/api.ts",
  start_line: 4,
  end_line: 4,
  rationale: "A default export makes this harder to grep for.",
  suggestion: null,
  confidence: 0.7,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderSection(findings: FindingRecord[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <FindingsSection findings={findings} />
    </NextIntlClientProvider>,
  );
}

/**
 * This section used to carry its own severity→colour map, which disagreed with
 * the vendored `SEV` token on SUGGESTION (it said `--accent`, i.e. blue) and had
 * no INFO row at all. It was the only surface in the app painting findings from
 * a private palette.
 */
describe("FindingsSection severity colours come from the vendored SEV token", () => {
  it("paints a SUGGESTION with the suggestion token, not the accent", () => {
    renderSection([FINDING]);
    const badge = screen.getByText("Suggestion");
    expect(badge.style.color).toBe("var(--sugg)");
    expect(badge.style.color).not.toBe("var(--accent)");
  });

  it("paints a CRITICAL with the critical token", () => {
    renderSection([{ ...FINDING, severity: "CRITICAL" }]);
    expect(screen.getByText("Critical").style.color).toBe("var(--crit)");
  });

  /**
   * INFO exists in the `SEV` table but not in the `Severity` contract enum, so
   * it needs the cast — which is exactly the shape of the defect. The old local
   * map had no INFO key and rendered it grey.
   */
  it("paints an INFO with the info token rather than falling back to grey", () => {
    renderSection([{ ...FINDING, severity: "INFO" as FindingRecord["severity"] }]);
    expect(screen.getByText("Info").style.color).toBe("var(--info)");
  });

  it("renders a severity outside the contract without throwing", () => {
    expect(() =>
      renderSection([{ ...FINDING, severity: "NITPICK" as FindingRecord["severity"] }]),
    ).not.toThrow();
    expect(screen.getByText("NITPICK").style.color).toBe("var(--text-muted)");
  });

  it("says so when the run produced no findings", () => {
    renderSection([]);
    expect(screen.getByText("No findings for this run.")).toBeInTheDocument();
  });
});

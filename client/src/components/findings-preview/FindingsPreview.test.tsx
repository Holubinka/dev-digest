import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ListFinding } from "@devdigest/shared";
import { FindingsPreview, type SeverityCount } from "./FindingsPreview";

afterEach(cleanup);

const COUNTS: SeverityCount[] = [
  { sev: "CRITICAL", n: 1 },
  { sev: "WARNING", n: 2 },
  { sev: "SUGGESTION", n: 0 },
];

const LABEL = "1 critical, 2 warning, 0 suggestion";

const FINDING: ListFinding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  confidence: 0.98,
  rationale: "Line 12 contains a literal sk_live_ Stripe key.",
};

function renderPreview(over: Partial<React.ComponentProps<typeof FindingsPreview>> = {}) {
  return render(
    <FindingsPreview
      counts={COUNTS}
      findings={[FINDING]}
      header="3 finding(s)"
      ariaLabel={LABEL}
      {...over}
    />,
  );
}

describe("FindingsPreview", () => {
  it("renders one chip per count, under the caller's aria-label", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    expect(group).toBeInTheDocument();
    expect(group.textContent).toBe("120");
  });

  it("lists the findings on hover, under the caller's header", () => {
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("opens the same card on keyboard focus", () => {
    renderPreview();
    fireEvent.focus(screen.getByLabelText(LABEL));
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("hides the card again on mouse leave", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.mouseEnter(group);
    fireEvent.mouseLeave(group);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("hides the card again on blur", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.focus(group);
    fireEvent.blur(group);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("opens no card when there is nothing to list", () => {
    renderPreview({ findings: [], header: "0 finding(s)" });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.queryByText("0 finding(s)")).not.toBeInTheDocument();
  });

  it("renders the extra slot after the chips", () => {
    renderPreview({ extra: <span>blockers-slot</span> });
    expect(screen.getByText("blockers-slot")).toBeInTheDocument();
  });

  it("elides a long path from the left so it stays inside the card", () => {
    const long = "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx";
    renderPreview({
      findings: [{ ...FINDING, file: long, start_line: 30, end_line: 45 }],
    });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    const shown = screen.getByTitle(`${long}:30-45`);
    expect(shown.textContent).toBe("…/_components/FindingsPanel/FindingsPanel.tsx:30-45");
  });
});

/**
 * RunCostBadge — the distinction the whole feature turns on: a run with NO cost
 * data reads "—", while a run that genuinely cost nothing (a free model) reads
 * "$0.0000". Collapsing the two would tell the user a priced run was free.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";
import { formatCost } from "./format";

afterEach(cleanup);

describe("formatCost — precision scales to magnitude", () => {
  it("renders no data as an em-dash, not $0.00", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(NaN)).toBe("—");
  });

  it("renders a real zero as a cost, not as missing data", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("gives sub-cent runs four decimals so they don't collapse to zero", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.0004)).toBe("$0.0004");
  });

  it("gives sub-dollar runs three decimals", () => {
    expect(formatCost(0.012)).toBe("$0.012");
    expect(formatCost(0.06)).toBe("$0.060");
  });

  it("gives dollar-scale runs two decimals", () => {
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(12)).toBe("$12.00");
  });
});

describe("RunCostBadge", () => {
  it("compact shows the cost alone, even when tokens are supplied", () => {
    render(<RunCostBadge costUsd={0.012} tokensIn={8200} tokensOut={1300} />);
    expect(screen.getByText("$0.012")).toBeInTheDocument();
    expect(screen.queryByText("8k→1.3k")).not.toBeInTheDocument();
  });

  it("detailed shows cost and the token flow", () => {
    render(
      <RunCostBadge costUsd={0.014} tokensIn={8200} tokensOut={1300} variant="detailed" />,
    );
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText("8k→1.3k")).toBeInTheDocument();
  });

  it("detailed drops the token half when either end is unknown", () => {
    render(<RunCostBadge costUsd={0.014} tokensIn={8200} tokensOut={null} variant="detailed" />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("a run with no cost renders the em-dash rather than disappearing", () => {
    render(<RunCostBadge costUsd={null} tokensIn={8200} tokensOut={1300} variant="detailed" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});

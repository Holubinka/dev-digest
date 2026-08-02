import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FindingSeverityBadge } from "./FindingSeverityBadge";
import { isKnownSeverity, severityColor } from "./helpers";

afterEach(cleanup);

describe("isKnownSeverity", () => {
  it("accepts every key the vendored SEV table carries, INFO included", () => {
    // INFO is renderable but is NOT in the `Severity` contract enum, which is
    // exactly why the guard is keyed off SEV instead of the contract.
    expect(["CRITICAL", "WARNING", "SUGGESTION", "INFO"].every(isKnownSeverity)).toBe(true);
  });

  it("rejects anything the table has no row for", () => {
    expect(isKnownSeverity("NITPICK")).toBe(false);
    expect(isKnownSeverity("critical")).toBe(false); // case matters — it is a key lookup
    expect(isKnownSeverity("")).toBe(false);
    expect(isKnownSeverity(undefined)).toBe(false);
    expect(isKnownSeverity(null)).toBe(false);
    expect(isKnownSeverity(3)).toBe(false);
  });

  /**
   * The case an ordinary "rejects an unknown string" test cannot reach. The
   * guard used to read `value in SEV`, and `in` walks the prototype chain, so
   * every name below answered true on a plain object literal — `SEV[value]`
   * then resolved to a method on `Object.prototype`. Assert them by name, not
   * via `Object.getOwnPropertyNames(Object.prototype)`, so the failure says
   * which key leaked.
   */
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"])(
    "rejects the inherited key %s, which the prototype chain answers for",
    (key) => {
      expect(isKnownSeverity(key)).toBe(false);
    },
  );
});

describe("severityColor", () => {
  it("returns the token colour for a known severity", () => {
    expect(severityColor("CRITICAL")).toBe("var(--crit)");
    expect(severityColor("WARNING")).toBe("var(--warn)");
    expect(severityColor("SUGGESTION")).toBe("var(--sugg)");
    expect(severityColor("INFO")).toBe("var(--info)");
  });

  it("falls back to muted for an out-of-contract severity", () => {
    expect(severityColor("NITPICK")).toBe("var(--text-muted)");
  });

  // Same prototype hole as the guard it delegates to: these used to return
  // `undefined` typed as `string`, which is worse than the fallback because
  // nothing downstream can see it coming.
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "falls back to muted for the inherited key %s",
    (key) => {
      expect(severityColor(key)).toBe("var(--text-muted)");
    },
  );
});

describe("FindingSeverityBadge", () => {
  it("renders a known severity with its token colour", () => {
    const { container } = render(<FindingSeverityBadge severity="CRITICAL" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.style.color).toBe("var(--crit)");
    expect(badge.style.background).toBe("var(--crit-bg)");
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("renders INFO, which the SEV table has and the contract enum does not", () => {
    const { container } = render(<FindingSeverityBadge severity="INFO" />);
    expect((container.firstElementChild as HTMLElement).style.color).toBe("var(--info)");
  });

  /**
   * `findings.severity` is a plain `text` column and `SeverityBadge` reads
   * `SEV[severity].icon` with no fallback, so before this wrapper existed a
   * single bad row took the whole PR-detail route down — see INSIGHTS.md,
   * "An unexpected `severity` value takes down the whole findings page".
   */
  it("renders an out-of-contract severity as muted text instead of throwing", () => {
    expect(() => render(<FindingSeverityBadge severity="NITPICK" />)).not.toThrow();
    const badge = screen.getByText("NITPICK");
    expect(badge).toBeInTheDocument();
    expect(badge.style.color).toBe("var(--text-muted)");
  });

  it("labels an empty severity rather than rendering an empty chip", () => {
    render(<FindingSeverityBadge severity="" />);
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
  });

  /**
   * The end-to-end version of the prototype-key case: a row with
   * `severity='toString'` used to pass the guard, reach `SeverityBadge`, and
   * throw `Element type is invalid` out of `Icon[undefined]` — not a bad badge,
   * the whole route. This is the assertion the guard's fix exists for.
   */
  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
    "renders the inherited key %s as muted text instead of taking the route down",
    (key) => {
      expect(() => render(<FindingSeverityBadge severity={key} />)).not.toThrow();
      expect(screen.getByText(key).style.color).toBe("var(--text-muted)");
    },
  );
});

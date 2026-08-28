import { describe, it, expect } from "vitest";
import messages from "@/../messages/en/eval.json";
import { formatRanAt, pct, RANGES, readRange, rangeToQuery } from "./format";

/**
 * The label the reader sees, not the value the URL carries.
 *
 * `t()` renders a MISSING key as the key path itself — `eval.dashboard.range.30d`
 * appeared in the option list of a running app while lint, typecheck and an RTL
 * `toHaveValue("30d")` were all green, because every one of them asserts the
 * value and none of them the text. This is the assertion that catches it.
 */
describe("RANGES — every option resolves to a real message", () => {
  it("names a key that exists in messages/en/eval.json", () => {
    const dict = messages as unknown as Record<string, Record<string, string>>;
    for (const { key, labelKey } of RANGES) {
      const [ns, group, leaf] = labelKey.split(".");
      const value = (
        dict[ns!] as unknown as Record<string, Record<string, string>> | undefined
      )?.[group!]?.[leaf!];
      expect(value, `${key} → ${labelKey}`).toBeTypeOf("string");
      expect(value, `${key} → ${labelKey}`).not.toBe("");
    }
  });

  it("keeps the URL value and the message key distinct on purpose", () => {
    // `30d` in the URL, `d30` in the JSON. Interpolating one from the other is
    // the bug this pair of assertions exists to keep out.
    expect(RANGES.map((r) => r.key)).toEqual(["7d", "30d", "90d", "all"]);
    expect(RANGES.map((r) => r.labelKey)).toEqual([
      "dashboard.range.d7",
      "dashboard.range.d30",
      "dashboard.range.d90",
      "dashboard.range.all",
    ]);
  });
});

describe("pct", () => {
  it("turns the contract's 0…1 metric into the whole percent the mockups print", () => {
    expect(pct(0.82)).toBe(82);
    expect(pct(1)).toBe(100);
    expect(pct(0)).toBe(0);
  });

  it("renders a missing metric as 0 rather than NaN%", () => {
    // `EvalBatchSummary.cost_usd` is nullable and an errored batch has null
    // metrics; `NaN%` on a dashboard is worse than an honest zero.
    expect(pct(null)).toBe(0);
    expect(pct(undefined)).toBe(0);
    expect(pct(Number.NaN)).toBe(0);
  });
});

describe("formatRanAt", () => {
  it("prints local time in the mockup's shape", () => {
    // Built from a LOCAL construction so the expectation holds in any TZ — the
    // point being asserted is the shape, not the offset.
    const d = new Date(2026, 4, 29, 9, 14);
    expect(formatRanAt(d.toISOString())).toBe("2026-05-29 09:14");
  });

  it("pads single digits, so the column stays aligned", () => {
    const d = new Date(2026, 0, 2, 3, 4);
    expect(formatRanAt(d.toISOString())).toBe("2026-01-02 03:04");
  });

  it("returns an unparseable timestamp untouched instead of `Invalid Date`", () => {
    expect(formatRanAt("not a date")).toBe("not a date");
  });
});

describe("readRange", () => {
  it("defaults to the mockup's 30 days", () => {
    expect(readRange(null)).toBe("30d");
    expect(readRange(undefined)).toBe("30d");
  });

  it("refuses a range the URL invented", () => {
    // `?range=` is user-controlled; an unknown value must fall back rather than
    // reach `Number("")` and produce an Invalid Date `from`.
    expect(readRange("1000y")).toBe("30d");
    expect(readRange("")).toBe("30d");
  });

  it("keeps a range it knows", () => {
    expect(readRange("7d")).toBe("7d");
    expect(readRange("all")).toBe("all");
  });
});

describe("rangeToQuery", () => {
  const now = new Date("2026-05-29T09:14:00.000Z");

  it("sends no bound at all for `all`", () => {
    expect(rangeToQuery("all", now)).toEqual({});
  });

  it("sends only `from` — an upper bound would drop a batch finishing mid-render", () => {
    expect(rangeToQuery("7d", now)).toEqual({ from: "2026-05-22T09:14:00.000Z" });
    expect(rangeToQuery("30d", now)).toEqual({ from: "2026-04-29T09:14:00.000Z" });
  });
});

/**
 * The period as the URL carries it.
 *
 * A hand-edited address bar is a real input here — the screen puts the window in
 * the query string precisely so it can be copied and sent — so an unusable one
 * has to land on a working screen rather than on an error.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_PERIOD, periodFromParams, periodToSearch } from "./period";

const read = (qs: string) => periodFromParams(new URLSearchParams(qs));

describe("periodFromParams", () => {
  it("reads the two fixed windows", () => {
    expect(read("range=1d")).toEqual({ range: "1d" });
    expect(read("range=30d")).toEqual({ range: "30d" });
  });

  it("reads a custom window with both bounds", () => {
    expect(read("range=custom&from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z")).toEqual({
      range: "custom",
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-08T00:00:00Z",
    });
  });

  it("falls back to the default rather than failing on anything unusable", () => {
    expect(read("")).toEqual(DEFAULT_PERIOD);
    expect(read("range=fortnight")).toEqual(DEFAULT_PERIOD);
    expect(read("range=custom")).toEqual(DEFAULT_PERIOD);
    expect(read("range=custom&from=yesterday&to=today")).toEqual(DEFAULT_PERIOD);
    // Backwards: the server would refuse it with a 422, so the screen never asks.
    expect(read("range=custom&from=2026-08-08T00:00:00Z&to=2026-08-01T00:00:00Z")).toEqual(
      DEFAULT_PERIOD,
    );
  });
});

describe("periodToSearch", () => {
  it("round-trips every window it writes", () => {
    for (const period of [
      { range: "1d" as const },
      { range: "30d" as const },
      { range: "custom" as const, from: "2026-08-01T00:00:00.000Z", to: "2026-08-08T00:00:00.000Z" },
    ]) {
      expect(read(periodToSearch(period))).toEqual(period);
    }
  });

  it("leaves the bounds out of a fixed window", () => {
    expect(periodToSearch({ range: "30d", from: "x", to: "y" })).toBe("range=30d");
  });
});

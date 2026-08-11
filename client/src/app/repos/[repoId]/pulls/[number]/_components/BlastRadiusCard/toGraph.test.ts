import { describe, it, expect } from "vitest";
import type { BlastRadiusView, BlastSymbol } from "@/lib/types";
/* The live answer for `Holubinka/dev-digest` PR #12, saved verbatim from
   `GET http://localhost:3001/pulls/e053a6af-.../blast` on 2026-08-09: 30 symbols,
   20 call sites, 38 endpoints — and `POST /findings/:id/${action}`, an endpoint
   label that is a template literal because the route is registered in a loop.
   Invented fixtures do not contain that; the repository does. */
import fixture from "./blast-pr12.fixture.json";
import { toGraph, GRAPH_CAPS, type BlastNode } from "./toGraph";

const LIVE = fixture as BlastRadiusView;

/** The label from PR #12 that broke the previous, mermaid-based renderer. */
const HOSTILE_ENDPOINT = "POST /findings/:id/${action}";

const caller = (over: Partial<BlastSymbol["callers"][number]> = {}) => ({
  file: "server/src/app.ts",
  symbol: "buildApp",
  line: 81,
  rank: 0.5,
  ...over,
});

const symbol = (over: Partial<BlastSymbol> = {}): BlastSymbol => ({
  name: "ReviewService",
  kind: "class",
  file: "server/src/modules/reviews/service.ts",
  line: 28,
  callers: [caller()],
  caller_count: 1,
  truncated: false,
  endpoints: [],
  endpoint_count: 0,
  endpoints_truncated: false,
  ...over,
});

const view = (symbols: BlastSymbol[]): BlastRadiusView => ({
  status: "full",
  reason: null,
  repo_full_name: "Holubinka/dev-digest",
  head_sha: "de50d5c364fb",
  link_sha: "66727c85ce06",
  index_matches_head: false,
  changed_files: [],
  symbols,
  totals: { symbols: symbols.length, callers: 0, endpoints: 0, crons: 0 },
  summary: null,
});

const labels = (nodes: BlastNode[]) => nodes.map((n) => n.label);
const typed = (nodes: BlastNode[], type: BlastNode["type"]) =>
  nodes.filter((n) => n.type === type);

describe("toGraph — the live answer", () => {
  it("draws PR #12 as nodes and links, and carries the hostile label verbatim", () => {
    const graph = toGraph(LIVE);

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.links.length).toBeGreaterThan(0);
    // A canvas paints text, it does not parse it — so the template literal that
    // broke the mermaid renderer needs no escaping and must arrive untouched.
    expect(labels(graph.nodes)).toContain(HOSTILE_ENDPOINT);
  });

  it("types every node, because the legend and the colours are that type", () => {
    const graph = toGraph(LIVE);

    // All three kinds must actually appear. Comparing the counts against
    // `shown` alone would be circular — `shown` is derived from these very
    // types, so mistyping every node keeps that comparison true.
    expect(typed(graph.nodes, "symbol").length).toBeGreaterThan(0);
    expect(typed(graph.nodes, "caller").length).toBeGreaterThan(0);
    expect(typed(graph.nodes, "endpoint").length).toBeGreaterThan(0);

    // A symbol's label is a bare name, a call site carries `:line`, and an
    // endpoint starts with a verb — so the type can be checked against the
    // content rather than against itself.
    expect(typed(graph.nodes, "endpoint").every((n) => /^[A-Z]+ \//.test(n.label))).toBe(true);
    expect(typed(graph.nodes, "caller").every((n) => /:\d+$/.test(n.label))).toBe(true);
    expect(graph.nodes.every((n) => ["symbol", "caller", "endpoint"].includes(n.type))).toBe(true);
  });

  it("says how much of the answer it left out, counted the way it draws", () => {
    const graph = toGraph(LIVE);

    expect(graph.shown.symbols).toBe(GRAPH_CAPS.symbols);
    expect(graph.total.symbols).toBeGreaterThan(graph.shown.symbols);
    // `total` counts distinct call sites and routes across the symbols that have
    // any downstream — the same way `shown` counts them — so N of M compares
    // like with like rather than a node count against a row count.
    expect(graph.total.callers).toBeGreaterThanOrEqual(graph.shown.callers);
    expect(graph.total.endpoints).toBeGreaterThanOrEqual(graph.shown.endpoints);
  });

  it("is stable: the same view, and a shuffled one, give the same nodes and links", () => {
    const first = toGraph(LIVE);
    const again = toGraph(LIVE);
    const shuffled = toGraph({ ...LIVE, symbols: [...LIVE.symbols].reverse() });

    expect(again.nodes).toEqual(first.nodes);
    expect(again.links).toEqual(first.links);
    expect(shuffled.nodes).toEqual(first.nodes);
    expect(shuffled.links).toEqual(first.links);
  });

  it("gives every node a distinct id, so no link can be silently reattached", () => {
    const graph = toGraph(LIVE);
    const ids = graph.nodes.map((n) => n.id);

    expect(new Set(ids).size).toBe(ids.length);
    // Every link must land on a node that exists — a collision would drop one.
    const known = new Set(ids);
    expect(graph.links.every((l) => known.has(l.source) && known.has(l.target))).toBe(true);
  });
});

describe("toGraph — what it refuses to draw", () => {
  it("draws nothing when no changed symbol has a caller", () => {
    const graph = toGraph(view([symbol({ callers: [], caller_count: 0 })]));

    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
    expect(graph.shown).toEqual({ symbols: 0, callers: 0, endpoints: 0 });
    expect(graph.total.symbols).toBe(0);
  });

  it("caps call sites per symbol and endpoint circles per graph, and counts the whole view underneath", () => {
    const many = symbol({
      callers: Array.from({ length: 9 }, (_, i) =>
        caller({ file: `server/src/f${i}.ts`, line: i + 1 }),
      ),
      caller_count: 9,
      truncated: true,
      endpoints: Array.from({ length: 16 }, (_, i) => ({
        label: `GET /r${i}`,
        file: `server/src/f${i}.ts`,
        line: 0,
        depth: 1 as const,
        kind: "http" as const,
      })),
      endpoint_count: 16,
      endpoints_truncated: true,
    });
    const graph = toGraph(view([many]));

    expect(graph.shown.callers).toBe(GRAPH_CAPS.callersPerSymbol);
    expect(graph.shown.endpoints).toBe(GRAPH_CAPS.endpoints);
    expect(graph.total).toEqual({ symbols: 1, callers: 9, endpoints: 16 });
  });

  /**
   * The reason the endpoint cap is a graph budget and not a per-symbol slice.
   * Two symbols reaching the same three routes must not spend six circles on
   * three answers — and must not lose the third to a per-symbol cap of two.
   */
  it("spends its endpoint budget on distinct routes, not on repeated ones", () => {
    const routes = ["GET /a", "GET /b", "GET /c"].map((route) => ({
      label: route,
      file: "server/src/routes.ts",
      line: 0,
      depth: 1 as const,
      kind: "http" as const,
    }));
    const shared = (name: string, line: number) =>
      symbol({
        name,
        line,
        callers: [caller({ file: "server/src/routes.ts", line })],
        endpoints: routes,
        endpoint_count: routes.length,
      });
    const graph = toGraph(view([shared("first", 10), shared("second", 20)]));

    expect(graph.shown.endpoints).toBe(3);
    expect(graph.total.endpoints).toBe(3);
    // Two symbol→caller links plus both call sites pointing at all three routes.
    expect(graph.links).toHaveLength(2 + 6);
  });

  it("hangs an endpoint off the call site in its own file, and off the symbol otherwise", () => {
    const graph = toGraph(
      view([
        symbol({
          callers: [caller({ file: "server/src/routes.ts", line: 22 })],
          endpoints: [
            { label: "GET /here", file: "server/src/routes.ts", line: 0, depth: 1, kind: "http" },
            { label: "GET /elsewhere", file: "server/src/deeper.ts", line: 0, depth: 2, kind: "http" },
          ],
          endpoint_count: 2,
        }),
      ]),
    );

    const id = (label: string) => graph.nodes.find((n) => n.label === label)!.id;
    const linked = (from: string, to: string) =>
      graph.links.some((l) => l.source === id(from) && l.target === id(to));

    expect(linked("ReviewService", "src/routes.ts:22")).toBe(true);
    // Same file as the drawn call site → that is the route the change takes.
    expect(linked("src/routes.ts:22", "GET /here")).toBe(true);
    // Further down the import walk → only the symbol can honestly be joined.
    expect(linked("ReviewService", "GET /elsewhere")).toBe(true);
  });

  it("truncates a very long label by code point, so no half character is drawn", () => {
    const astral = "🧨".repeat(60);
    const graph = toGraph(view([symbol({ name: astral })]));
    const drawn = typed(graph.nodes, "symbol")[0]!.label;

    expect(drawn.endsWith("…")).toBe(true);
    // Split surrogates would show up as replacement characters here.
    expect(drawn).not.toContain("�");
    expect([...drawn].every((point) => point === "🧨" || point === "…")).toBe(true);
  });
});

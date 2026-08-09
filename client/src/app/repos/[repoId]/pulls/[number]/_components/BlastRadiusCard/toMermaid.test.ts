import { describe, it, expect, beforeAll } from "vitest";
/* The real parser, not a shape check. `MermaidDiagram` decides whether to render
   anything with exactly this call — `mermaid.parse(src, { suppressErrors: true })`
   (`src/components/mermaid-diagram/MermaidDiagram.tsx:39`) — and it renders NOTHING
   when the answer is false. A test that only asserted "the label is in the string"
   would pass on a chart that draws an empty modal. */
import mermaid from "mermaid";
import type { BlastRadiusView, BlastSymbol } from "@/lib/types";
/* The live answer for `Holubinka/dev-digest` PR #12, saved verbatim from
   `GET http://localhost:3001/pulls/e053a6af-.../blast` on 2026-08-09: 30 symbols,
   20 call sites, 38 endpoints — and `POST /findings/:id/${action}`, an endpoint
   label that is a template literal because the route is registered in a loop.
   Invented fixtures do not contain that; the repository does. */
import fixture from "./blast-pr12.fixture.json";
import { toMermaid, GRAPH_CAPS } from "./toMermaid";

const LIVE = fixture as BlastRadiusView;

/** The label from PR #12 that a naive `[${label}]` interpolation cannot survive. */
const HOSTILE_ENDPOINT = "POST /findings/:id/${action}";

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
});

const parses = async (chart: string) =>
  Boolean(await mermaid.parse(chart, { suppressErrors: true }));

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

/** Every statement after the header, so a label can be checked for what it contains. */
const labelsOf = (chart: string) =>
  [...chart.matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);

describe("toMermaid — the chart mermaid actually parses", () => {
  it("draws the live PR #12 answer, and mermaid parses it", async () => {
    const graph = toMermaid(LIVE);

    expect(graph.chart.startsWith("flowchart LR\n")).toBe(true);
    expect(await parses(graph.chart)).toBe(true);

    // The hostile endpoint is drawn, not dropped, and it is drawn quoted.
    expect(graph.chart).toContain(`"${HOSTILE_ENDPOINT}"`);
  });

  it("says how much of the answer it left out, counted the way it draws", () => {
    const graph = toMermaid(LIVE);

    // Live numbers, 2026-08-09. 30 changed symbols, 18 of which anything calls;
    // the other 12 have no downstream and so no edge to draw.
    expect(graph.total).toEqual({ symbols: 18, callers: 19, endpoints: 10 });
    expect(graph.shown).toEqual({ symbols: 6, callers: 8, endpoints: 10 });
    expect(graph.shown.symbols).toBe(GRAPH_CAPS.symbols);
  });

  /**
   * Parsing is what `MermaidDiagram` gates on; rendering is what the reviewer
   * sees, and the two are not the same claim. jsdom has no layout engine, so the
   * box measurement mermaid needs is stubbed — which makes this prove exactly
   * one thing: mermaid turns the live chart into an SVG that still carries the
   * label a naive interpolation would have taken the whole graph down with.
   * Whether that SVG is LEGIBLE is a question only a browser answers.
   */
  it("renders the live chart to an SVG that still carries the hostile label", async () => {
    (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 0, y: 0, width: 100, height: 20 }) as DOMRect;

    const { svg } = await mermaid.render("blast-radius-test", toMermaid(LIVE).chart);

    expect(svg).toContain("<svg");
    expect(svg).toContain(HOSTILE_ENDPOINT);
  });

  it("is stable: the same view drawn twice, and drawn from a shuffled list, is the same chart", () => {
    const shuffled = view([...LIVE.symbols].reverse());
    expect(toMermaid(LIVE).chart).toBe(toMermaid(LIVE).chart);
    expect(toMermaid(shuffled).chart).toBe(toMermaid(view(LIVE.symbols)).chart);
  });
});

describe("toMermaid — hostile labels, which is all of them", () => {
  /* Every label is repository content. These are the characters that end a
     mermaid statement or a mermaid label, gathered into one view. */
  const NASTY = view([
    symbol({
      name: 'render("a", b) <T>\nnext line',
      file: "server/src/x (copy)/service.ts",
      callers: [caller({ file: 'src/"quoted"/app.ts', symbol: "a|b", line: 7 })],
      endpoints: [
        {
          label: HOSTILE_ENDPOINT,
          file: 'src/"quoted"/app.ts',
          line: 0,
          depth: 1,
          kind: "http" as const,
        },
        {
          label: "GET /a#35;b -- {x} [y] |z| %%comment",
          file: "src/other.ts",
          line: 0,
          depth: 2,
          kind: "cron" as const,
        },
      ],
      endpoint_count: 2,
    }),
  ]);

  it("still parses with a template literal, quotes, brackets and a newline in the labels", async () => {
    expect(await parses(toMermaid(NASTY).chart)).toBe(true);
  });

  /**
   * The control. If mermaid tolerated these characters raw, every assertion
   * above would be green whether or not `toMermaid` escaped anything — so the
   * naive chart is built here and asserted to be exactly what it is: unparseable,
   * and therefore an empty modal.
   */
  it("proves the escaping is load-bearing: the same labels interpolated raw do not parse", async () => {
    const naive = [
      "flowchart LR",
      `  n0["${NASTY.symbols[0]!.name}"]`,
      `  n1(["${HOSTILE_ENDPOINT}"])`,
      "  n0 --> n1",
    ].join("\n");

    expect(await parses(naive)).toBe(false);

    // And the live label on its own, interpolated the way a first draft writes
    // it — straight into the brackets, unquoted. This is the one that ships:
    // the payload above needs no quote and no newline to take the graph down.
    const unquoted = ["flowchart LR", `  n0[${HOSTILE_ENDPOINT}]`].join("\n");
    expect(await parses(unquoted)).toBe(false);
  });

  it("keeps a newline out of the statement and a quote out of the label", () => {
    const chart = toMermaid(NASTY).chart;

    // One statement per line: a raw newline inside a label would split a node
    // definition in half, and the second half is not a mermaid statement.
    for (const line of chart.split("\n").slice(1)) {
      expect(line).toMatch(/^ {2}n\d+([[(]|\(\[)|^ {2}n\d+ --> n\d+$/);
    }
    for (const text of labelsOf(chart)) {
      expect(text).not.toMatch(/["<>\n\r]/);
    }
  });

  it("names every node itself, so nothing from the repository can become an id", () => {
    const chart = toMermaid(NASTY).chart;
    const ids = [...chart.matchAll(/^ {2}(\S+?)[[(]/gm)].map((m) => m[1] as string);

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^n\d+$/);
  });

  it("truncates a very long label by code point, so no half character reaches the chart", async () => {
    const long = `${"\u{1F4A5}".repeat(60)}end`;
    const graph = toMermaid(view([symbol({ name: long })]));
    const drawn = labelsOf(graph.chart)[0] as string;

    expect([...drawn]).toHaveLength(44);
    expect(drawn.endsWith("…")).toBe(true);
    // A `String.slice(0, 44)` would cut the last emoji in half and leave a lone
    // surrogate — which is not a character the chart should carry.
    expect(drawn).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(await parses(graph.chart)).toBe(true);
  });
});

describe("toMermaid — what it refuses to draw", () => {
  it("draws nothing when no changed symbol has a caller", () => {
    const graph = toMermaid(view([symbol({ callers: [], caller_count: 0 })]));

    expect(graph.chart).toBe("");
    expect(graph.shown).toEqual({ symbols: 0, callers: 0, endpoints: 0 });
    expect(graph.total.symbols).toBe(0);
  });

  it("caps call sites per symbol and endpoint boxes per chart, and counts the whole view underneath", async () => {
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
    const graph = toMermaid(view([many]));

    expect(graph.shown.callers).toBe(GRAPH_CAPS.callersPerSymbol);
    expect(graph.shown.endpoints).toBe(GRAPH_CAPS.endpoints);
    expect(graph.total).toEqual({ symbols: 1, callers: 9, endpoints: 16 });
    expect(await parses(graph.chart)).toBe(true);
  });

  /**
   * The reason the endpoint cap is a chart budget and not a per-symbol slice.
   * Two symbols reaching the same three routes must not spend six boxes on
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
    const graph = toMermaid(view([shared("first", 10), shared("second", 20)]));

    expect(graph.shown.endpoints).toBe(3);
    expect(graph.total.endpoints).toBe(3);
    // Both call sites point at all three, which is the answer; six boxes is not.
    expect(graph.chart.match(/--> n\d+$/gm)).toHaveLength(2 + 6);
  });

  it("hangs an endpoint off the call site in its own file, and off the symbol otherwise", () => {
    const graph = toMermaid(
      view([
        symbol({
          callers: [caller({ file: "server/src/routes.ts", line: 22 })],
          endpoints: [
            {
              label: "GET /here",
              file: "server/src/routes.ts",
              line: 0,
              depth: 1,
              kind: "http",
            },
            {
              label: "GET /elsewhere",
              file: "server/src/deeper.ts",
              line: 0,
              depth: 2,
              kind: "http",
            },
          ],
          endpoint_count: 2,
        }),
      ]),
    );

    // n0 symbol, n1 call site, n2 same-file endpoint, n3 endpoint from deeper in
    // the import walk — which no drawn call site can honestly be joined to.
    expect(graph.chart).toContain("  n0 --> n1");
    expect(graph.chart).toContain("  n1 --> n2");
    expect(graph.chart).toContain("  n0 --> n3");
  });
});

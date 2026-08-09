/* The blast radius as a mermaid flowchart: changed symbol → its call sites →
   the endpoints they serve.

   Pure and in its own file for one reason: `MermaidDiagram` renders NOTHING when
   a chart fails to parse — no throw, no error box, just an empty modal that
   reads as a loading bug (`src/components/mermaid-diagram/MermaidDiagram.tsx:59`).
   Every label here is repository content: a symbol name, a path, an endpoint
   label. `Holubinka/dev-digest` PR #12 already ships one that is a template
   literal — `POST /findings/:id/${action}` — so escaping is not hypothetical,
   and it has to be testable without rendering mermaid. See `toMermaid.test.ts`. */

import type { BlastRadiusView, BlastSymbol } from "@/lib/types";

/**
 * What the graph draws, per view.
 *
 * The tree renders everything; the graph cannot. Measured on PR #12 of this
 * repository — 30 symbols, 20 call sites, 38 endpoints, in a card that occupies
 * one half of a two-column Overview grid. Drawn whole that is a hairball, so the
 * graph shows the symbols a change reaches furthest and says so: `shown` and
 * `total` come back with the chart and the modal prints both.
 *
 * At most 6 + 6×4 + 10 = 40 nodes, which still lays out legibly at
 * `flowchart LR` in a 1100px modal; 24 of them on PR #12.
 *
 * `endpoints` is a budget for the whole chart rather than a per-symbol cap,
 * because endpoints REPEAT: on PR #12 twelve symbols reach the same eight routes
 * in `reviews/routes.ts`, so they de-duplicate into eight boxes. Capping each
 * symbol at four instead drew the first four of each list and left the union
 * short — `POST /findings/:id/${action}` was cut from a graph with room for it.
 * A shared budget spends the same number of boxes on more of the answer.
 */
export const GRAPH_CAPS = {
  symbols: 6,
  callersPerSymbol: 4,
  endpoints: 10,
} as const;

/** Longest label, in code points. Beyond this a node box stops fitting a row. */
const MAX_LABEL = 44;

export interface BlastGraphCounts {
  symbols: number;
  callers: number;
  endpoints: number;
}

export interface BlastGraph {
  /** The mermaid source, or `""` when there is nothing downstream to draw. */
  chart: string;
  /** Distinct nodes drawn. */
  shown: BlastGraphCounts;
  /** Distinct nodes the view holds, counted the same way — so N of M compares like with like. */
  total: BlastGraphCounts;
}

/**
 * Code points, never `String.slice`: a path or an endpoint label can carry
 * anything the repository carries, and cutting a surrogate pair in half produces
 * a lone half-character (`server/INSIGHTS.md:164-176`).
 */
const clip = (text: string, max: number) => {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max - 1).join("")}…`;
};

/**
 * A quoted, escaped mermaid label.
 *
 * Three things break a chart, and all three arrive from repository content:
 * a newline ends the statement, a `"` ends the label, and `<`/`>` are read as
 * markup by the HTML label renderer. Mermaid's own escape hatch is a numeric
 * entity code (`#35;` → `#`), so `#` is rewritten FIRST — otherwise the codes
 * this function emits would themselves be rewritten, and a label containing a
 * literal `#quot;` would come back out as `"`.
 */
const label = (raw: string) => {
  const flat = clip(raw.replace(/\s+/g, " ").trim(), MAX_LABEL);
  const escaped = flat
    .replace(/#/g, "#35;")
    .replace(/"/g, "#34;")
    .replace(/</g, "#60;")
    .replace(/>/g, "#62;");
  // An all-whitespace name would otherwise emit `[""]`, which parses but draws
  // a nameless box. `?` is at least legible as "the index gave us nothing".
  return `"${escaped === "" ? "?" : escaped}"`;
};

/** The last two segments, so `…/modules/reviews/routes.ts` reads as `reviews/routes.ts`. */
const shortPath = (file: string) => file.split("/").slice(-2).join("/");

/** Locale-independent, so the node order is the same on every machine. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Total order — reach first, then the identity of the symbol. A partial order
 * over an unordered input is not deterministic, and a graph that reshuffles
 * between two renders of the same PR reads as a bug.
 */
const byReach = (a: BlastSymbol, b: BlastSymbol) =>
  b.caller_count - a.caller_count ||
  b.endpoint_count - a.endpoint_count ||
  cmp(a.name, b.name) ||
  cmp(a.file, b.file) ||
  a.line - b.line;

/**
 * A node registry key. NUL is the separator because it is the one character a
 * path, a symbol name and an endpoint label cannot contain — joining on `:` lets
 * two different nodes collide into one, and a collision here silently drops an
 * edge rather than failing.
 */
const key = (...parts: (string | number)[]) => parts.join("\u0000");

export function toMermaid(view: BlastRadiusView): BlastGraph {
  // A symbol nothing calls has no downstream, so it has no edge and would sit in
  // the graph as a floating box. The tree above still lists it.
  const drawable = view.symbols.filter((symbol) => symbol.callers.length > 0);

  const total: BlastGraphCounts = {
    symbols: drawable.length,
    callers: new Set(
      drawable.flatMap((s) => s.callers.map((c) => key(c.file, c.line))),
    ).size,
    endpoints: new Set(
      drawable.flatMap((s) => s.endpoints.map((e) => key(e.file, e.label))),
    ).size,
  };

  const shownSymbols = [...drawable].sort(byReach).slice(0, GRAPH_CAPS.symbols);
  if (shownSymbols.length === 0) {
    return { chart: "", shown: { symbols: 0, callers: 0, endpoints: 0 }, total };
  }

  const ids = new Map<string, string>();
  const nodes: string[] = [];
  // A Set, because the same caller reaches the same endpoint through more than
  // one symbol on any real PR; duplicate edges thicken a line for no reason.
  const edges = new Set<string>();
  const callerNodes = new Set<string>();
  const endpointNodes = new Set<string>();

  const node = (id: string, text: string, open: string, close: string) => {
    const known = ids.get(id);
    if (known) return known;
    // Generated, never derived from content: a node id is unquoted in mermaid,
    // so a path with a space or a bracket in it would be a syntax error rather
    // than a label. There is nothing to escape if nothing is interpolated.
    const generated = `n${ids.size}`;
    ids.set(id, generated);
    nodes.push(`  ${generated}${open}${label(text)}${close}`);
    return generated;
  };

  for (const symbol of shownSymbols) {
    const symbolNode = node(
      key("s", symbol.file, symbol.line, symbol.name),
      symbol.name,
      "[",
      "]",
    );

    const callerByFile = new Map<string, string>();
    for (const caller of symbol.callers.slice(0, GRAPH_CAPS.callersPerSymbol)) {
      const callerNode = node(
        key("c", caller.file, caller.line),
        `${shortPath(caller.file)}:${caller.line}`,
        "(",
        ")",
      );
      callerNodes.add(callerNode);
      if (!callerByFile.has(caller.file)) callerByFile.set(caller.file, callerNode);
      edges.add(`  ${symbolNode} --> ${callerNode}`);
    }

    for (const endpoint of symbol.endpoints) {
      const endpointKey = key("e", endpoint.file, endpoint.label);
      // The budget buys BOXES, not mentions: an endpoint already drawn costs
      // nothing to point another call site at, and that edge is the part of the
      // answer worth having.
      if (!ids.has(endpointKey) && endpointNodes.size >= GRAPH_CAPS.endpoints) continue;

      const endpointNode = node(endpointKey, endpoint.label, "([", "])");
      endpointNodes.add(endpointNode);
      // An endpoint is a line in a file. When one of the call sites drawn above
      // sits in that same file, that is the route the change actually takes to
      // reach it; when none does, the endpoint came from further down the import
      // walk and only the symbol can honestly be joined to it.
      edges.add(`  ${callerByFile.get(endpoint.file) ?? symbolNode} --> ${endpointNode}`);
    }
  }

  return {
    chart: ["flowchart LR", ...nodes, ...edges].join("\n"),
    shown: {
      symbols: shownSymbols.length,
      callers: callerNodes.size,
      endpoints: endpointNodes.size,
    },
    total,
  };
}

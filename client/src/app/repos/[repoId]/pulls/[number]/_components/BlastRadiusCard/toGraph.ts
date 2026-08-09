/* The blast radius as nodes and links: changed symbol → its call sites → the
   endpoints they serve.

   Pure, and in its own file, so the shape of the answer is testable without a
   canvas. `react-force-graph-2d` draws onto a `<canvas>`, which jsdom does not
   implement — mounting it in a unit test proves nothing and mocking it proves
   less. Everything worth asserting about this graph is decided here. */

import type { BlastRadiusView, BlastSymbol } from "@/lib/types";

/**
 * What the graph draws, per view.
 *
 * The tree renders everything; the graph cannot. Measured on PR #12 of this
 * repository — 30 symbols, 20 call sites, 38 endpoints. Drawn whole under a
 * force layout that is a hairball, so the graph shows the symbols a change
 * reaches furthest and says so: `shown` and `total` come back with the data and
 * the modal prints both.
 *
 * At most 6 + 6×4 + 10 = 40 nodes; 24 of them on PR #12.
 *
 * `endpoints` is a budget for the whole graph rather than a per-symbol cap,
 * because endpoints REPEAT: on PR #12 twelve symbols reach the same eight routes
 * in `reviews/routes.ts`, so they de-duplicate into eight circles. Capping each
 * symbol at four instead drew the first four of each list and left the union
 * short — `POST /findings/:id/${action}` was cut from a graph with room for it.
 * A shared budget spends the same number of circles on more of the answer.
 */
export const GRAPH_CAPS = {
  symbols: 6,
  callersPerSymbol: 3,
  endpoints: 10,
} as const;

/**
 * Longest label, in code points. A canvas label is drawn under its circle and
 * clips nothing by itself: too long and neighbouring labels overlap into an
 * unreadable smear, which is worse than an ellipsis.
 */
const MAX_LABEL = 32;

/** What a node is, which is the only thing the legend and the colours encode. */
export type BlastNodeType = "symbol" | "caller" | "endpoint";

export interface BlastNode {
  id: string;
  label: string;
  type: BlastNodeType;
}

export interface BlastLink {
  source: string;
  target: string;
}

export interface BlastGraphCounts {
  symbols: number;
  callers: number;
  endpoints: number;
}

export interface BlastGraph {
  nodes: BlastNode[];
  links: BlastLink[];
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
 * A drawable label. Nothing is escaped and nothing needs to be — canvas text is
 * painted, not parsed, so the template literal this repository really ships
 * (`POST /findings/:id/${action}`) is just characters. Whitespace is flattened
 * because a newline in a canvas label draws nothing, it does not wrap.
 */
const label = (raw: string) => {
  const flat = clip(raw.replace(/\s+/g, " ").trim(), MAX_LABEL);
  // An all-whitespace name would otherwise draw a nameless circle. `?` is at
  // least legible as "the index gave us nothing".
  return flat === "" ? "?" : flat;
};

/** The last two segments, so `…/modules/reviews/routes.ts` reads as `reviews/routes.ts`. */
const shortPath = (file: string) => file.split("/").slice(-2).join("/");

/** Locale-independent, so the node order is the same on every machine. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Total order — reach first, then the identity of the symbol. A partial order
 * over an unordered input is not deterministic, and a graph whose contents
 * reshuffle between two renders of the same PR reads as a bug. (Where the
 * circles land is the simulation's business and is not stable by design.)
 */
const byReach = (a: BlastSymbol, b: BlastSymbol) =>
  b.caller_count - a.caller_count ||
  b.endpoint_count - a.endpoint_count ||
  cmp(a.name, b.name) ||
  cmp(a.file, b.file) ||
  a.line - b.line;

/**
 * A node id. NUL is the separator because it is the one character a path, a
 * symbol name and an endpoint label cannot contain — joining on `:` lets two
 * different nodes collide into one, and a collision here silently drops an edge
 * rather than failing.
 */
const key = (...parts: (string | number)[]) => parts.join("\u0000");

export function toGraph(view: BlastRadiusView): BlastGraph {
  // A symbol nothing calls has no downstream, so it has no edge and would drift
  // off alone under a force layout. The tree above still lists it.
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
    return { nodes: [], links: [], shown: { symbols: 0, callers: 0, endpoints: 0 }, total };
  }

  const nodes = new Map<string, BlastNode>();
  // A Set of `source\0target`, because the same caller reaches the same endpoint
  // through more than one symbol on any real PR; a duplicate link is drawn twice
  // over itself and pulls the simulation harder for no reason.
  const links = new Map<string, BlastLink>();
  /** Distinct endpoint circles drawn so far — the budget below spends these. */
  let drawnEndpoints = 0;

  const node = (id: string, text: string, type: BlastNodeType) => {
    if (!nodes.has(id)) nodes.set(id, { id, label: label(text), type });
    return id;
  };
  const link = (source: string, target: string) => {
    links.set(key(source, target), { source, target });
  };

  for (const symbol of shownSymbols) {
    const symbolNode = node(
      key("s", symbol.file, symbol.line, symbol.name),
      symbol.name,
      "symbol",
    );

    const callerByFile = new Map<string, string>();
    for (const caller of symbol.callers.slice(0, GRAPH_CAPS.callersPerSymbol)) {
      const callerNode = node(
        key("c", caller.file, caller.line),
        `${shortPath(caller.file)}:${caller.line}`,
        "caller",
      );
      if (!callerByFile.has(caller.file)) callerByFile.set(caller.file, callerNode);
      link(symbolNode, callerNode);
    }

    for (const endpoint of symbol.endpoints) {
      const endpointKey = key("e", endpoint.file, endpoint.label);
      // The budget buys CIRCLES, not mentions: an endpoint already drawn costs
      // nothing to point another call site at, and that link is the part of the
      // answer worth having.
      if (!nodes.has(endpointKey) && drawnEndpoints >= GRAPH_CAPS.endpoints) continue;
      if (!nodes.has(endpointKey)) drawnEndpoints += 1;

      const endpointNode = node(endpointKey, endpoint.label, "endpoint");
      // An endpoint is a line in a file. When one of the call sites drawn above
      // sits in that same file, that is the route the change actually takes to
      // reach it; when none does, the endpoint came from further down the import
      // walk and only the symbol can honestly be joined to it.
      link(callerByFile.get(endpoint.file) ?? symbolNode, endpointNode);
    }
  }

  const drawn = [...nodes.values()];
  return {
    nodes: drawn,
    links: [...links.values()],
    shown: {
      symbols: drawn.filter((n) => n.type === "symbol").length,
      callers: drawn.filter((n) => n.type === "caller").length,
      endpoints: drawn.filter((n) => n.type === "endpoint").length,
    },
    total,
  };
}

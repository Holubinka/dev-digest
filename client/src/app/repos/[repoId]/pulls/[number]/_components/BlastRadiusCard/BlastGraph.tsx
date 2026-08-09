"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/lib/theme";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { BlastGraph as BlastGraphData, BlastNodeType } from "./toGraph";
import { s } from "./styles";

/**
 * The import is deferred into an effect rather than done with `next/dynamic`,
 * and both halves of that matter.
 *
 * Deferred, because `react-force-graph-2d` reaches for `window` and a `<canvas>`
 * at module scope: a `"use client"` component is still rendered on the server
 * for the initial HTML, so a plain top-level import fails the whole page, not
 * just this box. An effect never runs on the server.
 *
 * Not `next/dynamic`, because its wrapper is a plain function component and does
 * not forward a ref to what it loads — and the only way to reach this library's
 * link and charge forces is the instance (`d3Force`; there are no props for
 * them). Without them PR #12 settles into a knot with its labels on top of each
 * other, which is measured, not feared: it is what the first attempt drew.
 */
type ForceGraphComponent = React.ComponentType<Record<string, unknown>>;

/** The height the canvas occupies; the width follows the modal. */
const HEIGHT = 520;

/**
 * Fit padding, in screen pixels. Generous on purpose: `zoomToFit` measures NODE
 * positions, and a label is drawn under its node and can be far wider than it —
 * at 60 the outermost `test/reviews-helpers.test.ts:20` ran off the right edge
 * while its circle sat comfortably inside.
 */
const FIT_PADDING = 120;

/**
 * Circle radius per node type, in SCREEN pixels — every use divides by the zoom.
 * Graph units were tried first and fitting a wide answer then shrank every node
 * to a dot while the labels, which are already scale-compensated, stayed put.
 * A changed symbol is the subject, so it is the largest.
 */
const RADIUS: Record<BlastNodeType, number> = { symbol: 9, caller: 5.5, endpoint: 7 };

/**
 * What a node is drawn as. The canvas cannot read a CSS custom property —
 * `ctx.fillStyle = "var(--accent)"` silently paints nothing — so the tokens are
 * resolved to real colours at render time and re-resolved when the theme flips.
 */
const TOKEN: Record<BlastNodeType, string> = {
  symbol: "--accent",
  caller: "--text-muted",
  endpoint: "--ok",
};

type Palette = Record<BlastNodeType | "label" | "link", string>;

const FALLBACK: Palette = {
  symbol: "#3b82f6",
  caller: "#6a6a6a",
  endpoint: "#10b981",
  label: "#999999",
  link: "#2a2a2a",
};

function readPalette(): Palette {
  if (typeof window === "undefined") return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    symbol: token(TOKEN.symbol, FALLBACK.symbol),
    caller: token(TOKEN.caller, FALLBACK.caller),
    endpoint: token(TOKEN.endpoint, FALLBACK.endpoint),
    label: token("--text-secondary", FALLBACK.label),
    link: token("--border", FALLBACK.link),
  };
}

/**
 * The blast radius drawn as a force-directed graph: a changed symbol, the call
 * sites that reach it, and the endpoints those sit in.
 *
 * The data is decided in `toGraph.ts` and asserted there. This file owns only
 * the drawing, which is why it carries no logic worth a unit test — jsdom has no
 * canvas, so a test that mounts this proves the mock renders, nothing more.
 */
export function BlastGraph({ graph }: { graph: BlastGraphData }) {
  const t = useTranslations("blast");
  const { theme } = useTheme();
  const wrap = React.useRef<HTMLDivElement>(null);
  const fg = React.useRef<ForceGraphMethods | undefined>(undefined);
  const [ForceGraph2D, setForceGraph2D] = React.useState<ForceGraphComponent | null>(null);
  const [width, setWidth] = React.useState(0);
  const [palette, setPalette] = React.useState<Palette>(FALLBACK);

  // Browser-only by construction: an effect does not run during SSR.
  React.useEffect(() => {
    let live = true;
    import("react-force-graph-2d").then((m) => {
      if (live) setForceGraph2D(() => m.default as unknown as ForceGraphComponent);
    });
    return () => {
      live = false;
    };
  }, []);

  // Re-resolve on every theme flip: the tokens behind these names change, and a
  // canvas keeps whatever colour it was last painted with.
  React.useEffect(() => setPalette(readPalette()), [theme]);

  // The modal sizes itself, so the canvas has to be told how wide it may be.
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * `react-force-graph` MUTATES the objects it is handed — it writes `x`, `y`,
   * `vx`, `vy` onto every node and swaps each link's `source`/`target` string
   * for the node object. Handing it a freshly built array on each render would
   * restart the simulation and make the graph twitch, so it is built once per
   * distinct graph.
   */
  const data = React.useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ ...l })),
    }),
    [graph],
  );

  /**
   * PR #12 draws 24 nodes and 47 links, and 32 of those links are four call
   * sites fanning into the same eight routes. At the library's defaults that
   * settles into a knot with every endpoint label written over its neighbour.
   * Pushing the nodes apart and letting the links run long is what turns it back
   * into a map. Re-applied whenever the instance or the data changes, because
   * the forces are rebuilt with the simulation.
   */
  React.useEffect(() => {
    if (!ForceGraph2D) return;
    fg.current?.d3Force("link")?.distance(130);
    fg.current?.d3Force("charge")?.strength(-900);
    fg.current?.d3ReheatSimulation?.();
  }, [ForceGraph2D, data]);

  /**
   * A force layout has no idea where the edges of the canvas are — the first
   * draw pushed a node clean off the right-hand side — so the view is fitted
   * once the simulation settles.
   *
   * Fitting is left to decide the zoom on its own. Clamping it to a floor was
   * tried and reverted: forcing a minimum zoom pushed the dense half of the
   * graph off the left edge, and a map with a corner cut off is worse than a
   * small one.
   */
  const fit = React.useCallback(() => fg.current?.zoomToFit(400, FIT_PADDING), []);

  const paint = React.useCallback(
    (node: unknown, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as { x?: number; y?: number; label: string; type: BlastNodeType };
      if (n.x == null || n.y == null) return;
      const r = RADIUS[n.type] / scale;
      const colour = palette[n.type];

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colour;
      // The soft halo the reference design uses to separate a node from the
      // links passing behind it. Reset immediately — a live shadow would smear
      // every later stroke on the same context.
      ctx.shadowColor = colour;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Divided by the zoom, so the label keeps one apparent size instead of
      // growing into a billboard as the canvas scales.
      const fontSize = 11 / scale;
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = palette.label;
      ctx.fillText(n.label, n.x, n.y + r + 4 / scale);
    },
    [palette],
  );

  /**
   * Drawing the node ourselves means the library no longer knows where it is,
   * so hovering and dragging stop working unless the hit area is painted too.
   */
  const hitArea = React.useCallback(
    (node: unknown, colour: string, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as { x?: number; y?: number; type: BlastNodeType };
      if (n.x == null || n.y == null) return;
      // Divided by the zoom for the same reason the circle is, or the target
      // would drift away from the dot the moment the view is fitted.
      ctx.beginPath();
      ctx.arc(n.x, n.y, (RADIUS[n.type] + 2) / scale, 0, 2 * Math.PI);
      ctx.fillStyle = colour;
      ctx.fill();
    },
    [],
  );

  return (
    <div ref={wrap} style={s.graphCanvas}>
      {/* `role="img"` with a name, because a canvas is a picture with no
          readable contents at all — the node labels live in pixels. */}
      <div role="img" aria-label={t("graph.ariaLabel")}>
        {width > 0 && ForceGraph2D && (
          <ForceGraph2D
            ref={fg}
            graphData={data}
            width={width}
            height={HEIGHT}
            backgroundColor="rgba(0,0,0,0)"
            nodeCanvasObject={paint}
            nodePointerAreaPaint={hitArea}
            nodeLabel={() => ""}
            linkColor={() => palette.link}
            linkWidth={1}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            // Spread alone does not keep the graph inside the box: a force layout
            // has no idea where the edges of the canvas are, and the first draw
            // pushed a node clean off the right-hand side. Fitting once the
            // simulation settles is what guarantees the whole answer is visible.
            onEngineStop={fit}
            nodeRelSize={5}
            d3AlphaDecay={0.015}
            d3VelocityDecay={0.25}
            warmupTicks={60}
            cooldownTicks={160}
            enableNodeDrag
          />
        )}
      </div>

      <ul style={s.legend}>
        {(["symbol", "caller", "endpoint"] as const).map((type) => (
          <li key={type} style={s.legendItem}>
            <span style={{ ...s.legendDot, background: palette[type] }} />
            {t(`graph.legend.${type}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

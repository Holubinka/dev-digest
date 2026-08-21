"use client";

import React from "react";

let seq = 0;

/** Mermaid diagrams must start with a known graph keyword. Anything else
 *  (prose, JSON like {"type":"Buffer"...}, empty) is not a diagram → skip. */
const MERMAID_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;

function looksLikeMermaid(src: string): boolean {
  return MERMAID_RE.test(src.trim());
}

/**
 * Renders a mermaid diagram string to inline SVG. mermaid is imported lazily
 * (client-only). We VALIDATE with mermaid.parse({suppressErrors}) before
 * rendering — mermaid otherwise injects a "Syntax error" bomb graphic into the
 * DOM on bad input instead of throwing. Junk/unparseable input renders nothing.
 *
 * `onRendered` reports whether the chart actually drew, because "renders
 * nothing" is invisible to the caller: a non-empty string is not a diagram, and
 * a caption or a frame hung on `chart !== ""` outlives the diagram it belongs
 * to. It is called once per outcome, never while the parse is still in flight.
 */
export function MermaidDiagram({
  chart,
  onRendered,
}: {
  chart: string;
  onRendered?: (rendered: boolean) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"pending" | "ok" | "invalid">("pending");

  // Held in a ref rather than named as a dependency below: an inline callback
  // is a new function every render, and in the deps of the render effect that
  // is a re-parse per render — with a caller that sets state from it, a loop.
  const notify = React.useRef(onRendered);
  React.useEffect(() => {
    notify.current = onRendered;
  });

  React.useEffect(() => {
    if (state !== "pending") notify.current?.(state === "ok");
  }, [state]);

  React.useEffect(() => {
    let cancelled = false;
    const src = (chart ?? "").trim();
    if (!looksLikeMermaid(src)) {
      setState("invalid");
      return;
    }
    setState("pending");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        // parse first; suppressErrors → returns false (no throw, no DOM bomb).
        const valid = await mermaid.parse(src, { suppressErrors: true });
        if (cancelled) return;
        if (!valid) {
          setState("invalid");
          return;
        }
        const { svg } = await mermaid.render(`dd-mermaid-${seq++}`, src);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setState("ok");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  // Not a (valid) diagram → render nothing rather than a broken box.
  if (state === "invalid") return null;

  return (
    <div
      ref={ref}
      style={{
        display: state === "ok" ? "flex" : "none",
        justifyContent: "center",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        overflowX: "auto",
      }}
    />
  );
}

export default MermaidDiagram;

/* MetricBar — one metric cell in an eval batch table: the bar the mockups draw
   plus its percentage. Both eval screens' tables use it, which is why it sits
   at the `evals` segment rather than inside either one. */
"use client";

import React from "react";
import { ProgressBar } from "@devdigest/ui";
import { pct } from "../format";

export function MetricBar({
  value,
  color,
  label,
}: {
  value: number | null | undefined;
  color: string;
  /** Names the metric for a screen reader — three identical bars otherwise. */
  label: string;
}) {
  const n = pct(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 44 }} role="img" aria-label={`${label} ${n}%`}>
        <ProgressBar value={n} color={color} height={5} />
      </div>
      <span
        className="tnum"
        style={{ fontSize: 12.5, color: "var(--text-secondary)", minWidth: 34, textAlign: "right" }}
      >
        {n}%
      </span>
    </div>
  );
}

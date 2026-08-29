/* MetricCard — KPI tile: big value, signed delta, and an optional Sparkline. */
import React from "react";
import { Icon } from "../icons";
import { Sparkline } from "./Sparkline";

export function MetricCard({
  label,
  value,
  delta,
  color,
  trend,
  suffix,
  deltaGood = "up",
  deltaPrefix,
  corner,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number;
  color?: string;
  trend?: number[];
  suffix?: string;
  /**
   * WHICH DIRECTION IS GOOD NEWS. Defaults to "up", which is what every caller
   * before Agent Performance meant. Cost, latency and error counts are the other
   * kind: a falling cost drawn in `--crit` is not a styling preference, it is the
   * tile telling the reader the opposite of what happened.
   */
  deltaGood?: "up" | "down";
  /** Unit in front of the delta — "$" for money. The arrow already carries the sign. */
  deltaPrefix?: string;
  /**
   * Anything to put in the label row instead of the sparkline — a gauge, a badge.
   * `trend` is ignored when this is set: they are the same slot.
   */
  corner?: React.ReactNode;
}) {
  const up = (delta ?? 0) > 0;
  const flat = delta === 0;
  const favourable = up === (deltaGood === "up");
  const dc = flat ? "var(--text-muted)" : favourable ? "var(--ok)" : "var(--crit)";
  // The ARROW follows the direction the number moved; the COLOUR follows whether
  // that direction is good. On a cost tile they point opposite ways, and both
  // facts are ones the reader needs.
  const DeltaIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.03em",
          }}
        >
          {label}
        </span>
        {corner ?? (trend && <Sparkline data={trend} color={color || "var(--accent)"} w={56} h={20} />)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {value}
          {suffix && <span style={{ fontSize: 18, color: "var(--text-muted)" }}>{suffix}</span>}
        </span>
        {delta != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 13,
              fontWeight: 600,
              color: dc,
            }}
          >
            <DeltaIcon size={12} />
            <span className="tnum">
              {deltaPrefix}
              {Math.abs(delta).toFixed(2)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

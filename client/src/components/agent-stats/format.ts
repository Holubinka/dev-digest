/**
 * Formatters for the Agent Performance numbers.
 *
 * They live here, beside the panel two screens mount, rather than in either
 * screen's folder: the dashboard table and the agent's Stats tab render the same
 * `AgentPerfRow`, and AC-46 is a promise about what the reader SEES. Two copies
 * of "how do we round an accept rate" is the shape that promise breaks in.
 *
 * Cost and duration are deliberately NOT redefined here — `formatCost`
 * (`@/components/run-cost-badge/format`) and `formatSeconds`
 * (`@/components/run-trace-drawer/helpers`) already serve four surfaces each, and
 * a fifth spelling of a dollar is how the PR list and this screen start
 * disagreeing about the same run.
 */
import type { AgentPerfRow } from "@/lib/types";

/** Em-dash: "we have no number", never a real zero. */
export const NO_DATA = "—";

/** A 0..1 rate as whole percent, or the em-dash when there is no rate at all. */
export function formatRate(rate: number | null | undefined): string {
  return rate == null ? NO_DATA : `${Math.round(rate * 100)}%`;
}

/**
 * The colour an accept rate is drawn in — the mockup's green / amber.
 *
 * A threshold on the rate itself, not on a rank: an agent is not "the worst" for
 * being third out of three, and colouring by position would paint a workspace of
 * excellent agents in warning colours.
 */
export function acceptTone(rate: number | null | undefined): string {
  if (rate == null) return "var(--text-muted)";
  if (rate >= 0.6) return "var(--ok)";
  if (rate >= 0.4) return "var(--warn)";
  return "var(--crit)";
}

/**
 * Which way the accept rate moved against the preceding window — or nothing.
 *
 * `null` when either window has no rate: an arrow drawn against a window that
 * judged nothing is a claim about a change that was never measured.
 */
export function acceptTrend(row: AgentPerfRow): "up" | "down" | null {
  if (row.accept_rate == null || row.prev_accept_rate == null) return null;
  if (row.accept_rate > row.prev_accept_rate) return "up";
  if (row.accept_rate < row.prev_accept_rate) return "down";
  return null;
}

/** The window's own caption for a column header — "1D", "30D", "CUSTOM". */
export function periodShort(kind: string): string {
  return kind === "custom" ? "CUSTOM" : kind.toUpperCase();
}

/**
 * A date for a caption — no time of day.
 *
 * `"en"` and not `undefined`: the default is the BROWSER's locale, which puts
 * `1 січ.` inside an English sentence on a machine set to Ukrainian, and its
 * trailing abbreviation dot lands beside the sentence's own full stop. This app
 * serves one locale (`src/i18n/request.ts`), and that constant cannot be
 * imported here — the module reads `node:fs` at load, which would follow it into
 * the client bundle.
 */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? NO_DATA
    : d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** `<input type="date">` wants `YYYY-MM-DD`, and it wants it in local time. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

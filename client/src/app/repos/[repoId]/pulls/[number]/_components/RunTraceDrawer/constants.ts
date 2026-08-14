/** Constants for the Run Trace + Live Log drawer (A5). */

import type { ContextDocStatus } from "@/lib/types";

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** Prompt-assembly block accent colours (by leg), in the order they assemble. */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  prDescription: "var(--info)",
  intent: "var(--accent-text)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  specs: "var(--text-secondary)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;

/**
 * Per-document outcome colours in the run trace. All six statuses are listed:
 * the enum has six, and a map with a default is the version that colours a
 * `refused` document the same as an included one.
 */
export const PROJECT_CONTEXT_STATUS_COLOR: Record<ContextDocStatus, string> = {
  included: "var(--ok)",
  truncated: "var(--warn)",
  dropped: "var(--warn)",
  missing: "var(--crit)",
  refused: "var(--crit)",
  binary: "var(--text-muted)",
};

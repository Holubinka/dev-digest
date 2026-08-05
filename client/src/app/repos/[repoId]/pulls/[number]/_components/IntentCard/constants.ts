import type { IconName } from "@devdigest/ui";
import type { IntentConfidence } from "@/lib/types";

/**
 * Risk areas are free-form model output — the server's `Intent` schema types
 * them `string[]` and nothing constrains the vocabulary.
 *
 * A `Map`, not an object literal: `"constructor" in OBJ` is true for eight
 * inherited keys, so an allowlist built that way is not one
 * (`client/INSIGHTS.md:594-618`). And an explicit `??` default, because a lookup
 * with no fallback resolving to `undefined` is what took the whole findings page
 * down on an unexpected `severity` (`:511-528`).
 */
const RISK_ICON = new Map<string, IconName>([
  ["security", "Shield"],
  ["auth", "Lock"],
  ["performance", "Zap"],
  ["data", "Database"],
  ["migration", "Database"],
  ["migrations", "Database"],
  ["api", "Code"],
  ["tests", "FlaskConical"],
  ["correctness", "Bug"],
]);

export const RISK_ICON_FALLBACK: IconName = "AlertTriangle";

export const riskIcon = (raw: string): IconName =>
  RISK_ICON.get(raw.trim().toLowerCase()) ?? RISK_ICON_FALLBACK;

/**
 * Confidence band → colours that already exist in the theme
 * (`vendor/ui/styles.css`). Deliberately NOT a new colour table:
 * `client/INSIGHTS.md:307-338` records what a second copy of `SEV` cost, and
 * `frontend-architecture` principle 6 forbids a third.
 *
 * A `Map` with a fallback for the same reason as `riskIcon` — `src/lib/api.ts`
 * does not validate at runtime, so a band outside the enum can reach here.
 */
const CONFIDENCE_COLOR = new Map<string, { color: string; bg: string }>([
  ["high", { color: "var(--accent-text)", bg: "var(--accent-bg)" }],
  ["medium", { color: "var(--text-secondary)", bg: "var(--bg-hover)" }],
  ["low", { color: "var(--text-muted)", bg: "var(--bg-hover)" }],
]);

export const confidenceColor = (band: IntentConfidence): { color: string; bg: string } =>
  CONFIDENCE_COLOR.get(band) ?? { color: "var(--text-muted)", bg: "var(--bg-hover)" };

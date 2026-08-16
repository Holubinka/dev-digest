import type { IntentConfidence } from "@/lib/types";

/**
 * Confidence band → colours that already exist in the theme
 * (`vendor/ui/styles.css`). Deliberately NOT a new colour table:
 * `client/INSIGHTS.md:307-338` records what a second copy of `SEV` cost, and
 * `frontend-architecture` principle 6 forbids a third.
 *
 * A `Map` with a fallback because `src/lib/api.ts` does not validate at runtime,
 * so a band outside the enum can reach here.
 *
 * `riskChip` used to live beside this and now lives in
 * `RiskAreas/constants.ts`: D18 removed the `intent.risk_areas` chip row, and
 * the same "free string → icon with an explicit fallback" shape is what AC-52
 * and AC-53 ask of `Risk.kind` on the brief's own risk rows.
 */
const CONFIDENCE_COLOR = new Map<string, { color: string; bg: string }>([
  ["high", { color: "var(--accent-text)", bg: "var(--accent-bg)" }],
  ["medium", { color: "var(--text-secondary)", bg: "var(--bg-hover)" }],
  ["low", { color: "var(--text-muted)", bg: "var(--bg-hover)" }],
]);

export const confidenceColor = (band: IntentConfidence): { color: string; bg: string } =>
  CONFIDENCE_COLOR.get(band) ?? { color: "var(--text-muted)", bg: "var(--bg-hover)" };

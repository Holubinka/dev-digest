import { SEV, type IconName, type Severity } from "@devdigest/ui";
/* `RiskSeverity` and `RiskBriefInputStatus` are the two names this card needs
   that `@/lib/types` does not re-export, so they come from the vendored contract
   directly — the same way `SmartDiffViewer.tsx` and `DiffTab.tsx` next door take
   `SmartDiff` and `PrFile`. Everything the re-export list does carry is imported
   from `@/lib/types`. */
import type { RiskBriefInputStatus, RiskSeverity } from "@devdigest/shared";

/**
 * Risk level → the vendored severity token that already carries that weight.
 *
 * NOT a fourth colour table. `client/INSIGHTS.md:307-338` records what a second
 * copy of `SEV` cost and `frontend-architecture` §6 forbids a third, so what
 * lives here is only the translation between two vocabularies — findings speak
 * `CRITICAL | WARNING | SUGGESTION`, a brief speaks `high | medium | low` — and
 * every colour still comes from `vendor/ui/primitives/tokens.ts`.
 */
const RISK_TOKEN: Record<RiskSeverity, Severity> = {
  high: "CRITICAL",
  medium: "WARNING",
  low: "SUGGESTION",
};

export interface RiskTone {
  color: string;
  bg: string;
  icon: IconName;
}

/**
 * `src/lib/api.ts` does not validate responses at runtime, so a level outside
 * the enum can reach here. `Object.hasOwn` rather than `in`: `in` walks the
 * prototype chain, and `"constructor" in RISK_TOKEN` is true — the hole that
 * `components/severity-badge/helpers.ts` was fixed for.
 */
export function riskTone(level: string): RiskTone {
  const token = SEV[Object.hasOwn(RISK_TOKEN, level) ? RISK_TOKEN[level as RiskSeverity] : "INFO"];
  return { color: token.c, bg: token.bg, icon: token.icon };
}

/**
 * Input status → its message key, or `null` for a value the contract does not
 * carry. next-intl THROWS on a missing key, which would take the whole card
 * down over one unexpected string from an unvalidated response; the caller
 * renders the raw value instead (the same guard `SmartDiffViewer`'s `chipFor`
 * exists for).
 */
const STATUS_KEY: Record<RiskBriefInputStatus, string> = {
  included: "riskBrief.status.included",
  truncated: "riskBrief.status.truncated",
  dropped: "riskBrief.status.dropped",
  missing: "riskBrief.status.missing",
};

export function statusKey(status: string): string | null {
  return Object.hasOwn(STATUS_KEY, status) ? STATUS_KEY[status as RiskBriefInputStatus] : null;
}

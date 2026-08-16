import { SEV, type IconName, type Severity } from "@devdigest/ui";
/* `RiskSeverity` is the one name this section needs that `@/lib/types` does not
   re-export, so it comes from the vendored contract directly — the same way
   `SmartDiffViewer.tsx` and `DiffTab.tsx` take `SmartDiff` and `PrFile`. */
import type { RiskSeverity } from "@devdigest/shared";

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
 * `Risk.kind` is free-form model output — the server's `Risk` schema types it
 * `z.string()` and nothing constrains the vocabulary. Real runs return phrases,
 * not keywords: "public API", "client-server contract", "Conventions extraction
 * pipeline (model hallucination, quote verification gates)". An exact-match
 * lookup fired on "performance" and "tests" and sent every other value to the
 * fallback, which is why the row wore one triangle after another.
 *
 * So: ordered rules over the lowercased phrase, first match wins. Order is
 * precedence — "security: auth bypass in the API" is a security icon, not an
 * API one. Patterns are authored regexes rather than assembled from strings, so
 * there is no escaping step to get wrong, and matching against a rule list
 * cannot resolve `constructor` or `__proto__` the way `"key" in OBJ` does
 * (`client/INSIGHTS.md:594-618`). The `??` default stays for the reason it was
 * added: a lookup resolving to `undefined` is what took the whole findings page
 * down on an unexpected `severity` (`:511-528`).
 *
 * Each rule is two alternations, and the split is the load-bearing part. Terms
 * that inflect are **prefixes with no closing `\b`** — `\bconfig` has to cover
 * "configuration", `\borchestrat` matches nothing at all with one. Only the short
 * acronyms get `\b…\b`, because `ui` unanchored is inside "building" and `db` is
 * inside "dbeaver".
 *
 * It moved here from `IntentCard/constants.ts` with D18: the intent's own
 * `risk_areas` chip row is gone, and the same "free string → icon with an
 * explicit fallback" shape is what AC-52 and AC-53 ask of `Risk.kind`.
 */
/**
 * Only two families carry a tint, and the restraint is the whole point: colour
 * here means "read this one first", and a row where every icon is coloured says
 * nothing at all. Security and data loss are the irreversible classes — a slow
 * endpoint is recoverable, a dropped column is not.
 *
 * The values are the theme's own severity tokens, the same ones `SEV` uses
 * (`vendor/ui/primitives/tokens.ts`), not a new palette:
 * `client/INSIGHTS.md:307-338` records what a second copy of `SEV` cost, and
 * `frontend-architecture` principle 6 forbids a third. `neutral` restates
 * `Badge`'s own defaults so a chip never has to be rendered without them.
 */
type ChipTone = "danger" | "caution" | "neutral";

const TONE: Record<ChipTone, { color: string; bg: string }> = {
  danger: { color: "var(--crit)", bg: "var(--crit-bg)" },
  caution: { color: "var(--warn)", bg: "var(--warn-bg)" },
  neutral: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

const RISK_RULES: ReadonlyArray<readonly [RegExp, IconName, ChipTone]> = [
  [/\b(secur|vulnerab|inject|traversal|auth|permission|tenant)|\b(xss|csrf|ssrf)\b/, "Shield", "danger"],
  // Before the credential rule, and that order is the whole point: `token` there
  // matches "token budget" literally, so a risk about how much of the prompt an
  // input may occupy rendered as a padlock in the critical tone — the icon for a
  // leaked secret. Observed on live data 2026-08-17, where `kind: "token budget"`
  // was one of six risks on PR #20. A budget is a size, and every word here names
  // a size or a rate, never a secret.
  [/\b(budget|quota|rate limit|throttl|ceiling)|\b(cap|caps)\b/, "Gauge", "caution"],
  [/\b(secret|credential|token|password)/, "Lock", "danger"],
  [/\b(perf|latenc|slow|round-?trip|throughput|memor|cach)/, "Zap", "neutral"],
  [/\b(migration|schema|database|quer|postgres|data loss)|\b(db|sql|index)\b/, "Database", "caution"],
  [/\b(contract|endpoint|payload|route)|\b(api|http)\b/, "Code", "neutral"],
  [/\b(depend|packag|upgrade|librar)/, "Boxes", "neutral"],
  [/\b(test|coverage|fixture|flake)/, "FlaskConical", "neutral"],
  [/\b(network|webhook)|\b(url|cors|origin)\b/, "Globe", "neutral"],
  [/\b(layout|render|styl|component|overflow|page)|\b(ui|css)\b/, "Layers", "neutral"],
  [/\b(pipeline|workflow|orchestrat|queue)|\b(cron|job)\b/, "Workflow", "neutral"],
  [/\b(config|setting|flag)|\benv\b/, "Wrench", "neutral"],
  [/\b(correctness|logic|off-by-one|bug|edge case)/, "Bug", "neutral"],
];

export const RISK_ICON_FALLBACK: IconName = "AlertTriangle";

export interface RiskChip {
  icon: IconName;
  color: string;
  bg: string;
}

/** Icon and tone come from the same rule, so they are resolved in one pass. */
export const riskChip = (raw: string): RiskChip => {
  const rule = RISK_RULES.find(([pattern]) => pattern.test(raw.trim().toLowerCase()));
  return {
    icon: rule?.[1] ?? RISK_ICON_FALLBACK,
    ...TONE[rule?.[2] ?? "neutral"],
  };
};

/**
 * How many risk rows stand open before the rest go behind a disclosure.
 *
 * The server caps `risks` at 12 (`server/src/modules/brief/constants.ts`), and
 * the NFR the amendment cites shows 5 — so the overflow branch is reachable
 * through the API today, unlike the review-focus one.
 */
export const RISKS_SHOWN = 5;

import type { IconName } from "@devdigest/ui";
import type { IntentConfidence } from "@/lib/types";

/**
 * Risk areas are free-form model output — the server's `Intent` schema types
 * them `string[]` and nothing constrains the vocabulary. Real runs return
 * phrases, not keywords: "public API", "client-server contract", "Conventions
 * extraction pipeline (model hallucination, quote verification gates)". An
 * exact-match lookup fired on "performance" and "tests" and sent every other
 * chip to the fallback, which is why the row wore one triangle after another.
 *
 * So: ordered rules over the lowercased phrase, first match wins. Order is
 * precedence — "security: auth bypass in the API" is a security chip, not an
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
 */
/**
 * Only two families carry a tint, and the restraint is the whole point: colour
 * here means "read this one first", and a row where every chip is coloured says
 * nothing at all. Security and data loss are the irreversible classes — a slow
 * endpoint is recoverable, a dropped column is not.
 *
 * The values are the theme's own severity tokens, the same ones `SEV` uses
 * (`vendor/ui/primitives/tokens.ts`), not a new palette:
 * `client/INSIGHTS.md:307-338` records what a second copy of `SEV` cost, and
 * `frontend-architecture` principle 6 forbids a third. `neutral` restates
 * `Badge`'s own defaults so a chip never has to be rendered without them.
 */
type RiskTone = "danger" | "caution" | "neutral";

const TONE: Record<RiskTone, { color: string; bg: string }> = {
  danger: { color: "var(--crit)", bg: "var(--crit-bg)" },
  caution: { color: "var(--warn)", bg: "var(--warn-bg)" },
  neutral: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

const RISK_RULES: ReadonlyArray<readonly [RegExp, IconName, RiskTone]> = [
  [/\b(secur|vulnerab|inject|traversal|auth|permission|tenant)|\b(xss|csrf|ssrf)\b/, "Shield", "danger"],
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
 * Confidence band → colours that already exist in the theme
 * (`vendor/ui/styles.css`). Deliberately NOT a new colour table:
 * `client/INSIGHTS.md:307-338` records what a second copy of `SEV` cost, and
 * `frontend-architecture` principle 6 forbids a third.
 *
 * A `Map` with a fallback for the same reason as `riskChip` — `src/lib/api.ts`
 * does not validate at runtime, so a band outside the enum can reach here.
 */
const CONFIDENCE_COLOR = new Map<string, { color: string; bg: string }>([
  ["high", { color: "var(--accent-text)", bg: "var(--accent-bg)" }],
  ["medium", { color: "var(--text-secondary)", bg: "var(--bg-hover)" }],
  ["low", { color: "var(--text-muted)", bg: "var(--bg-hover)" }],
]);

export const confidenceColor = (band: IntentConfidence): { color: string; bg: string } =>
  CONFIDENCE_COLOR.get(band) ?? { color: "var(--text-muted)", bg: "var(--bg-hover)" };

/**
 * cost discipline — per-provider/model pricing table (USD per 1M tokens).
 * Unknown models return null cost (explicitly flagged), per spec.
 */
interface Price {
  in: number;
  out: number;
}

const PRICING: Record<string, Price> = {
  // OpenAI (approximate public list prices, USD / 1M tokens)
  'gpt-5.5': { in: 5.0, out: 30.0 },
  'gpt-5.4': { in: 2.5, out: 15.0 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-5.4-nano': { in: 0.2, out: 1.25 },
  'gpt-5.1': { in: 1.25, out: 10.0 },
  'gpt-5': { in: 1.25, out: 10.0 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  // Anthropic
  'claude-3-5-sonnet-latest': { in: 3.0, out: 15.0 },
  'claude-3-5-haiku-latest': { in: 0.8, out: 4.0 },
  'claude-3-opus-latest': { in: 15.0, out: 75.0 },
  // OpenRouter (CI runner, cheap models). The four slugs below were confirmed
  // against https://openrouter.ai/api/v1/models on 2026-08-05; the rest of this
  // block remains approximate and must be checked there before relying on cost.
  // Unknown slugs fall through to null cost (explicitly flagged), which is safe.
  // NOTE: `z-ai/glm-4.7-flash` was carried here as `{ in: 0, out: 0 }` labelled
  // "free baseline for evals" — Z.AI's "free tier" is a PRODUCT tier, not a
  // price, and the model has never been free on OpenRouter. A zero here is a
  // lie rather than a null, so it is the one number worth stating a date on.
  'z-ai/glm-4.7-flash': { in: 0.06, out: 0.4 }, // confirmed 2026-08-05
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 }, // confirmed 2026-08-05
  'minimax/minimax-m2.5': { in: 0.22, out: 0.9 }, // confirmed 2026-08-05
  'z-ai/glm-5.1': { in: 0.6, out: 2.2 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

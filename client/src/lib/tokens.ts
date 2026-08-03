/**
 * Rough token count for a block of prompt text: `ceil(chars / 4)`.
 *
 * Approximate on purpose. It is the same heuristic the server's tokenizer falls
 * back to when the BPE ranks fail to load, and it exists to answer "roughly how
 * much is this costing me" at a glance. The exact number for the skills slot is
 * printed in a run's Live Log, counted server-side with the real encoder.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

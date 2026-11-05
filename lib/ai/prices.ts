// USD per million tokens, Claude API list prices (Nov 2026). Cache writes are the 5-minute kind.
// Opus 5.5 reads cache at 0.05× input; the others at 0.1×. Haiku 5.5 is priced for prompts ≤ 100K tokens.
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Token counts as stored in `ai.call` payloads. */
export type TokenUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

/** API usage objects (snake_case) to the `ai.call` shape. */
export function tokenUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): TokenUsage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

/** USD for one call; undefined for a model without a price (so totals don't silently read 0). */
export function callCost(model: string, usage: TokenUsage): number | undefined {
  const p = MODEL_PRICES[model];
  if (!p) return undefined;
  return (
    (usage.input * p.input + usage.output * p.output + (usage.cacheRead ?? 0) * p.cacheRead + (usage.cacheWrite ?? 0) * p.cacheWrite) /
    1e6
  );
}

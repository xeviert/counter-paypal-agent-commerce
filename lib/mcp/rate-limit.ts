import type { Agent } from "./agent";

// In-memory sliding windows: one web instance (render.yaml), and the MCP server is rebuilt per
// request, so the limiter lives on globalThis. Lost on restart, which is fine for abuse limits.

export type Limit = { key: string; max: number; windowMs: number };

export type RateDecision = { ok: true } | { ok: false; retryAfterMs: number };

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private checks = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Counts the call against every limit only if all of them allow it. */
  check(limits: readonly Limit[]): RateDecision {
    const now = this.now();
    if (++this.checks % 1000 === 0) this.prune(now);
    let retryAfterMs = 0;
    for (const limit of limits) {
      const recent = this.recent(limit, now);
      if (recent.length >= limit.max) retryAfterMs = Math.max(retryAfterMs, recent[0]! + limit.windowMs - now);
    }
    if (retryAfterMs > 0) return { ok: false, retryAfterMs };
    for (const limit of limits) this.recent(limit, now).push(now);
    return { ok: true };
  }

  private recent(limit: Limit, now: number): number[] {
    const kept = (this.hits.get(limit.key) ?? []).filter((t) => t > now - limit.windowMs);
    this.hits.set(limit.key, kept);
    return kept;
  }

  private prune(now: number) {
    const longestWindow = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= now - longestWindow)) this.hits.delete(key);
    }
  }
}

export const LIMITS = {
  agent: { max: 120, windowMs: 60_000 },
  // Loose on purpose: every claude.ai connector user arrives from Anthropic's egress IPs.
  ip: { max: 600, windowMs: 60_000 },
  checkout: { max: 20, windowMs: 10 * 60_000 },
  // Each offer can be a Claude call; lib/shop/offers.ts also caps offers per product.
  offer: { max: 10, windowMs: 10 * 60_000 },
  question: { max: 30, windowMs: 3600_000 },
} as const;

const TOOL_LIMITS: Record<string, keyof typeof LIMITS> = {
  create_checkout: "checkout",
  make_offer: "offer",
  ask_question: "question",
};

export function limitsFor(tool: string, agent: Pick<Agent, "agentId" | "ip">): Limit[] {
  const limits: Limit[] = [
    { key: `agent:${agent.agentId}`, ...LIMITS.agent },
    { key: `ip:${agent.ip}`, ...LIMITS.ip },
  ];
  const extra = TOOL_LIMITS[tool];
  if (extra) limits.push({ key: `${extra}:${agent.agentId}`, ...LIMITS[extra] });
  return limits;
}

const globalForLimiter = globalThis as unknown as { mcpRateLimiter?: RateLimiter };

export function mcpRateLimiter(): RateLimiter {
  globalForLimiter.mcpRateLimiter ??= new RateLimiter();
  return globalForLimiter.mcpRateLimiter;
}

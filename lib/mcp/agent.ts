import { createHash } from "node:crypto";

export type Agent = {
  /** Stable per caller (IP + User-Agent), used for logs and rate limits. Not an identity. */
  agentId: string;
  ip: string;
  userAgent: string;
  /** One `agentId` for many people: hosted assistants call from their vendor's IPs (BUILDOUT §8.2). */
  shared: boolean;
};

const SHARED_EGRESS_UA = /\b(Claude-User|ChatGPT-User|Perplexity-User)\b/i;

// MCP 2026-07-28 removed Mcp-Session-Id, so callers are keyed by network identity instead.
// Render sits behind Cloudflare (checked Oct 31): X-Forwarded-For arrives as
// "<client-supplied...>, <client>, <Cloudflare edge>" and Cloudflare sets True-Client-IP to <client>.
// So the rightmost hop is the edge, shared by many callers; the one before it is the client.
// A single entry (local, no proxy) is used as-is.
export function clientIp(headers: Headers | undefined): string {
  const hops = headers?.get("x-forwarded-for")?.split(",").map((hop) => hop.trim()) ?? [];
  const forwarded = hops.length > 1 ? hops.at(-2) : hops[0];
  return headers?.get("true-client-ip")?.trim() || forwarded || "unknown";
}

export function agentFromRequest(request: Request | undefined): Agent {
  const ip = clientIp(request?.headers);
  const userAgent = request?.headers.get("user-agent") ?? "unknown";
  const digest = createHash("sha256").update(`${ip}|${userAgent}`).digest("base64url");
  return { agentId: `agt_${digest.slice(0, 16)}`, ip, userAgent, shared: SHARED_EGRESS_UA.test(userAgent) };
}

import { createHash } from "node:crypto";

export type Agent = {
  /** Stable per caller (IP + User-Agent), used for logs and rate limits. Not an identity. */
  agentId: string;
  ip: string;
  userAgent: string;
};

// MCP 2026-07-28 removed Mcp-Session-Id, so callers are keyed by network identity instead.
// Rightmost X-Forwarded-For is the hop our proxy added; the left entries are client-controlled.
// TODO(4.3 deploy): confirm which header Render populates with the real client IP.
export function agentFromRequest(request: Request | undefined): Agent {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = forwarded || "unknown";
  const userAgent = request?.headers.get("user-agent") ?? "unknown";
  const digest = createHash("sha256").update(`${ip}|${userAgent}`).digest("base64url");
  return { agentId: `agt_${digest.slice(0, 16)}`, ip, userAgent };
}

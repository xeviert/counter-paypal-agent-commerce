import { describe, expect, it } from "vitest";
import { agentFromRequest } from "./agent";

const request = (headers: Record<string, string>) => new Request("https://counter.test/api/mcp", { headers });

describe("agentFromRequest", () => {
  it("uses True-Client-IP when Cloudflare sets it", () => {
    const agent = agentFromRequest(
      request({ "true-client-ip": "86.192.198.157", "x-forwarded-for": "86.192.198.157, 104.22.72.29" }),
    );
    expect(agent.ip).toBe("86.192.198.157");
  });

  it("skips the Cloudflare edge hop and ignores client-supplied entries", () => {
    const agent = agentFromRequest(request({ "x-forwarded-for": "1.2.3.4, 86.192.198.157, 104.22.72.29" }));
    expect(agent.ip).toBe("86.192.198.157");
  });

  it("uses a single entry as-is", () => {
    expect(agentFromRequest(request({ "x-forwarded-for": "203.0.113.9" })).ip).toBe("203.0.113.9");
  });

  it("marks hosted assistants that share their vendor's IPs", () => {
    expect(agentFromRequest(request({ "user-agent": "Claude-User (claude-code/2.0; +https://support.anthropic.com/)" })).shared).toBe(true);
    expect(agentFromRequest(request({ "user-agent": "Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0" })).shared).toBe(true);
    expect(agentFromRequest(request({ "user-agent": "my-agent/1.0" })).shared).toBe(false);
  });

  it("gives callers behind the same edge different agentIds", () => {
    const a = agentFromRequest(request({ "x-forwarded-for": "198.51.100.1, 104.22.72.29", "user-agent": "x" }));
    const b = agentFromRequest(request({ "x-forwarded-for": "198.51.100.2, 104.22.72.29", "user-agent": "x" }));
    expect(a.agentId).not.toBe(b.agentId);
  });
});

import { connection } from "next/server";
import { log } from "@/lib/log";
import { agentFromRequest } from "@/lib/mcp/agent";
import { mcpHandler } from "@/lib/mcp/handler";

async function handle(request: Request) {
  await connection();
  const response = await mcpHandler.fetch(request);
  const { ip, agentId } = agentFromRequest(request);
  log.info("mcp request", {
    method: request.method,
    status: response.status,
    protocol: request.headers.get("mcp-protocol-version"),
    userAgent: request.headers.get("user-agent"),
    ip,
    agentId,
    // Raw chain + Cloudflare's header, to check which hop agentFromRequest should trust (BUILDOUT §4.4).
    forwardedFor: request.headers.get("x-forwarded-for"),
    trueClientIp: request.headers.get("true-client-ip"),
  });
  return response;
}

export { handle as GET, handle as POST, handle as DELETE };

import { connection } from "next/server";
import { log } from "@/lib/log";
import { mcpHandler } from "@/lib/mcp/handler";

async function handle(request: Request) {
  await connection();
  const response = await mcpHandler.fetch(request);
  log.info("mcp request", {
    method: request.method,
    status: response.status,
    protocol: request.headers.get("mcp-protocol-version"),
    userAgent: request.headers.get("user-agent"),
  });
  return response;
}

export { handle as GET, handle as POST, handle as DELETE };

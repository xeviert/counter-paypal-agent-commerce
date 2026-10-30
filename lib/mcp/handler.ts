import { createMcpHandler } from "@modelcontextprotocol/server";
import { log } from "@/lib/log";
import { createMcpServer, type McpDeps } from "./server";

// legacy: "stateless" serves 2025-era clients (initialize handshake) per request alongside 2026-07-28 clients.
export function buildMcpHandler(deps?: McpDeps) {
  return createMcpHandler((ctx) => createMcpServer(ctx, deps), {
    legacy: "stateless",
    onerror: (err) => log.error("mcp handler error", { err }),
  });
}

export const mcpHandler = buildMcpHandler();

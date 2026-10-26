import { createMcpHandler } from "@modelcontextprotocol/server";
import { log } from "@/lib/log";
import { createMcpServer } from "./server";

// legacy: "stateless" serves 2025-era clients (initialize handshake) per request alongside 2026-07-28 clients.
export const mcpHandler = createMcpHandler(createMcpServer, {
  legacy: "stateless",
  onerror: (err) => log.error("mcp handler error", { err }),
});

import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { log } from "@/lib/log";
import { agentFromRequest } from "./agent";

const pingOutput = z.object({
  ok: z.literal(true),
  server: z.literal("counter"),
  era: z.enum(["legacy", "modern"]),
  agentId: z.string(),
  time: z.string(),
});

/** Built fresh for every HTTP request (stateless; see createMcpHandler). */
export function createMcpServer(ctx: McpRequestContext): McpServer {
  const agent = agentFromRequest(ctx.requestInfo);
  const server = new McpServer({ name: "counter", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Connectivity check. Returns the server name and time. Takes no arguments and has no side effects.",
      inputSchema: z.object({}),
      outputSchema: pingOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const output = {
        ok: true as const,
        server: "counter" as const,
        era: ctx.era,
        agentId: agent.agentId,
        time: new Date().toISOString(),
      };
      log.info("mcp tool call", { tool: "ping", agentId: agent.agentId, era: ctx.era });
      return { content: [{ type: "text", text: `pong from counter at ${output.time}` }], structuredContent: output };
    },
  );

  return server;
}

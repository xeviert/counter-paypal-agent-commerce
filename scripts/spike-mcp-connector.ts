// Spike 4: Claude calls our MCP server through the Messages API MCP connector.
// Usage: pnpm spike:mcp https://<public host>   (needs ANTHROPIC_API_KEY)
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const base = process.argv[2]?.replace(/\/+$/, "");
if (!base?.startsWith("https://")) {
  console.error("usage: pnpm spike:mcp https://<public host>");
  process.exit(1);
}

const client = new Anthropic();
const response = await client.beta.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 4000,
  betas: ["mcp-client-2025-11-20"],
  mcp_servers: [{ type: "url", name: "counter", url: `${base}/api/mcp` }],
  tools: [{ type: "mcp_toolset", mcp_server_name: "counter" }],
  messages: [{ role: "user", content: "Call the counter ping tool once and tell me exactly what it returned." }],
});

for (const block of response.content) {
  if (block.type === "mcp_tool_use") console.log(`mcp_tool_use: ${block.server_name}.${block.name} ${JSON.stringify(block.input)}`);
  else if (block.type === "mcp_tool_result")
    console.log(`mcp_tool_result (is_error=${block.is_error}): ${typeof block.content === "string" ? block.content : block.content.map((c) => c.text).join("")}`);
  else if (block.type === "text") console.log(`text: ${block.text}`);
}
console.log(`stop_reason=${response.stop_reason} input_tokens=${response.usage.input_tokens} output_tokens=${response.usage.output_tokens}`);

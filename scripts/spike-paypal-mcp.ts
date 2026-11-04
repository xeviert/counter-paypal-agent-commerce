// BUILDOUT §7.4 operator copilot spike: Claude reaches PayPal's sandbox MCP through the Messages API
// MCP connector with the platform token. Prints the tool listing and one list_transactions call.
// Usage: pnpm spike:paypal-mcp [--path /sse|/http] [--prompt "…"]
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { getAccessToken } = await import("@/lib/paypal/client");

const { values } = parseArgs({
  options: {
    path: { type: "string", default: "/sse" },
    prompt: { type: "string", default: "Using PayPal, list this account's transactions from the last 7 days. Report how many there are and the total of any partner/platform fees." },
  },
});

const client = new Anthropic();
const response = await client.beta.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 8000,
  betas: ["mcp-client-2025-11-20"],
  output_config: { effort: "low" },
  mcp_servers: [
    { type: "url", name: "paypal", url: `https://mcp.sandbox.paypal.com${values.path}`, authorization_token: await getAccessToken() },
  ],
  tools: [{ type: "mcp_toolset", mcp_server_name: "paypal" }],
  messages: [{ role: "user", content: values.prompt }],
});

for (const block of response.content) {
  if (block.type === "mcp_tool_listing") console.log(`tools (${block.tools.length}): ${block.tools.map((t) => t.name).join(", ")}`);
  else if (block.type === "mcp_tool_use") console.log(`mcp_tool_use: ${block.name} ${JSON.stringify(block.input)}`);
  else if (block.type === "mcp_tool_result") {
    const text = typeof block.content === "string" ? block.content : block.content.map((c) => c.text).join("");
    console.log(`mcp_tool_result (is_error=${block.is_error}): ${text.slice(0, 1500)}`);
  } else if (block.type === "text") console.log(`text: ${block.text}`);
}
console.log(`stop_reason=${response.stop_reason} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);

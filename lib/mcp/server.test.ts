import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpHandler } from "./handler";

const url = new URL("http://counter.test/api/mcp");

// Routes the client's HTTP calls straight into the handler, the way the Next route does.
const inProcessFetch = (input: string | URL | Request, init?: RequestInit) =>
  mcpHandler.fetch(new Request(input, init));

async function connect(era: "legacy" | "modern", userAgent = "test-agent/1.0") {
  const client = new Client(
    { name: "counter-test", version: "0.0.0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: inProcessFetch,
    requestInit: { headers: { "user-agent": userAgent, "x-forwarded-for": "203.0.113.9" } },
  });
  await client.connect(transport);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe.each(["legacy", "modern"] as const)("MCP endpoint (%s era)", (era) => {
  it("lists the ping tool", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const client = await connect(era);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["ping"]);
    expect(tools[0]?.outputSchema).toBeDefined();
    await client.close();
  });

  it("calls ping and returns structured content", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const client = await connect(era);
    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ ok: true, server: "counter", era });
    await client.close();
  });
});

describe("agent identity", () => {
  it("is stable per caller and differs between callers", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const agentId = async (ua: string) => {
      const client = await connect("modern", ua);
      const result = await client.callTool({ name: "ping", arguments: {} });
      await client.close();
      return (result.structuredContent as { agentId: string }).agentId;
    };
    const a1 = await agentId("claude-connector/1");
    const a2 = await agentId("claude-connector/1");
    const b = await agentId("chatgpt/1");
    expect(a1).toMatch(/^agt_[\w-]{16}$/);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});

describe("MCP endpoint without a session", () => {
  it("serves a 2025-era tools/call with no Mcp-Session-Id", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await mcpHandler.fetch(
      new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(await response.text()).toContain('"server":"counter"');
  });
});

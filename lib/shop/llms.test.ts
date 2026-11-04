import { describe, expect, it } from "vitest";
import { TOOL_INFO } from "@/lib/mcp/tools";
import { llmsTxt } from "./llms";

describe("llmsTxt", () => {
  const text = llmsTxt("https://counter.test");

  it("lists every shop tool and the MCP URL", () => {
    expect(text.startsWith("# Counter\n")).toBe(true);
    expect(text).toContain("https://counter.test/api/mcp");
    for (const tool of TOOL_INFO) expect(text).toContain(`- ${tool.name} (${tool.title}): `);
    expect(text).not.toMatch(/\bping\b/);
  });

  it("says a human approves every payment on PayPal", () => {
    expect(text).toContain("A human approves every payment on PayPal");
    expect(text).toContain("https://counter.test/feed.json");
    expect(text).toContain("https://counter.test/api/acp/checkout_sessions");
    expect(text).not.toContain("Sample product");
  });
});

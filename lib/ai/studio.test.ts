import type { AgAiEvent } from "ag-studio";
import { describe, expect, it } from "vitest";
import type { StudioTurnRequest } from "@/lib/schemas/studio";
import { sseAnthropic } from "@/test/anthropic-sse";
import { pickModel, runStudioTurn, StreamTranslator, toAnthropicParams, toMessages } from "./studio";

const maker = { language: "es", today: "2026-11-03" };
const user = (text: string) => ({ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });
const call = (callId: string, args = "{}") => ({ id: callId, kind: "output", type: "function_call", callId, name: "view_report", arguments: args });
const result = (callId: string, output = "ok") => ({ type: "function_call_output", callId, output, status: "completed" });
const reply = (text: string) => ({
  id: "a",
  kind: "output",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "text", text, annotations: [] }],
});

const request = (patch: Partial<StudioTurnRequest> = {}): StudioTurnRequest => ({
  input: [user("Muéstrame mis ventas por país")],
  responseFormat: { type: "text" },
  ...patch,
});

describe("toAnthropicParams", () => {
  it("puts Counter's note first, then the maker's language and date, then Studio's instructions", () => {
    const params = toAnthropicParams(
      request({ instructions: "You are the lead agent.", input: [{ ...user("x"), role: "system", content: [{ type: "text", text: "Page: sales" }] }, user("hola")] }),
      maker,
    );
    const system = params.system as { text: string; cache_control?: unknown }[];
    expect(system[0]!.text).toContain("Counter's maker app");
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[1]!.text).toBe("App language (fallback only): es. Today in the maker's time zone: 2026-11-03.");
    expect(system.slice(2).map((s) => s.text)).toEqual(["You are the lead agent.", "Page: sales"]);
    expect(params.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hola" }] }]);
  });

  it("keeps client tools only, caches the last one, and turns a forced choice into an instruction", () => {
    const tools = [
      { name: "view_report", description: "Read the report", parameters: { type: "object", properties: {} } },
      { name: "web", description: "hosted", parameters: {}, kind: "provided" as const },
      { name: "add_widget", description: "Add a widget", parameters: { type: "object", properties: { type: { type: "string" } } } },
    ];
    const params = toAnthropicParams(request({ tools, toolChoice: { name: "add_widget" } }), maker);
    expect(params.tools!.map((t) => ("name" in t ? t.name : ""))).toEqual(["view_report", "add_widget"]);
    expect(params.tools!.at(-1)).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(params.tool_choice).toBeUndefined();
    expect((params.system as { text: string }[]).at(-1)!.text).toBe("Answer this turn by calling the add_widget tool.");
    expect(toAnthropicParams(request({ tools, toolChoice: "none" }), maker).tool_choice).toEqual({ type: "none" });
  });

  it("asks for structured output when Studio wants JSON", () => {
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
    const params = toAnthropicParams(request({ responseFormat: { type: "json", name: "title", schema } }), maker);
    expect(params.output_config).toEqual({ format: { type: "json_schema", schema } });
  });

  it("only picks allowlisted models", () => {
    expect(pickModel(request({ model: { id: "claude-sonnet-5-5" } }))).toBe("claude-sonnet-5-5");
    expect(pickModel(request({ model: { id: "gpt-5" } }))).toBe("claude-opus-5-5");
    expect(pickModel(request())).toBe("claude-opus-5-5");
  });
});

describe("toMessages", () => {
  const parse = (items: unknown[]) => toAnthropicParams(request({ input: items }), maker).messages;

  it("pairs tool calls with their results and keeps results first in the user turn", () => {
    expect(parse([user("hola"), reply("Miro."), call("c1", '{"page":"sales"}'), result("c1", "2 widgets"), user("gracias")])).toEqual([
      { role: "user", content: [{ type: "text", text: "hola" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Miro." },
          { type: "tool_use", id: "c1", name: "view_report", input: { page: "sales" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "2 widgets" },
          { type: "text", text: "gracias" },
        ],
      },
    ]);
  });

  it("answers a call that never got a result, drops orphan results, and skips unknown items", () => {
    const messages = parse([user("hola"), call("c1"), { type: "something_new" }, result("ghost"), user("¿y?")]);
    expect(messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hola" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "view_report", input: {} }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "Cancelled before it ran.", is_error: true },
          { type: "text", text: "¿y?" },
        ],
      },
    ]);
  });

  it("starts with a user turn and tolerates bad arguments", () => {
    expect(toMessages([call("c1", "not json"), result("c1")] as never)[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "(continue)" }],
    });
    expect(toMessages([call("c1", "[1]"), result("c1")] as never)[1]!.content).toContainEqual({
      type: "tool_use",
      id: "c1",
      name: "view_report",
      input: {},
    });
  });
});

describe("runStudioTurn", () => {
  it("streams Claude's text and tool calls as Studio events and returns a matching response", async () => {
    const { client, requests } = sseAnthropic([
      { content: [{ type: "text", text: "Agrego un gráfico." }, { type: "tool_use", id: "toolu_9", name: "add_widget", input: { type: "bar" } }] },
    ]);
    const events: AgAiEvent[] = [];
    const translator = new StreamTranslator();
    const { message } = await runStudioTurn(request(), (e) => events.push(e), translator, { ...maker, client });

    expect(events.map((e) => e.type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
    const response = translator.response(message);
    expect(response.status).toBe("completed");
    expect(response.output).toEqual([
      expect.objectContaining({ type: "message", id: "msg_1_0", content: [{ type: "text", text: "Agrego un gráfico.", annotations: [] }] }),
      expect.objectContaining({ type: "function_call", callId: "toolu_9", name: "add_widget", arguments: '{"type":"bar"}' }),
    ]);
    expect(events[0]).toMatchObject({ messageId: "msg_1_0" });
    expect(response.usage).toMatchObject({ inputTokens: 5000, cachedInputTokens: 2000 });

    expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low" } });
    expect(requests[0]!.thinking).toBeUndefined();
  });

  it("retries a JSON turn with the schema in the prompt when structured output is rejected", async () => {
    const { client, requests } = sseAnthropic([{ status: 400, error: "schema not supported" }, { content: [{ type: "text", text: '{"title":"Ventas"}' }] }]);
    const schema = { type: "object", properties: { title: { type: "string" } } };
    const { message } = await runStudioTurn(
      request({ responseFormat: { type: "json", name: "t", schema } }),
      () => {},
      new StreamTranslator(),
      { ...maker, client },
    );
    expect(message.content).toEqual([expect.objectContaining({ type: "text", text: '{"title":"Ventas"}' })]);
    expect(requests).toHaveLength(2);
    expect((requests[1]!.output_config as { format?: unknown }).format).toBeUndefined();
    expect(JSON.stringify(requests[1]!.system)).toContain("Reply with only a JSON object");
  });
});

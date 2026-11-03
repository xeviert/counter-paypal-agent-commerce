import Anthropic from "@anthropic-ai/sdk";

export type SseBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown; id?: string }
  | { type: "thinking"; signature?: string };

export type SseReply = { content: SseBlock[]; stopReason?: string } | { status: number; error?: string };

/**
 * A real Anthropic client whose `fetch` answers each Messages request with the next scripted reply as
 * a server-sent event stream (the last one repeats). Drives SDK helpers that build their own requests,
 * like the tool runner, without the network. `requests` holds each parsed request body.
 */
export function sseAnthropic(replies: SseReply[], model = "claude-opus-5-5") {
  const requests: Record<string, unknown>[] = [];
  let toolIds = 0;
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
    if ("status" in reply) {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: reply.error ?? "boom" } }), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      });
    }
    const lines: string[] = [];
    const send = (data: { type: string } & Record<string, unknown>) => lines.push(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({
      type: "message_start",
      message: {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3000, output_tokens: 1, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
      },
    });
    reply.content.forEach((block, index) => {
      if (block.type === "text") {
        send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
        send({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
      } else if (block.type === "tool_use") {
        const id = block.id ?? `toolu_${++toolIds}`;
        send({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: block.name, input: {} } });
        send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
      } else {
        send({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
        send({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature ?? "sig" } });
      }
      send({ type: "content_block_stop", index });
    });
    const toolCall = reply.content.some((b) => b.type === "tool_use");
    send({
      type: "message_delta",
      delta: { stop_reason: reply.stopReason ?? (toolCall ? "tool_use" : "end_turn"), stop_sequence: null },
      usage: { output_tokens: 120 },
    });
    send({ type: "message_stop" });
    return new Response(lines.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({ apiKey: "test-key", maxRetries: 0, fetch });
  return { client, requests };
}

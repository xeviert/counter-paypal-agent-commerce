import Anthropic from "@anthropic-ai/sdk";

type Handler = (...args: never[]) => void;

export type FakeReply =
  | { kind: "output"; output: unknown; stopReason?: string }
  | { kind: "refusal" }
  | { kind: "parse_error" }
  | { kind: "api_error" };

/**
 * Stands in for `client.beta.messages.stream()`: emits the stream events the listing builder and
 * negotiator listen to, then resolves `finalMessage()` the way the SDK does. Never touches the network.
 * Pass several replies to answer successive calls in order (the last one repeats).
 */
export function fakeAnthropic(script: FakeReply | FakeReply[], model = "claude-sonnet-5-5") {
  const replies = Array.isArray(script) ? script : [script];
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(params);
          const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
          const handlers: Record<string, Handler[]> = {};
          const emit = (event: string, ...args: unknown[]) =>
            handlers[event]?.forEach((h) => (h as (...a: unknown[]) => void)(...args));
          return {
            on(event: string, handler: Handler) {
              (handlers[event] ??= []).push(handler);
              return this;
            },
            async finalMessage() {
              emit("streamEvent", { type: "message_start", message: { model } });
              if (reply.kind === "api_error") throw new Anthropic.APIConnectionError({ message: "socket hang up" });
              if (reply.kind === "refusal") {
                emit("streamEvent", { type: "message_delta", delta: { stop_reason: "refusal" } });
                throw new Anthropic.AnthropicError("Failed to parse structured output: empty");
              }
              if (reply.kind === "parse_error") {
                emit("text", "{", "{");
                emit("streamEvent", { type: "message_delta", delta: { stop_reason: "end_turn" } });
                throw new Anthropic.AnthropicError("Failed to parse structured output: bad");
              }
              const json = JSON.stringify(reply.output);
              // Split where the listing builder's English half starts, if there is one.
              const half = Math.max(json.indexOf('"en"'), 0);
              emit("text", json.slice(0, half), json.slice(0, half));
              emit("text", json.slice(half), json);
              const stopReason = reply.stopReason ?? "end_turn";
              emit("streamEvent", { type: "message_delta", delta: { stop_reason: stopReason } });
              return {
                model,
                stop_reason: stopReason,
                usage: { input_tokens: 4200, output_tokens: 600, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
                content: [{ type: "text", text: json }],
                parsed_output: reply.output,
              };
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

/** A valid `listingBuilderOutput` for a Spanish-speaking maker. */
export const builderOutput = {
  category: "textiles",
  weightClass: "medium",
  native: {
    title: "Tapete de lana con grecas",
    description: "Tapete tejido en telar de pedal con grecas de Mitla.",
    materials: "Lana de borrego, grana cochinilla",
    care: null,
    provenance: "Lo tejí en Teotitlán del Valle.",
  },
  en: {
    title: "Wool rug with fret pattern",
    description: "Rug woven on a pedal loom with Mitla fret patterns.",
    materials: "Sheep's wool, cochineal",
    care: null,
    provenance: "I wove it in Teotitlán del Valle.",
  },
  dimensions: { lengthCm: 150, widthCm: 80, heightCm: null },
  spokenPriceUsd: 120,
  priceGuidance: { lowUsd: 110, highUsd: 160, rationale: "Maker asked $120; similar rugs list at $95-$180." },
  restricted: { flag: false, reason: null },
};

import { z } from "zod";

// One AG Studio AI turn as the browser sends it to /s/api/studio-ai (BUILDOUT §7.3): Studio's
// `AgLlmRequest`, checked only as far as the Claude adapter reads it. Item content is Studio's.

const text = z.string().max(200_000);

const inputMessage = z.object({
  kind: z.literal("input"),
  type: z.literal("message"),
  role: z.enum(["user", "system"]),
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text }),
      z.looseObject({ type: z.literal("image"), imageUrl: z.string().max(5_000_000).optional() }),
      z.looseObject({ type: z.literal("file") }),
    ]),
  ),
});

const outputMessage = z.object({
  kind: z.literal("output"),
  type: z.literal("message"),
  content: z.array(
    z.union([z.looseObject({ type: z.literal("text"), text }), z.object({ type: z.literal("refusal"), refusal: text })]),
  ),
});

const toolCall = z.object({
  type: z.literal("function_call"),
  callId: z.string().min(1).max(200),
  name: z.string().min(1).max(128),
  arguments: text,
});

const toolResult = z.object({
  type: z.literal("function_call_output"),
  callId: z.string().min(1).max(200),
  output: text,
});

const reasoning = z.looseObject({ type: z.literal("reasoning") });

export const studioItem = z.union([inputMessage, outputMessage, toolCall, toolResult, reasoning]);
export type StudioItem = z.infer<typeof studioItem>;

export const studioTool = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  description: z.string().max(20_000),
  parameters: z.record(z.string(), z.unknown()),
  kind: z.enum(["client", "server", "provided"]).optional(),
});

export const studioTurnRequest = z.object({
  // Items are parsed one by one in lib/ai/studio.ts, so a kind this adapter doesn't know is skipped, not a 400.
  input: z.array(z.unknown()).max(1_000),
  instructions: z.string().max(200_000).optional(),
  tools: z.array(studioTool).max(100).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.union([
    z.object({ type: z.literal("text") }),
    z.object({
      type: z.literal("json"),
      name: z.string(),
      description: z.string().optional(),
      schema: z.record(z.string(), z.unknown()),
    }),
  ]),
  model: z.object({ id: z.string(), effort: z.string().optional() }).optional(),
});

export type StudioTurnRequest = z.infer<typeof studioTurnRequest>;

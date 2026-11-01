import { z } from "zod";
import { offerDecision, type OfferDecision } from "./common";

// Negotiator structured output (BUILDOUT §6.4). Flat and nullable for the model, like the listing
// builder; `toNegotiatorResult` turns it into cents for `lib/policy/clamp.ts`, which has the final say.
// No field asks for the model's reasoning: on Opus 5.5 that trips the `reasoning_extraction` refusal
// classifier (seen Nov 1, even for plain offers). `note` is a one-line summary for the maker instead.

export const negotiatorOutput = z.object({
  decision: offerDecision,
  counterPrice: z.number().nullable().describe("Per-item price in USD you offer instead. Required for counter, null otherwise"),
  message: z.string().describe("Reply to the buyer's agent: one or two short sentences, in English"),
  note: z.string().describe("One sentence for the maker's records, e.g. what the agent asked for. Never shown to the buyer"),
});

export type NegotiatorOutput = z.infer<typeof negotiatorOutput>;

export type NegotiatorResult = {
  decision: OfferDecision;
  counterCents: number | null;
  message: string;
  note: string;
};

const MESSAGE_MAX = 500;
const NOTE_MAX = 500;

export function toNegotiatorResult(output: NegotiatorOutput): NegotiatorResult {
  const usd = output.counterPrice;
  return {
    decision: output.decision,
    counterCents: usd !== null && Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : null,
    message: output.message.trim().slice(0, MESSAGE_MAX),
    note: output.note.trim().slice(0, NOTE_MAX),
  };
}

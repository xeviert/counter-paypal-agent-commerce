import { z } from "zod";

// Buyer-question answerer structured output (BUILDOUT §7.2). Flat for the model like the negotiator;
// no field asks for reasoning (§6.4 refusal lesson).

export const answererOutput = z.object({
  answered: z.boolean().describe("True only when the listing text answers the question"),
  answer: z
    .string()
    .describe("One to three short sentences for the buyer's agent, in the question's language. When answered is false, say the maker hasn't said"),
});

export type AnswererOutput = z.infer<typeof answererOutput>;
export type AnswererResult = { answered: boolean; answer: string };

export const ANSWER_MAX = 600;

/** Cuts at the last sentence end that fits, else at the last space. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (sentence > max / 2) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > 0 ? space : max).trimEnd()}…`;
}

export function toAnswererResult(output: AnswererOutput): AnswererResult {
  const answer = fit(output.answer.trim(), ANSWER_MAX);
  return { answered: output.answered && answer.length > 0, answer };
}

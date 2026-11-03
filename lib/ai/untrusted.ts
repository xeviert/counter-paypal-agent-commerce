/**
 * Wraps text someone outside Counter wrote (buyer agents, buyers via PayPal) in `<tag>` for a prompt.
 * Any opening or closing `tag` inside the text is stripped, so it can't end the block early.
 */
export function wrapUntrusted(tag: string, text: string | null | undefined, empty = "(none)"): string {
  const pattern = new RegExp(`<\\/?\\s*${tag}\\s*>`, "gi");
  const body = (text ?? "").replace(pattern, "").trim();
  return `<${tag}>\n${body || empty}\n</${tag}>`;
}

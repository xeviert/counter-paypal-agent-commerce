import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { products, sellers } from "@/lib/db/schema";
import { TOOL_INFO } from "@/lib/mcp/tools";
import { LIMITS } from "@/lib/mcp/rate-limit";
import { sellableConditions } from "./catalog";
import { MAX_OFFERS } from "./offers";
import { productUrl } from "./urls";

// `/llms.txt` (llmstxt.org) for agents that find Counter on the web (BUILDOUT §7.5).

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0]!;

function per(l: { max: number; windowMs: number }) {
  const [n, unit] = l.windowMs >= 3600_000 ? [l.windowMs / 3600_000, "h"] : [l.windowMs / 60_000, "min"];
  return n === 1 ? `${l.max} per ${unit}` : `${l.max} per ${n} ${unit}`;
}

export async function sampleProductUrl(db: Tx): Promise<string | undefined> {
  const [row] = await db
    .select({ slug: products.slug })
    .from(products)
    .innerJoin(sellers, eq(products.sellerId, sellers.id))
    .where(and(...sellableConditions()))
    .limit(1);
  return row && productUrl(row.slug);
}

export function llmsTxt(baseUrl: string, sampleUrl?: string): string {
  const tools = TOOL_INFO.map((t) => `- ${t.name} (${t.title}): ${firstSentence(t.description)}`);
  return [
    "# Counter",
    "",
    "> A marketplace where AI agents buy handmade goods directly from makers in Mexico, the Philippines, " +
      "Kenya and India. Agents search, ask, negotiate and check out over MCP; a human approves every " +
      "payment on PayPal, which holds the maker's money until the order ships and arrives.",
    "",
    "## MCP server",
    "",
    `- URL: ${baseUrl}/api/mcp`,
    "- Transport: Streamable HTTP, stateless, no sign-in",
    "",
    "## Tools",
    "",
    ...tools,
    "",
    "## How to buy",
    "",
    "1. search_products with the buyer's words and buyerCountry",
    "2. get_product for the full listing and shipping to the buyer",
    "3. Optional: ask_question, or make_offer when the product is negotiable",
    "4. create_checkout with productId (list price) or offerId (agreed price)",
    "5. A human approves every payment on PayPal at approvalUrl; nothing is charged before that",
    "6. get_order_status with the statusToken once the buyer says they approved",
    "",
    "## Rules",
    "",
    "- Prices and totals are in USD. create_checkout requires buyerCountry (ISO 3166-1 alpha-2)",
    `- Limits per agent: calls ${per(LIMITS.agent)}, checkouts ${per(LIMITS.checkout)}, offers ${per(LIMITS.offer)} ` +
      `(at most ${MAX_OFFERS} per product per day), questions ${per(LIMITS.question)}`,
    "",
    "## Links",
    "",
    `- [Product feed](${baseUrl}/feed.json): every product for sale, OpenAI product feed fields`,
    ...(sampleUrl ? [`- [Sample product](${sampleUrl}): product page with schema.org JSON-LD`] : []),
    "",
  ].join("\n");
}

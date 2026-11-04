import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { Db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { PayPalError } from "@/lib/paypal/client";
import { SellerNotReceivableError } from "@/lib/paypal/orders";
import { PolicyError } from "@/lib/policy/errors";
import type { Money } from "@/lib/schemas/common";
import {
  askQuestionInput,
  askQuestionOutput,
  createCheckoutInput,
  createCheckoutOutput,
  getOrderStatusInput,
  getOrderStatusOutput,
  getProductInput,
  getProductOutput,
  makeOfferInput,
  makeOfferOutput,
  searchProductsInput,
  searchProductsOutput,
  type McpError,
  type McpErrorCode,
  type ProductSummary,
} from "@/lib/schemas/mcp";
import { getProduct, searchProducts } from "@/lib/shop/catalog";
import { createCheckout } from "@/lib/shop/checkout";
import { makeOffer } from "@/lib/shop/offers";
import { getOrderStatus, type OrderStatusView } from "@/lib/shop/order-status";
import { askQuestion } from "@/lib/shop/questions";
import type { Agent } from "./agent";
import { limitsFor, type RateLimiter } from "./rate-limit";

export type ToolDeps = {
  /** Lazy so `tools/list` never opens a connection. */
  db: () => Db;
  agent: Agent;
  limiter: RateLimiter;
};

type ToolSuccess = {
  output: Record<string, unknown>;
  text: string;
  /** Rows that exist, for the `events` foreign keys. */
  refs?: { productId?: string; orderId?: string };
  count?: number;
  /** Products shown to the agent, so the maker funnel (BUILDOUT §7.3) can count search appearances. */
  productIds?: string[];
  /** Extra fields for the `events` payload, e.g. how an offer was clamped (the injection demo beat). */
  audit?: Record<string, unknown>;
};

type CreateCheckoutOutput = z.output<typeof createCheckoutOutput>;

const fmt = (m: Money) => `${m.value} ${m.currency}`;

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

// Tool texts are all claude.ai's model sees (often read aloud in voice mode): plain sentences, no
// markdown, and every handle the next call needs on the last line.

export function searchText(found: ProductSummary[]): string {
  if (found.length === 0) return "No products matched. Try broader words.";
  const items = found.map(
    (p, i) => `${i + 1}. ${p.title}, ${fmt(p.price)}, by ${p.maker.name} in ${countryNames.of(p.maker.country)}.`,
  );
  const ids = found.map((p, i) => `${i + 1} ${p.productId}`).join(", ");
  return `${found.length} ${found.length === 1 ? "product" : "products"}. ${items.join(" ")}\nproductIds: ${ids}`;
}

export function checkoutText(output: CreateCheckoutOutput): string {
  const { totals } = output;
  return (
    `Checkout ready. Total ${fmt(totals.total)} (item ${fmt(totals.item)}, shipping ${fmt(totals.shipping)}). ` +
    `Ask the buyer to open this link and approve the payment on PayPal before ${output.expiresAt}: ${output.approvalUrl}\n` +
    `Status page for the buyer: ${output.statusUrl}\n` +
    `statusToken: ${output.statusToken} (pass it to get_order_status; keep it private)`
  );
}

export function orderStatusText(view: OrderStatusView): string {
  const tracking = view.tracking ? ` Tracking: ${view.tracking.carrier} ${view.tracking.number}.` : "";
  return `Status ${view.status}. ${view.nextStep}${tracking}`;
}

export function errorResult(code: McpErrorCode, message: string): CallToolResult {
  const structuredContent: McpError = { error: { code, message } };
  return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }], structuredContent };
}

/** Stable codes for agents; internal messages never leave the server. */
export function toMcpError(err: unknown): { code: McpErrorCode; message: string } {
  if (err instanceof PolicyError) return { code: err.code, message: err.message };
  if (err instanceof SellerNotReceivableError) {
    return { code: "SELLER_NOT_RECEIVABLE", message: "This maker can't receive payments right now" };
  }
  if (err instanceof PayPalError) {
    return { code: "PAYMENT_PROVIDER_ERROR", message: "PayPal is unavailable. Nothing was charged; try again shortly" };
  }
  return { code: "INTERNAL_ERROR", message: "Something went wrong on Counter's side. Try again shortly" };
}

// Bearer handles stay out of the audit log: the status token authorizes releasing funds (ARCHITECTURE
// §5.6), the offer id buys at the agreed price.
const SECRET_ARGS = ["statusToken", "offerId"];
const redact = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).map(([k, v]) => [k, SECRET_ARGS.includes(k) ? "[redacted]" : v]));

async function runTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps,
  fn: () => Promise<ToolSuccess>,
): Promise<CallToolResult> {
  const { agent } = deps;
  const started = Date.now();
  const decision = deps.limiter.check(limitsFor(name, agent));
  if (!decision.ok) {
    // Log line only: a flood shouldn't become a flood of `events` rows.
    log.warn("mcp rate limited", { tool: name, agentId: agent.agentId, ip: agent.ip });
    return errorResult("RATE_LIMITED", `Too many requests. Retry in ${Math.ceil(decision.retryAfterMs / 1000)}s`);
  }

  let result: CallToolResult;
  let success: ToolSuccess | undefined;
  let code: McpErrorCode | undefined;
  try {
    success = await fn();
    result = { content: [{ type: "text", text: success.text }], structuredContent: success.output };
  } catch (err) {
    const mapped = toMcpError(err);
    code = mapped.code;
    if (code === "INTERNAL_ERROR") log.error("mcp tool failed", { tool: name, agentId: agent.agentId, err });
    result = errorResult(mapped.code, mapped.message);
  }

  const ms = Date.now() - started;
  log.info("mcp tool call", { tool: name, agentId: agent.agentId, outcome: code ?? "ok", ms });
  try {
    await deps.db().insert(events).values({
      type: `mcp.${name}`,
      source: "mcp",
      actor: agent.agentId,
      productId: success?.refs?.productId,
      orderId: success?.refs?.orderId,
      payload: {
        args: redact(args),
        outcome: code ? "error" : "ok",
        ...(code && { code }),
        ...(success?.count !== undefined && { count: success.count }),
        ...(success?.productIds && { productIds: success.productIds }),
        ...(success?.audit && { audit: success.audit }),
        ms,
        userAgent: agent.userAgent,
      },
    });
  } catch (err) {
    log.error("mcp call not logged to events", { tool: name, err });
  }
  return result;
}

/** Shop tools in registration order. `/llms.txt` lists them from here, so the text matches `tools/list`. */
export const TOOL_INFO = [
  {
    name: "search_products",
    title: "Search handmade products",
    description:
      "Search handmade goods sold directly by makers in Mexico, the Philippines, Kenya and India. " +
      "The query can be in any language. Pass buyerCountry to get the shipping cost to the buyer. " +
      "Prices are per item in USD; approxLocalPrice is a reference only. " +
      "Call get_product next for the full listing before checking out.",
  },
  {
    name: "get_product",
    title: "Get product details",
    description:
      "Full listing for one product: description, materials, care, the maker's provenance story " +
      "(in English and the maker's language), dimensions, photos, units available, and shipping " +
      "to buyerCountry. Use it to answer the buyer's questions and confirm the total before create_checkout.",
  },
  {
    name: "ask_question",
    title: "Ask about a product",
    description:
      "Ask a question about one product (size, materials, care, who made it, shipping, stock). " +
      "Answers come only from the maker's listing; answered is false when the listing doesn't say.",
  },
  {
    name: "make_offer",
    title: "Make a price offer",
    description:
      "Offer the maker a price per item (USD, shipping not included) when get_product shows negotiable. " +
      "The maker's side answers accept, counter or reject with a message. Both accept and counter come with a " +
      "binding price: to buy at it, call create_checkout with the returned offerId (single use, expires in 30 " +
      "minutes). Up to 3 offers per product per day; later offers see your earlier ones. Offers reserve no stock.",
  },
  {
    name: "create_checkout",
    title: "Create a PayPal checkout",
    description:
      "Creates a PayPal checkout plus flat shipping to buyerCountry: pass productId to buy at the listed price, " +
      "or offerId from make_offer to buy at the agreed price. " +
      "The totals returned are final: prices come from the listing or the offer, never from arguments. " +
      "The human buyer must open approvalUrl and approve the payment on PayPal themselves; nothing is " +
      "charged before that, and the link expires at expiresAt. The shipping address is picked on PayPal " +
      "and must be in buyerCountry's shipping region. Keep statusToken private and use it with get_order_status.",
  },
  {
    name: "get_order_status",
    title: "Get order status",
    description:
      "Status of an order from create_checkout: payment state, what happens next, tracking once shipped, " +
      "and whether the maker has been paid. Check after the buyer says they approved; don't poll in a tight loop.",
  },
] as const;

export type ShopToolName = (typeof TOOL_INFO)[number]["name"];

function toolMeta(name: ShopToolName) {
  const { title, description } = TOOL_INFO.find((t) => t.name === name)!;
  return { title, description };
}

export function registerShopTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "search_products",
    {
      ...toolMeta("search_products"),
      inputSchema: searchProductsInput,
      outputSchema: searchProductsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("search_products", args, deps, async () => {
        const found = await searchProducts(deps.db(), args);
        return {
          output: { products: found },
          text: searchText(found),
          count: found.length,
          productIds: found.map((p) => p.productId),
        };
      }),
  );

  server.registerTool(
    "get_product",
    {
      ...toolMeta("get_product"),
      inputSchema: getProductInput,
      outputSchema: getProductOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("get_product", args, deps, async () => {
        const product = await getProduct(deps.db(), args);
        const shipping = product.shipping ? ` Shipping is ${fmt(product.shipping.amount)}.` : "";
        return {
          output: { product },
          text:
            `${product.title}, ${fmt(product.price)} per item.${shipping} ${product.available} available. ` +
            `Page: ${product.url}\nproductId: ${product.productId}`,
          refs: { productId: product.productId },
        };
      }),
  );

  server.registerTool(
    "ask_question",
    {
      ...toolMeta("ask_question"),
      inputSchema: askQuestionInput,
      outputSchema: askQuestionOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("ask_question", args, deps, async () => {
        const { productId, audit, ...output } = await askQuestion(deps.db(), args, { agentId: deps.agent.agentId });
        return { output, text: output.answer, refs: { productId }, audit };
      }),
  );

  server.registerTool(
    "make_offer",
    {
      ...toolMeta("make_offer"),
      inputSchema: makeOfferInput,
      outputSchema: makeOfferOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) =>
      runTool("make_offer", args, deps, async () => {
        const { output, audit, productId } = await makeOffer(deps.db(), args, { agentId: deps.agent.agentId });
        const price = output.price ? ` at ${fmt(output.price)} per item` : "";
        // claude.ai shows the model only the text, so the handle create_checkout needs must be in it.
        const handle = output.price ? `\nofferId: ${output.offerId}` : "";
        return {
          output,
          text: `${output.decision}${price}. The maker says: "${output.message}" ${output.nextStep}${handle}`,
          refs: { productId },
          audit,
        };
      }),
  );

  server.registerTool(
    "create_checkout",
    {
      ...toolMeta("create_checkout"),
      inputSchema: createCheckoutInput,
      outputSchema: createCheckoutOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      runTool("create_checkout", args, deps, async () => {
        const { output, order } = await createCheckout(deps.db(), args, { agentId: deps.agent.agentId });
        return {
          output,
          // claude.ai shows the model only the text, so a later get_order_status needs the token here.
          text: checkoutText(output),
          refs: { productId: order.productId, orderId: order.id },
        };
      }),
  );

  server.registerTool(
    "get_order_status",
    {
      ...toolMeta("get_order_status"),
      inputSchema: getOrderStatusInput,
      outputSchema: getOrderStatusOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("get_order_status", args, deps, async () => {
        const { view, order } = await getOrderStatus(deps.db(), args.statusToken);
        return {
          output: view,
          text: orderStatusText(view),
          refs: { productId: order.productId, orderId: order.id },
        };
      }),
  );
}

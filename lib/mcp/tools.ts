import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { Db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { PayPalError } from "@/lib/paypal/client";
import { SellerNotReceivableError } from "@/lib/paypal/orders";
import { PolicyError } from "@/lib/policy/errors";
import type { Money } from "@/lib/schemas/common";
import {
  createCheckoutInput,
  createCheckoutOutput,
  getOrderStatusInput,
  getOrderStatusOutput,
  getProductInput,
  getProductOutput,
  searchProductsInput,
  searchProductsOutput,
  type McpError,
  type McpErrorCode,
} from "@/lib/schemas/mcp";
import { getProduct, searchProducts } from "@/lib/shop/catalog";
import { createCheckout } from "@/lib/shop/checkout";
import { getOrderStatus } from "@/lib/shop/order-status";
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
};

const fmt = (m: Money) => `${m.value} ${m.currency}`;

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

// The status token authorizes releasing funds (ARCHITECTURE §5.6), so it stays out of the audit log.
const redact = (args: Record<string, unknown>) =>
  "statusToken" in args ? { ...args, statusToken: "[redacted]" } : args;

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
        ms,
        userAgent: agent.userAgent,
      },
    });
  } catch (err) {
    log.error("mcp call not logged to events", { tool: name, err });
  }
  return result;
}

export function registerShopTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "search_products",
    {
      title: "Search handmade products",
      description:
        "Search handmade goods sold directly by makers in Mexico, the Philippines, Kenya and India. " +
        "The query can be in any language. Pass buyerCountry to get the shipping cost to the buyer. " +
        "Prices are per item in USD; approxLocalPrice is a reference only. " +
        "Call get_product next for the full listing before checking out.",
      inputSchema: searchProductsInput,
      outputSchema: searchProductsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("search_products", args, deps, async () => {
        const found = await searchProducts(deps.db(), args);
        const lines = found.map(
          (p) => `- ${p.title}: ${fmt(p.price)} by ${p.maker.name} (${p.maker.country}) [${p.productId}]`,
        );
        return {
          output: { products: found },
          text: found.length
            ? `${found.length} products:\n${lines.join("\n")}`
            : "No products matched. Try broader words.",
          count: found.length,
        };
      }),
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product details",
      description:
        "Full listing for one product: description, materials, care, the maker's provenance story " +
        "(in English and the maker's language), dimensions, photos, units available, and shipping " +
        "to buyerCountry. Use it to answer the buyer's questions and confirm the total before create_checkout.",
      inputSchema: getProductInput,
      outputSchema: getProductOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("get_product", args, deps, async () => {
        const product = await getProduct(deps.db(), args);
        const shipping = product.shipping ? `, shipping ${fmt(product.shipping.amount)}` : "";
        return {
          output: { product },
          text: `${product.title}: ${fmt(product.price)} per item${shipping}, ${product.available} available. ${product.url}`,
          refs: { productId: product.productId },
        };
      }),
  );

  server.registerTool(
    "create_checkout",
    {
      title: "Create a PayPal checkout",
      description:
        "Creates a PayPal checkout for a product at its listed price plus flat shipping to buyerCountry. " +
        "The totals returned are final: price comes from the listing, never from arguments. " +
        "The human buyer must open approvalUrl and approve the payment on PayPal themselves; nothing is " +
        "charged before that, and the link expires at expiresAt. The shipping address is picked on PayPal " +
        "and must be in buyerCountry's shipping region. Keep statusToken private and use it with get_order_status.",
      inputSchema: createCheckoutInput,
      outputSchema: createCheckoutOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      runTool("create_checkout", args, deps, async () => {
        const { output, order } = await createCheckout(deps.db(), args, { agentId: deps.agent.agentId });
        return {
          output,
          text:
            `Checkout ready: ${fmt(output.totals.total)} (item ${fmt(output.totals.item)} + shipping ${fmt(output.totals.shipping)}). ` +
            `Ask the buyer to approve on PayPal: ${output.approvalUrl} (expires ${output.expiresAt}). Status page: ${output.statusUrl}`,
          refs: { productId: order.productId, orderId: order.id },
        };
      }),
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get order status",
      description:
        "Status of an order from create_checkout: payment state, what happens next, tracking once shipped, " +
        "and whether the maker has been paid. Check after the buyer says they approved; don't poll in a tight loop.",
      inputSchema: getOrderStatusInput,
      outputSchema: getOrderStatusOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool("get_order_status", args, deps, async () => {
        const { view, order } = await getOrderStatus(deps.db(), args.statusToken);
        return {
          output: view,
          text: `${view.status}: ${view.nextStep}`,
          refs: { productId: order.productId, orderId: order.id },
        };
      }),
  );
}

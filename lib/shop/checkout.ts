import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { attachPayPalOrder, openCheckout, transition, type Order } from "@/lib/db/orders";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { PayPalError } from "@/lib/paypal/client";
import { createOrder, SellerNotReceivableError } from "@/lib/paypal/orders";
import { PolicyError } from "@/lib/policy/errors";
import { canReceive } from "@/lib/policy/seller";
import { quoteOrder } from "@/lib/policy/quote";
import { sellerCountry, toMoney } from "@/lib/schemas/common";
import type { createCheckoutInput, createCheckoutOutput } from "@/lib/schemas/mcp";
import { findSellableProduct } from "./catalog";
import { findCheckoutOffer } from "./offers";
import { statusUrl } from "./urls";

export type CheckoutResult = { output: z.output<typeof createCheckoutOutput>; order: Order };

/**
 * Reserve stock → `CheckoutCreated` row → PayPal order. Amounts come from the product row or an
 * accepted offer, and lib/policy only; the agent picks product, quantity and destination (ARCHITECTURE §5.2).
 */
export async function createCheckout(
  db: Tx,
  input: z.output<typeof createCheckoutInput>,
  caller: { agentId?: string } = {},
): Promise<CheckoutResult> {
  const offer = input.offerId
    ? await findCheckoutOffer(db, input.offerId, { productId: input.productId, agentId: caller.agentId })
    : undefined;
  const productId = offer?.productId ?? input.productId;
  if (!productId) throw new PolicyError("PRODUCT_NOT_FOUND", "Pass productId, or offerId from make_offer");
  const { product, seller } = await findSellableProduct(db, { id: productId });
  if (!canReceive(seller)) {
    throw new PolicyError("SELLER_NOT_RECEIVABLE", "This maker can't receive payments right now");
  }
  const quote = quoteOrder({
    unitCents: offer?.agreedAmount ?? product.listPrice,
    quantity: input.quantity,
    currency: product.currency,
    sellerCountry: sellerCountry.parse(seller.country),
    buyerCountry: input.buyerCountry,
    weightClass: product.weightClass,
    feeBps: getEnv().PLATFORM_FEE_BPS,
  });
  const opened = await openCheckout(db, { product, quote, source: "mcp", agentId: caller.agentId, offerId: offer?.id });

  let paypal: { paypalOrderId: string; approvalUrl: string };
  try {
    paypal = await createOrder({
      orderId: opened.id,
      merchantId: seller.merchantId,
      currency: quote.currency,
      item: { name: product.listing.en.title, sku: product.slug, unitCents: quote.unitCents, quantity: quote.quantity },
      shippingCents: quote.shippingCents,
      platformFeeCents: quote.platformFeeCents,
    });
  } catch (err) {
    const issue = err instanceof SellerNotReceivableError || err instanceof PayPalError ? err.issue : undefined;
    await transition(db, opened.id, "Canceled", {
      source: "mcp",
      actor: caller.agentId,
      from: ["CheckoutCreated"],
      payload: { reason: "paypal_create_failed", issue: issue ?? null },
    });
    if (err instanceof SellerNotReceivableError) {
      log.warn("checkout: PayPal refused the payee", { order_id: opened.id, seller_id: seller.id, issue });
      throw new PolicyError("SELLER_NOT_RECEIVABLE", "This maker can't receive payments right now");
    }
    log.error("checkout: PayPal order create failed", { order_id: opened.id, err });
    throw new PolicyError("PAYMENT_PROVIDER_ERROR", "PayPal is unavailable. Nothing was charged; try again shortly");
  }

  const order = await attachPayPalOrder(db, opened.id, paypal);
  const money = (cents: number) => toMoney(cents, quote.currency);
  return {
    order,
    output: {
      approvalUrl: paypal.approvalUrl,
      statusToken: order.statusToken,
      statusUrl: statusUrl(order.statusToken),
      quantity: quote.quantity,
      unitPrice: money(quote.unitCents),
      totals: { item: money(quote.itemCents), shipping: money(quote.shippingCents), total: money(quote.totalCents) },
      expiresAt: order.expiresAt.toISOString(),
    },
  };
}

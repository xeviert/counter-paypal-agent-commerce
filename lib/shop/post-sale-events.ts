import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { transition, type Order } from "@/lib/db/orders";
import { events, orders, products, refunds, sellers } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { platformFeeReturned } from "@/lib/paypal/post-sale";
import { releaseDueAt } from "@/lib/policy/release";
import { uuid } from "@/lib/schemas/common";
import { refundCaptureId, type Dispute, type Refund } from "@/lib/schemas/paypal";
import { bookRefund, settleRefund, type RefundTrigger } from "./fulfillment";
import { notify } from "./notifications";
import { syncOnboarding } from "./onboarding";
import { findOrderByCaptureId } from "./release";
import { makerTitle } from "./seller-orders";

// Post-sale webhooks (BUILDOUT §6.3, ARCHITECTURE §4.6): refunds made anywhere, disputes, and the
// maker's PayPal link. Payouts go through lib/shop/release.ts. All handlers are idempotent.

const trigger: RefundTrigger = { source: "webhook", actor: "paypal" };

async function productTitle(db: Tx, productId: string): Promise<string> {
  const [p] = await db.select({ listing: products.listing }).from(products).where(eq(products.id, productId));
  return p ? makerTitle(p.listing) : "";
}

/**
 * A refund PayPal reports. Ours (a `refunds` row exists or is pending for the same amount) are
 * settled once; any other (maker's PayPal dashboard, lost dispute, chargeback) is booked as a new row
 * so totals and the maker's net stay true.
 */
export async function recordRefundEvent(db: Tx, refund: Refund): Promise<Order | undefined> {
  const captureId = refundCaptureId(refund);
  const order = captureId ? await findOrderByCaptureId(db, captureId) : undefined;
  if (!order) return undefined;
  const cents = refund.amount?.cents;
  if (!cents) {
    log.warn("refund event without an amount", { order_id: order.id, refund_id: refund.id });
    return order;
  }

  const [known] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.paypalRefundId, refund.id));
  if (known) return order;
  const [pending] = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), eq(refunds.status, "pending"), eq(refunds.amount, cents)));
  if (pending) return settleRefund(db, pending.id, refund, trigger);

  const booked = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${refunds.n}), 0)`.mapWith(Number) })
      .from(refunds)
      .where(eq(refunds.orderId, order.id));
    const feeReturned = platformFeeReturned(refund);
    const [row] = await tx
      .insert(refunds)
      .values({
        orderId: order.id,
        n: (last?.n ?? 0) + 1,
        paypalRefundId: refund.id,
        amount: cents,
        platformFeeReturned: feeReturned,
        reason: "outside Counter",
        status: refund.status,
      })
      .onConflictDoNothing({ target: refunds.paypalRefundId })
      .returning();
    if (!row) return undefined;
    return bookRefund(tx, current!, { n: row.n, cents, feeReturned, refund }, trigger);
  });
  if (!booked) return order;
  await notify(
    db,
    order.sellerId,
    "refunded",
    { product: await productTitle(db, order.productId), amountCents: cents, currency: refund.amount!.currency },
    order.id,
  );
  return booked;
}

/** Outcomes where the buyer got their money back from the maker's side. */
const BUYER_WINS = new Set(["RESOLVED_BUYER_FAVOUR", "ACCEPTED"]);

/** Disputes pause the release timer (the sweep only picks PaidHeld/Shipped) and resume it if the maker wins. */
export async function recordDisputeEvent(
  db: Tx,
  stage: "created" | "updated" | "resolved",
  dispute: Dispute,
): Promise<Order | undefined> {
  const captureId = dispute.disputed_transactions?.find((t) => t.seller_transaction_id)?.seller_transaction_id;
  const order = captureId ? await findOrderByCaptureId(db, captureId) : undefined;
  if (!order) return undefined;
  const title = await productTitle(db, order.productId);

  if (stage === "created") {
    const { order: disputed, changed } = await transition(db, order.id, "Disputed", {
      ...trigger,
      from: ["PaidHeld", "Shipped"],
      patch: { disputeId: dispute.dispute_id },
      payload: { disputeId: dispute.dispute_id, reason: dispute.reason ?? null },
    });
    if (!changed) log.warn("dispute on an order that can't be disputed here", { order_id: order.id, status: order.status });
    else await notify(db, order.sellerId, "dispute_opened", { product: title }, order.id);
    return disputed;
  }
  if (stage === "updated") {
    log.info("dispute updated", { order_id: order.id, dispute_id: dispute.dispute_id, status: dispute.status });
    return order;
  }

  const outcome = dispute.dispute_outcome?.outcome_code ?? "NONE";
  const buyerWon = BUYER_WINS.has(outcome);
  const now = new Date();
  // Refund amounts arrive in their own PAYMENT.CAPTURE.REFUNDED / REVERSED event.
  const { order: resolved, changed } = buyerWon
    ? await transition(db, order.id, "Refunded", { ...trigger, from: ["Disputed"], payload: { outcome } })
    : await transition(db, order.id, order.trackingNumber ? "Shipped" : "PaidHeld", {
        ...trigger,
        from: ["Disputed"],
        patch: order.trackingNumber
          ? { releaseDueAt: releaseDueAt(now, getEnv().RELEASE_AFTER_DAYS, order.capturedAt) }
          : {},
        payload: { outcome },
      });
  if (changed) await notify(db, order.sellerId, "dispute_resolved", { product: title, outcome: buyerWon ? "buyer" : "maker" }, order.id);
  return resolved;
}

/** `tracking_id` is our seller id; older payloads may only carry `merchant_id`. */
async function findSeller(db: Tx, m: { tracking_id?: string; merchant_id?: string }) {
  if (m.tracking_id && uuid.safeParse(m.tracking_id).success) {
    const [s] = await db.select().from(sellers).where(eq(sellers.id, m.tracking_id));
    if (s) return s;
  }
  if (m.merchant_id) {
    const [s] = await db.select().from(sellers).where(eq(sellers.merchantId, m.merchant_id));
    return s;
  }
  return undefined;
}

/**
 * Onboarding finished → refresh from merchant-integrations. Consent revoked → the maker's listings
 * drop out of agent search and checkout (lib/policy/seller.ts canReceive) until they reconnect.
 */
export async function recordMerchantEvent(
  db: Tx,
  stage: "onboarded" | "consent_revoked",
  merchant: { tracking_id?: string; merchant_id?: string },
): Promise<void> {
  const seller = await findSeller(db, merchant);
  if (!seller) {
    log.warn("merchant webhook for an unknown seller", { stage, merchant_id: merchant.merchant_id });
    return;
  }
  if (stage === "onboarded") {
    await syncOnboarding(db, seller, { source: "webhook", actor: "paypal", merchantId: merchant.merchant_id });
    return;
  }
  if (seller.consentStatus === "revoked") return;
  await db.transaction(async (tx) => {
    await tx.update(sellers).set({ consentStatus: "revoked", consentRevokedAt: new Date() }).where(eq(sellers.id, seller.id));
    await tx.insert(events).values({
      type: "seller.consent_revoked",
      source: "webhook",
      actor: "paypal",
      sellerId: seller.id,
      payload: { merchantId: merchant.merchant_id ?? null },
    });
  });
  await notify(db, seller.id, "consent_revoked");
}

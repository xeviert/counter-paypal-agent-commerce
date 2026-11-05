import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { events, notifications, orders, products, refunds, sellers } from "@/lib/db/schema";
import { clearTokenCache } from "@/lib/paypal/client";
import { webhookEnvelope } from "@/lib/schemas/paypal";
import { searchProductsInput } from "@/lib/schemas/mcp";
import { orderValues, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { json, mockPayPal, paypalIssue, stubPayPalEnv } from "@/test/paypal";
import { searchProducts } from "./catalog";
import { refundOrder } from "./fulfillment";
import { releaseOrder } from "./release";
import { DEMO_RESTOCK, dueReleases, restockDemoProducts, runSweep, sendShipReminders } from "./sweep";
import { handlePayPalEvent } from "./webhook-handlers";

// Real spike-11 deliveries: capture 2DH54088UW786173Y, $2.00 refund 7Y691978HT5381453, payout of it.
const CAPTURE_ID = "2DH54088UW786173Y";
const fixture = (name: string) =>
  webhookEnvelope.parse(
    JSON.parse((JSON.parse(readFileSync(`test/fixtures/webhooks/${name}.json`, "utf8")) as { raw_body: string }).raw_body),
  );

const DAY = 24 * 3600_000;
const payout = (status = "SUCCESS") =>
  json(201, { item_id: "ITEM-1", reference_id: CAPTURE_ID, reference_type: "TRANSACTION_ID", processing_state: { status } });

describe.skipIf(!testDatabaseUrl)("post-sale money", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    stubPayPalEnv();
    clearTokenCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await truncateAll(db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function paidOrder(patch: Partial<typeof orders.$inferInsert> = {}) {
    const { seller, product } = await seedProduct(db);
    const [order] = await db
      .insert(orders)
      .values({
        ...orderValues(seller.id, product.id),
        status: "Shipped",
        paypalOrderId: `PP-${patch.captureId ?? CAPTURE_ID}`,
        captureId: CAPTURE_ID,
        paypalFee: 600,
        netAmount: 16150,
        capturedAt: new Date(Date.now() - 3 * DAY),
        shippedAt: new Date(Date.now() - 2 * DAY),
        releaseDueAt: new Date(Date.now() - 60_000),
        trackingNumber: "123456",
        carrier: "DHL",
        ...patch,
      })
      .returning();
    return { seller, product, order: order! };
  }

  const current = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const inbox = (sellerId: string) =>
    db.select().from(notifications).where(eq(notifications.sellerId, sellerId)).orderBy(asc(notifications.createdAt));
  const buyer = { source: "web" as const, actor: "buyer" };

  describe("release", () => {
    it("pays the maker once even when two triggers race", async () => {
      const { seller, order } = await paidOrder();
      const { calls } = mockPayPal(() => payout());
      const [a, b] = await Promise.all([
        releaseOrder(db, order.id, buyer, { buyerConfirmed: true }),
        releaseOrder(db, order.id, { source: "cron", actor: "system" }),
      ]);
      expect([a.kind, b.kind].sort()).toEqual(["released", "skipped"]);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.path).toBe("/v1/payments/referenced-payouts-items");
      expect(calls[0]!.headers.get("PayPal-Request-Id")).toBe(`release:${order.id}`);
      expect(calls[0]!.headers.get("PayPal-Auth-Assertion")).toBeNull();
      expect(calls[0]!.body).toEqual({ reference_id: CAPTURE_ID, reference_type: "TRANSACTION_ID" });

      expect(await current(order.id)).toMatchObject({ status: "Released", releaseStatus: "released", payoutItemId: "ITEM-1" });
      const notes = await inbox(seller.id);
      expect(notes.map((n) => n.kind)).toEqual(["funds_released"]);
      expect(notes[0]!.params).toMatchObject({ amountCents: 16150, currency: "USD", product: "Tapete" });
    });

    it("keeps a release requested on a PayPal outage and retries with the same request id", async () => {
      const { order } = await paidOrder();
      let down = true;
      const { calls } = mockPayPal(() => (down ? json(503, { name: "SERVICE_UNAVAILABLE" }) : payout()));
      expect((await releaseOrder(db, order.id, buyer)).kind).toBe("pending");
      expect((await current(order.id)).releaseStatus).toBe("requested");
      expect((await releaseOrder(db, order.id, buyer)).kind).toBe("skipped");

      down = false;
      expect((await releaseOrder(db, order.id, { source: "cron", actor: "system" }, { retry: true })).kind).toBe("released");
      expect(new Set(calls.map((c) => c.headers.get("PayPal-Request-Id")))).toEqual(new Set([`release:${order.id}`]));
    });

    it("marks a refused release failed", async () => {
      const { order } = await paidOrder();
      mockPayPal(() => paypalIssue(422, "TRANSACTION_NOT_ELIGIBLE"));
      expect((await releaseOrder(db, order.id, buyer)).kind).toBe("failed");
      expect(await current(order.id)).toMatchObject({ status: "Shipped", releaseStatus: "failed" });
    });

    it("waits for the webhook when PayPal is still processing", async () => {
      const { order } = await paidOrder();
      mockPayPal(() => payout("PENDING"));
      expect((await releaseOrder(db, order.id, buyer)).kind).toBe("pending");
      expect(await current(order.id)).toMatchObject({ status: "Shipped", releaseStatus: "requested", payoutItemId: "ITEM-1" });

      await handlePayPalEvent(db, fixture("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED"));
      expect(await current(order.id)).toMatchObject({ status: "Released", releaseStatus: "released" });
      // A redelivery changes nothing.
      await handlePayPalEvent(db, fixture("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED"));
      expect((await db.select().from(events).where(eq(events.type, "order.transition"))).length).toBe(1);
    });

    it("won't release a disputed or fully refunded order", async () => {
      const { order } = await paidOrder({ status: "Disputed" });
      expect((await releaseOrder(db, order.id, buyer)).kind).toBe("skipped");
      const { order: refunded } = await paidOrder({ status: "Shipped", captureId: "OTHER", refundedAmount: 17500 });
      expect((await releaseOrder(db, refunded.id, buyer)).kind).toBe("skipped");
    });
  });

  describe("refund webhooks", () => {
    it("books a refund made outside Counter and tells the maker", async () => {
      const { seller, order } = await paidOrder();
      await handlePayPalEvent(db, fixture("PAYMENT.CAPTURE.REFUNDED"));
      expect(await current(order.id)).toMatchObject({ refundedAmount: 200, platformFeeRefunded: 10, status: "Shipped" });
      const [row] = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
      expect(row).toMatchObject({ n: 1, paypalRefundId: "7Y691978HT5381453", amount: 200, platformFeeReturned: 10 });
      expect((await inbox(seller.id)).map((n) => n.kind)).toEqual(["refunded"]);

      await handlePayPalEvent(db, fixture("PAYMENT.CAPTURE.REFUNDED"));
      expect((await current(order.id)).refundedAmount).toBe(200);
    });

    it("doesn't double count Counter's own refund when the webhook arrives first", async () => {
      const { seller, order } = await paidOrder();
      // Our call times out after PayPal refunded: the pending row stays.
      mockPayPal(() => json(503, { name: "SERVICE_UNAVAILABLE" }));
      await expect(refundOrder(db, seller, order.id, { cents: 200 })).rejects.toThrow();
      await handlePayPalEvent(db, fixture("PAYMENT.CAPTURE.REFUNDED"));
      expect((await current(order.id)).refundedAmount).toBe(200);
      const rows = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
      expect(rows.map((r) => [r.n, r.paypalRefundId])).toEqual([[1, "7Y691978HT5381453"]]);

      // Settled by the webhook, so nothing is left pending for a retry to replay.
      expect(rows.map((r) => r.status)).toEqual(["COMPLETED"]);
      expect((await inbox(seller.id)).map((n) => n.kind)).toEqual([]);
    });
  });

  describe("dispute webhooks", () => {
    const disputeEvent = (stage: "CREATED" | "RESOLVED", outcome?: string) =>
      webhookEnvelope.parse({
        id: `WH-DISPUTE-${stage}-${outcome ?? ""}`,
        event_type: `CUSTOMER.DISPUTE.${stage}`,
        resource_type: "dispute",
        resource: {
          dispute_id: "PP-D-1",
          reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
          disputed_transactions: [{ seller_transaction_id: CAPTURE_ID }],
          ...(outcome && { dispute_outcome: { outcome_code: outcome } }),
        },
      });

    it("pauses the release while disputed and resumes it when the maker wins", async () => {
      const { seller, order } = await paidOrder();
      await handlePayPalEvent(db, disputeEvent("CREATED"));
      expect(await current(order.id)).toMatchObject({ status: "Disputed", disputeId: "PP-D-1" });
      expect(await dueReleases(db)).toEqual([]);

      await handlePayPalEvent(db, disputeEvent("RESOLVED", "RESOLVED_SELLER_FAVOUR"));
      const resumed = await current(order.id);
      expect(resumed.status).toBe("Shipped");
      expect(resumed.releaseDueAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
      const notes = await inbox(seller.id);
      expect(notes.map((n) => n.kind)).toEqual(["dispute_opened", "dispute_resolved"]);
      expect(notes[1]!.params).toMatchObject({ outcome: "maker" });
    });

    it("ends refunded when the buyer wins", async () => {
      const { order } = await paidOrder();
      await handlePayPalEvent(db, disputeEvent("CREATED"));
      await handlePayPalEvent(db, disputeEvent("RESOLVED", "RESOLVED_BUYER_FAVOUR"));
      expect((await current(order.id)).status).toBe("Refunded");
    });
  });

  describe("merchant webhooks", () => {
    it("hides a maker who revoked consent from agents", async () => {
      const { seller } = await seedProduct(db, { listing: { language: "en", en: { title: "Rug", description: "Wool rug" } } });
      const search = () => searchProducts(db, searchProductsInput.parse({ query: "rug" }));
      expect(await search()).toHaveLength(1);

      await handlePayPalEvent(
        db,
        webhookEnvelope.parse({
          id: "WH-REVOKE",
          event_type: "MERCHANT.PARTNER-CONSENT.REVOKED",
          resource: { merchant_id: seller.merchantId, tracking_id: seller.id },
        }),
      );
      const [row] = await db.select().from(sellers).where(eq(sellers.id, seller.id));
      expect(row).toMatchObject({ consentStatus: "revoked" });
      expect(row!.consentRevokedAt).toBeInstanceOf(Date);
      expect(await search()).toEqual([]);
      expect((await inbox(seller.id)).map((n) => n.kind)).toEqual(["consent_revoked"]);
    });
  });

  describe("sweep", () => {
    it("releases due orders, leaves the rest, and reminds unshipped makers once", async () => {
      const { order: due } = await paidOrder();
      const { order: notYet } = await paidOrder({ captureId: "CAP-2", releaseDueAt: new Date(Date.now() + DAY) });
      const { seller: lazy, order: unshipped } = await paidOrder({
        captureId: "CAP-3",
        status: "PaidHeld",
        shippedAt: null,
        releaseDueAt: null,
        trackingNumber: null,
        capturedAt: new Date(Date.now() - 6 * DAY),
      });
      mockPayPal(() => payout());

      const counts = await runSweep(db);
      expect(counts).toMatchObject({ released: 1, reminders: 1 });
      expect((await current(due.id)).status).toBe("Released");
      expect((await current(notYet.id)).status).toBe("Shipped");
      expect((await current(unshipped.id)).status).toBe("PaidHeld");
      expect(await sendShipReminders(db)).toBe(0);
      expect((await inbox(lazy.id)).map((n) => n.kind)).toEqual(["ship_reminder"]);
    });

    it("releases anything still held at the 26-day cap", async () => {
      const { order } = await paidOrder({
        status: "PaidHeld",
        releaseDueAt: null,
        capturedAt: new Date(Date.now() - 27 * DAY),
      });
      expect(await dueReleases(db)).toEqual([order.id]);
    });

    it("restocks sold-out demo products only", async () => {
      const demo = await seedProduct(db, { stock: 1, product: { reserved: 1 } });
      const paused = await seedProduct(db, { stock: 0, product: { status: "paused" } });
      const real = await seedProduct(db, { stock: 0, seller: { email: "maker@example.com" } });
      const inStock = await seedProduct(db, { stock: 2 });

      expect(await restockDemoProducts(db)).toBe(1);
      expect(await restockDemoProducts(db)).toBe(0);
      const stock = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0]!;
      expect(await stock(demo.product.id)).toMatchObject({ stock: 1 + DEMO_RESTOCK, reserved: 1 });
      expect((await stock(paused.product.id)).stock).toBe(0);
      expect((await stock(real.product.id)).stock).toBe(0);
      expect((await stock(inStock.product.id)).stock).toBe(2);
      const logged = await db.select().from(events).where(eq(events.type, "product.restocked"));
      expect(logged).toMatchObject([{ productId: demo.product.id, source: "cron" }]);
    });
  });
});

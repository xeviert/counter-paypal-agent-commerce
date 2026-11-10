import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { attachPayPalOrder, openCheckout, transition } from "@/lib/db/orders";
import { events, notifications, orders, products } from "@/lib/db/schema";
import { clearTokenCache } from "@/lib/paypal/client";
import { receivePayPalWebhook } from "@/lib/paypal/webhook-inbox";
import type { OrderQuote } from "@/lib/policy/quote";
import type { OrderStatus } from "@/lib/schemas/common";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { json, mockPayPal, paypalIssue, stubPayPalEnv, type Call } from "@/test/paypal";
import { cancelRedirect, returnRedirect } from "./checkout-return";
import { handlePayPalEvent } from "./webhook-handlers";

// Real spike-11 deliveries (Oct 27): PayPal order 7FP370406R848663Y, $10.00 to the PH maker,
// $0.50 platform fee, buyer in San Jose, US. Resources carry state at delivery time.
const fixture = (name: string) =>
  (JSON.parse(readFileSync(`test/fixtures/webhooks/${name}.json`, "utf8")) as { raw_body: string }).raw_body;

const PAYPAL_ID = "7FP370406R848663Y";
const completedOrder = (JSON.parse(fixture("CHECKOUT.ORDER.COMPLETED")) as { resource: Record<string, unknown> })
  .resource;
const approvedOrder = { ...completedOrder, status: "APPROVED", purchase_units: [{ ...shippingOnly() }] };

function shippingOnly() {
  const unit = (completedOrder.purchase_units as Record<string, unknown>[])[0]!;
  return { reference_id: unit.reference_id, shipping: unit.shipping };
}

/** The real COMPLETED capture event, with its capture status swapped and a fresh event id. */
function captureEvent(status: string, id: string) {
  const event = JSON.parse(fixture("PAYMENT.CAPTURE.COMPLETED")) as Record<string, unknown> & {
    resource: Record<string, unknown>;
  };
  return JSON.stringify({
    ...event,
    id,
    event_type: `PAYMENT.CAPTURE.${status === "PENDING" ? "PENDING" : status === "DENIED" ? "DENIED" : "COMPLETED"}`,
    resource: {
      ...event.resource,
      status,
      ...(status === "PENDING" && { status_details: { reason: "PENDING_REVIEW" } }),
    },
  });
}

const quote: OrderQuote = {
  currency: "USD",
  buyerCountry: "US",
  region: "north_america",
  quantity: 1,
  unitCents: 1000,
  itemCents: 1000,
  shippingCents: 0,
  totalCents: 1000,
  platformFeeCents: 50,
};

describe.skipIf(!testDatabaseUrl)("payment flow", () => {
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await truncateAll(db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function seedOrder(opts: { status?: OrderStatus; sellerCountry?: string; buyerCountry?: string } = {}) {
    const { product } = await seedProduct(db, {
      stock: 2,
      seller: { country: opts.sellerCountry ?? "PH", language: "fil" },
    });
    const opened = await openCheckout(db, {
      product,
      quote: { ...quote, buyerCountry: opts.buyerCountry ?? "US" },
      source: "mcp",
    });
    const order = await attachPayPalOrder(db, opened.id, {
      paypalOrderId: PAYPAL_ID,
      approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ID}`,
    });
    if (opts.status === "Approved") await transition(db, order.id, "Approved", { source: "web" });
    return { product, order };
  }

  const current = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const stock = async (id: string) =>
    (
      await db
        .select({ stock: products.stock, reserved: products.reserved })
        .from(products)
        .where(eq(products.id, id))
    )[0];

  /** PayPal fake: GET returns `getBody`, capture returns the completed order. */
  function paypal(getBody: unknown) {
    return mockPayPal((call: Call) =>
      call.method === "GET" ? json(200, getBody) : json(201, completedOrder),
    );
  }

  const inbox = (raw: string) =>
    receivePayPalWebhook(raw, new Headers(), {
      db,
      verify: async () => true,
      handle: (event) => handlePayPalEvent(db, event),
    });

  describe("return URL", () => {
    it("captures, records fees and buyer, commits stock, then shows the status page", async () => {
      const { product, order } = await seedOrder();
      const { calls } = paypal(approvedOrder);

      expect(await returnRedirect(db, PAYPAL_ID)).toBe(`https://counter.test/o/${order.statusToken}`);

      const capture = calls.find((c) => c.path.endsWith("/capture"))!;
      expect(capture.headers.get("PayPal-Request-Id")).toBe(`capture:${order.id}`);
      expect(await current(order.id)).toMatchObject({
        status: "PaidHeld",
        captureId: "2DH54088UW786173Y",
        paypalFee: 69,
        netAmount: 881,
        buyerName: "John Doe",
        payerId: "KG9W38PMY52F8",
        shippingAddress: { address: { admin_area_2: "San Jose", country_code: "US" } },
      });
      expect((await current(order.id)).approvedAt).toBeInstanceOf(Date);
      expect(await stock(product.id)).toEqual({ stock: 1, reserved: 0 });
    });

    it("is idempotent when the buyer reloads the return URL", async () => {
      const { product, order } = await seedOrder();
      const { calls } = paypal(approvedOrder);
      await returnRedirect(db, PAYPAL_ID);
      const before = calls.length;
      await returnRedirect(db, PAYPAL_ID);
      expect(calls.length).toBe(before);
      expect(await stock(product.id)).toEqual({ stock: 1, reserved: 0 });
      const transitions = await db
        .select()
        .from(events)
        .where(eq(events.orderId, order.id))
        .orderBy(asc(events.id));
      expect(transitions.filter((e) => e.type === "order.transition")).toHaveLength(2);
    });

    it("cancels without capturing when the PayPal ship-to is outside the quoted region", async () => {
      const { product, order } = await seedOrder({ buyerCountry: "DE" });
      const { calls } = paypal(approvedOrder);
      await returnRedirect(db, PAYPAL_ID);
      expect(calls.some((c) => c.path.endsWith("/capture"))).toBe(false);
      const canceled = await current(order.id);
      expect(canceled.status).toBe("Canceled");
      expect(canceled.shippingAddress).toEqual({ address: { country_code: "US" } });
      expect(await stock(product.id)).toEqual({ stock: 2, reserved: 0 });
    });

    it("sends the buyer back to PayPal when the card is declined", async () => {
      const { order } = await seedOrder();
      mockPayPal((call) =>
        call.method === "GET" ? json(200, approvedOrder) : paypalIssue(422, "INSTRUMENT_DECLINED"),
      );
      expect(await returnRedirect(db, PAYPAL_ID)).toBe(order.approvalUrl);
      expect((await current(order.id)).status).toBe("Approved");
    });

    it("doesn't capture an order the sweep already expired", async () => {
      const { order } = await seedOrder();
      await transition(db, order.id, "Expired", { source: "cron" });
      const { calls } = paypal(approvedOrder);
      expect(await returnRedirect(db, PAYPAL_ID)).toBe(`https://counter.test/o/${order.statusToken}`);
      expect(calls).toHaveLength(0);
    });

    it("still lands on the status page when PayPal is down", async () => {
      const { order } = await seedOrder();
      mockPayPal(() => json(503, { name: "SERVICE_UNAVAILABLE" }));
      expect(await returnRedirect(db, PAYPAL_ID)).toBe(`https://counter.test/o/${order.statusToken}`);
    });

    it("404s an unknown PayPal order", async () => {
      expect(await returnRedirect(db, "NOPE")).toBeUndefined();
      expect(await returnRedirect(db, null)).toBeUndefined();
    });
  });

  describe("cancel URL", () => {
    it("cancels an unapproved checkout and frees its stock", async () => {
      const { product, order } = await seedOrder();
      expect(await cancelRedirect(db, PAYPAL_ID)).toBe(`https://counter.test/o/${order.statusToken}`);
      expect((await current(order.id)).status).toBe("Canceled");
      expect(await stock(product.id)).toEqual({ stock: 2, reserved: 0 });
    });

    it("leaves a paid order alone", async () => {
      const { order } = await seedOrder();
      paypal(approvedOrder);
      await returnRedirect(db, PAYPAL_ID);
      await cancelRedirect(db, PAYPAL_ID);
      expect((await current(order.id)).status).toBe("PaidHeld");
    });
  });

  describe("webhooks", () => {
    it("records a capture delivered before the return URL, and the return URL then doesn't capture again", async () => {
      const { product, order } = await seedOrder({ status: "Approved" });
      expect(await inbox(fixture("PAYMENT.CAPTURE.COMPLETED"))).toEqual({ status: 200, outcome: "processed" });
      expect(await current(order.id)).toMatchObject({ status: "PaidHeld", captureId: "2DH54088UW786173Y" });

      const { calls } = paypal(completedOrder);
      await returnRedirect(db, PAYPAL_ID);
      expect(calls).toHaveLength(0);
      expect(await stock(product.id)).toEqual({ stock: 1, reserved: 0 });
    });

    it("processes a duplicate delivery once", async () => {
      const { order } = await seedOrder({ status: "Approved" });
      await inbox(fixture("PAYMENT.CAPTURE.COMPLETED"));
      expect(await inbox(fixture("PAYMENT.CAPTURE.COMPLETED"))).toEqual({ status: 200, outcome: "duplicate" });
      const rows = await db.select().from(events).where(eq(events.orderId, order.id));
      expect(rows.filter((e) => e.type === "order.transition" && e.source === "webhook")).toHaveLength(1);
      expect(rows.filter((e) => e.type === "PAYMENT.CAPTURE.COMPLETED")).toHaveLength(1);
    });

    it("moves PENDING → COMPLETED and ignores a late PENDING", async () => {
      const { product, order } = await seedOrder({ status: "Approved" });
      await inbox(captureEvent("PENDING", "WH-PENDING"));
      expect(await current(order.id)).toMatchObject({ status: "PaidPending", captureStatusReason: "PENDING_REVIEW" });
      expect(await stock(product.id)).toEqual({ stock: 2, reserved: 1 });

      await inbox(captureEvent("COMPLETED", "WH-COMPLETED"));
      expect(await current(order.id)).toMatchObject({ status: "PaidHeld", captureStatusReason: null });

      expect(await inbox(captureEvent("PENDING", "WH-PENDING-LATE"))).toMatchObject({ status: 200 });
      expect(await current(order.id)).toMatchObject({ status: "PaidHeld", captureStatus: "COMPLETED" });
      expect(await stock(product.id)).toEqual({ stock: 1, reserved: 0 });

      // One inbox entry per real change: the late PENDING delivery adds nothing.
      const inboxRows = await db.select().from(notifications).orderBy(asc(notifications.createdAt));
      expect(inboxRows.map((n) => [n.kind, n.orderId])).toEqual([
        ["capture_pending", order.id],
        ["paid", order.id],
      ]);
      expect(inboxRows[0]!.params).toMatchObject({ reason: "PENDING_REVIEW", currency: "USD", product: "Tapete" });
    });

    it("denies a pending capture and frees its stock", async () => {
      const { product, order } = await seedOrder({ status: "Approved" });
      await inbox(captureEvent("PENDING", "WH-PENDING"));
      await inbox(captureEvent("DENIED", "WH-DENIED"));
      expect((await current(order.id)).status).toBe("Denied");
      expect(await stock(product.id)).toEqual({ stock: 2, reserved: 0 });
    });

    it("records an APPROVED delivery whose resource is already captured, without calling PayPal", async () => {
      const { order } = await seedOrder();
      const { calls } = mockPayPal(() => {
        throw new Error("no PayPal call expected");
      });
      expect(await inbox(fixture("CHECKOUT.ORDER.APPROVED"))).toEqual({ status: 200, outcome: "processed" });
      expect(calls).toHaveLength(0);
      expect(await current(order.id)).toMatchObject({ status: "PaidHeld", buyerEmail: expect.stringContaining("@") });
    });

    it("captures from an APPROVED delivery when the return URL never fired", async () => {
      const { order } = await seedOrder();
      const raw = JSON.parse(fixture("CHECKOUT.ORDER.APPROVED")) as Record<string, unknown>;
      paypal(approvedOrder);
      await inbox(JSON.stringify({ ...raw, id: "WH-APPROVED-ONLY", resource: approvedOrder }));
      expect((await current(order.id)).status).toBe("PaidHeld");
    });

    it("links the stored event to our order and acknowledges unknown orders", async () => {
      const { order } = await seedOrder({ status: "Approved" });
      await inbox(fixture("PAYMENT.CAPTURE.COMPLETED"));
      const [stored] = await db.select().from(events).where(eq(events.type, "PAYMENT.CAPTURE.COMPLETED"));
      expect(stored!.orderId).toBe(order.id);

      await truncateAll(db);
      expect(await inbox(fixture("PAYMENT.CAPTURE.COMPLETED"))).toEqual({ status: 200, outcome: "processed" });
    });
  });
});

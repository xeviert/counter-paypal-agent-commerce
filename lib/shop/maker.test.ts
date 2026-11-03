import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import type { Order } from "@/lib/db/orders";
import { drafts, events, orders, photos, products, refunds } from "@/lib/db/schema";
import { clearTokenCache } from "@/lib/paypal/client";
import { reviewInput } from "@/lib/schemas/maker";
import { orderValues, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { json, mockPayPal, paypalIssue, stubPayPalEnv } from "@/test/paypal";
import {
  addDraftPhoto,
  DraftError,
  getSellerDraft,
  movePhotoEarlier,
  publishDraft,
  submitCapture,
} from "./drafts";
import { addTracking, FulfillmentError, refundOrder } from "./fulfillment";
import { markAllRead, notify, unreadCount } from "./notifications";
import {
  findSellerOrderByRef,
  getSellerOrder,
  listSellerOrders,
  orderRef,
  payoutStatus,
  salesSummary,
  SELLER_TIME_ZONES,
  sellerSummary,
} from "./seller-orders";
import { setAutoNegotiate, setProductStatus, setProductStock } from "./seller-products";
import { authenticate, createSellerAccount, isDemoSeller, listDemoSellers } from "./sellers";

const jpeg = () => sharp({ create: { width: 20, height: 10, channels: 3, background: "#a33" } }).jpeg().toBuffer();

async function errorCode(promise: Promise<unknown>) {
  const err = await promise.catch((e: unknown) => e);
  return err instanceof DraftError || err instanceof FulfillmentError ? err.code : err;
}

const review = (title = "Wool rug") =>
  reviewInput.parse({
    draft: {
      category: "textiles",
      weightClass: "medium",
      listing: {
        language: "es",
        en: { title, description: "A rug" },
        native: { title: "Tapete", description: "Un tapete" },
      },
    },
    listPrice: "120",
    floorPrice: "100.50",
    stock: "2",
  });

describe.skipIf(!testDatabaseUrl)("maker app", () => {
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

  /** A captured order for the seeded maker, as recordCapture would leave it. */
  async function paidOrder(patch: Partial<typeof orders.$inferInsert> = {}) {
    const { seller, product } = await seedProduct(db);
    const [order] = await db
      .insert(orders)
      .values({
        ...orderValues(seller.id, product.id),
        status: "PaidHeld",
        paypalOrderId: "7FP370406R848663Y",
        captureId: "2DH54088UW786173Y",
        paypalFee: 600,
        netAmount: 16150,
        shippingAddress: { name: { full_name: "Ana Buyer" }, address: { address_line_1: "1 Main St", country_code: "DE" } },
        ...patch,
      })
      .returning();
    return { seller, product, order: order! };
  }

  describe("accounts", () => {
    const input = { name: "Ana", email: "ana@example.com", password: "correct horse", country: "MX" as const, language: "es" as const };

    it("signs up once per email and authenticates only the right password", async () => {
      const created = await createSellerAccount(db, input);
      expect(created).toMatchObject({ ok: true });
      expect(await createSellerAccount(db, { ...input, name: "Other" })).toEqual({ ok: false, error: "email_taken" });
      const id = created.ok ? created.sellerId : "";
      expect(await authenticate(db, "ana@example.com", "correct horse")).toBe(id);
      expect(await authenticate(db, "ana@example.com", "wrong")).toBeUndefined();
      expect(await authenticate(db, "nobody@example.com", "correct horse")).toBeUndefined();
    });

    it("offers only makers without a login for demo sign-in", async () => {
      const { seller: demo } = await seedProduct(db);
      const created = await createSellerAccount(db, input);
      expect((await listDemoSellers(db)).map((s) => s.id)).toEqual([demo.id]);
      expect(await isDemoSeller(db, demo.id)).toBe(true);
      expect(await isDemoSeller(db, created.ok ? created.sellerId : "")).toBe(false);
    });
  });

  describe("scoping", () => {
    it("hides one maker's orders and drafts from another", async () => {
      const { order, seller } = await paidOrder();
      const { seller: other } = await seedProduct(db);
      const { draftId } = await addDraftPhoto(db, seller.id, undefined, await jpeg());

      expect(await getSellerOrder(db, seller.id, order.id)).toBeDefined();
      expect(await getSellerOrder(db, other.id, order.id)).toBeUndefined();
      expect(await getSellerOrder(db, seller.id, "not-a-uuid")).toBeUndefined();
      expect(await listSellerOrders(db, other.id)).toEqual([]);

      expect(await getSellerDraft(db, other.id, draftId)).toBeUndefined();
      expect(await errorCode(addDraftPhoto(db, other.id, draftId, await jpeg()))).toBe("errors.notFound");
      expect(await errorCode(addTracking(db, other, order.id, { carrier: "DHL", trackingNumber: "1234567890" }))).toBe(
        "errors.notFound",
      );
      expect(await errorCode(refundOrder(db, other, order.id, {}))).toBe("errors.notFound");
    });

    it("finds an order by the ref the maker sees, only among their paid orders", async () => {
      const { order, seller, product } = await paidOrder();
      const { seller: other } = await seedProduct(db);
      const ref = orderRef(order.id);

      for (const said of [ref, ref.toLowerCase(), `#${ref}`, ` ${ref} `, order.id]) {
        expect((await findSellerOrderByRef(db, seller.id, said))?.order.id).toBe(order.id);
      }
      expect(await findSellerOrderByRef(db, other.id, ref)).toBeUndefined();
      for (const junk of ["", "123", "3f9a12bz", "%", `${ref}0`]) {
        expect(await findSellerOrderByRef(db, seller.id, junk)).toBeUndefined();
      }

      const [unpaid] = await db
        .insert(orders)
        .values({ ...orderValues(seller.id, product.id), status: "CheckoutCreated" })
        .returning();
      expect(await findSellerOrderByRef(db, seller.id, orderRef(unpaid!.id))).toBeUndefined();
    });

    it("lists only paid orders", async () => {
      const { seller, product } = await seedProduct(db);
      await db.insert(orders).values({ ...orderValues(seller.id, product.id), status: "CheckoutCreated" });
      expect(await listSellerOrders(db, seller.id)).toEqual([]);
    });
  });

  describe("drafts", () => {
    /** Capture submitted and the pipeline failed: the maker writes the listing on review. */
    async function writtenByHand(sellerId: string, draftId: string) {
      await submitCapture(db, sellerId, draftId, "Tapete");
      await db.update(drafts).set({ stage: "failed", error: "refused" }).where(eq(drafts.id, draftId));
    }

    it("creates a draft on the first photo, caps at four and reorders", async () => {
      const { seller } = await seedProduct(db);
      const first = await addDraftPhoto(db, seller.id, undefined, await jpeg());
      const ids = [first.photo.id];
      for (let i = 0; i < 3; i++) ids.push((await addDraftPhoto(db, seller.id, first.draftId, await jpeg())).photo.id);
      expect(await errorCode(addDraftPhoto(db, seller.id, first.draftId, await jpeg()))).toBe("capture.maxPhotos");

      await movePhotoEarlier(db, seller.id, first.draftId, ids[2]!);
      const draft = await getSellerDraft(db, seller.id, first.draftId);
      expect(draft!.photos.map((p) => p.id)).toEqual([ids[0], ids[2], ids[1], ids[3]]);
    });

    it("needs a photo and some words before review", async () => {
      const { seller } = await seedProduct(db);
      const { draftId } = await addDraftPhoto(db, seller.id, undefined, await jpeg());
      expect(await errorCode(submitCapture(db, seller.id, draftId, "  "))).toBe("capture.needWords");
      expect(await submitCapture(db, seller.id, draftId, "Tapete de lana")).toMatchObject({
        draft: { stage: "transcribing", transcript: "Tapete de lana" },
        startPipeline: true,
      });
    });

    it("publishes live with photos attached when the maker can be paid", async () => {
      const { seller } = await seedProduct(db);
      const { draftId } = await addDraftPhoto(db, seller.id, undefined, await jpeg());
      await writtenByHand(seller.id, draftId);
      const published = await publishDraft(db, seller, draftId, review("Wool rug, natural dyes"));

      expect(published.status).toBe("live");
      expect(published.slug).toMatch(/^wool-rug-natural-dyes-[0-9a-f]{4}$/);
      const [product] = await db.select().from(products).where(eq(products.id, published.id));
      expect(product).toMatchObject({ listPrice: 12000, floorPrice: 10050, maxDiscountBps: 1625, stock: 2, sellerId: seller.id });
      expect(product!.publishedAt).toBeInstanceOf(Date);
      const attached = await db.select().from(photos).where(eq(photos.productId, published.id));
      expect(attached).toHaveLength(1);
      expect(await getSellerDraft(db, seller.id, draftId)).toMatchObject({ draft: { stage: "published" } });
      expect(await errorCode(publishDraft(db, seller, draftId, review()))).toBe("errors.notFound");
    });

    it("keeps the product a draft until PayPal is set up", async () => {
      const { seller } = await seedProduct(db, { seller: { paymentsReceivable: false } });
      const { draftId } = await addDraftPhoto(db, seller.id, undefined, await jpeg());
      await writtenByHand(seller.id, draftId);
      expect((await publishDraft(db, seller, draftId, review())).status).toBe("draft");
    });

    it("rejects a floor above the list price", () => {
      const result = reviewInput.safeParse({ ...review(), listPrice: "10", floorPrice: "11" });
      expect(result.success).toBe(false);
    });
  });

  describe("listings", () => {
    it("pauses and resumes, and won't drop stock below reservations", async () => {
      const { seller, product } = await seedProduct(db);
      expect(await setProductStatus(db, seller, product.id, "pause")).toBe(true);
      expect(await setProductStatus(db, seller, product.id, "pause")).toBe(false);
      expect(await setProductStatus(db, seller, product.id, "resume")).toBe(true);

      await db.update(products).set({ reserved: 1 }).where(eq(products.id, product.id));
      expect(await setProductStock(db, seller.id, product.id, 0)).toBe(false);
      expect(await setProductStock(db, seller.id, product.id, 5)).toBe(true);

      const { seller: other } = await seedProduct(db);
      expect(await setProductStatus(db, other, product.id, "pause")).toBe(false);
    });

    it("turns negotiation off and on, only for the maker's own products", async () => {
      const { seller, product } = await seedProduct(db);
      const { seller: other } = await seedProduct(db);
      const autoNegotiate = async () => (await db.select().from(products).where(eq(products.id, product.id)))[0]!.autoNegotiate;
      expect(await setAutoNegotiate(db, other.id, product.id, false)).toBe(false);
      expect(await autoNegotiate()).toBe(true);
      expect(await setAutoNegotiate(db, seller.id, product.id, false)).toBe(true);
      expect(await autoNegotiate()).toBe(false);
      expect(await setAutoNegotiate(db, seller.id, "not-a-uuid", true)).toBe(false);
    });
  });

  describe("tracking", () => {
    it("sends the tracker as the maker and starts the release timer", async () => {
      const { seller, order } = await paidOrder();
      const { calls } = mockPayPal(() => json(201, { id: order.paypalOrderId }));
      const before = Date.now();
      const shipped = await addTracking(db, seller, order.id, { carrier: "MEX_ESTAFETA", trackingNumber: "12 3456 7890" });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.path).toBe("/v2/checkout/orders/7FP370406R848663Y/track");
      expect(calls[0]!.headers.get("PayPal-Request-Id")).toBe(`track:${order.id}`);
      expect(calls[0]!.headers.get("PayPal-Auth-Assertion")).toBeTruthy();
      expect(calls[0]!.body).toEqual({
        capture_id: "2DH54088UW786173Y",
        tracking_number: "1234567890",
        carrier: "MEX_ESTAFETA",
        notify_payer: true,
      });
      expect(shipped).toMatchObject({ status: "Shipped", carrier: "MEX_ESTAFETA", trackingNumber: "1234567890" });
      expect(shipped.releaseDueAt!.getTime()).toBeGreaterThanOrEqual(before + 14 * 24 * 3600_000 - 1000);
    });

    it("requires a name for OTHER and a carrier from the maker's country", async () => {
      const { seller, order } = await paidOrder();
      mockPayPal(() => json(201, { id: "x" }));
      expect(await errorCode(addTracking(db, seller, order.id, { carrier: "OTHER", trackingNumber: "ABC12345" }))).toBe(
        "orders.tracking.invalidNumber",
      );
      expect(await errorCode(addTracking(db, seller, order.id, { carrier: "KENYA_POST", trackingNumber: "ABC12345" }))).toBe(
        "orders.tracking.invalidNumber",
      );
      const shipped = await addTracking(db, seller, order.id, {
        carrier: "OTHER",
        carrierNameOther: "Fletes Oaxaca",
        trackingNumber: "ABC12345",
      });
      expect(shipped.carrierNameOther).toBe("Fletes Oaxaca");
    });

    it("logs who acted when the copilot adds tracking", async () => {
      const { seller, order } = await paidOrder();
      mockPayPal(() => json(201, { id: order.paypalOrderId }));
      await addTracking(db, seller, order.id, { carrier: "DHL", trackingNumber: "1234567890" }, "copilot");
      const [logged] = await db.select().from(events).where(eq(events.orderId, order.id));
      expect(logged).toMatchObject({ type: "order.transition", source: "copilot", actor: seller.id });
    });

    it("refuses orders that aren't waiting to ship", async () => {
      const { seller, order } = await paidOrder({ status: "Shipped" });
      expect(await errorCode(addTracking(db, seller, order.id, { carrier: "DHL", trackingNumber: "1234567890" }))).toBe(
        "errors.notFound",
      );
    });
  });

  describe("refunds", () => {
    const refunded = (cents: number, fee: number) =>
      json(201, {
        id: `R${cents}`,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: (cents / 100).toFixed(2) },
        seller_payable_breakdown: { platform_fees: [{ amount: { currency_code: "USD", value: (fee / 100).toFixed(2) } }] },
      });

    it("refunds partially, then the rest, and ends Refunded", async () => {
      const { seller, order } = await paidOrder();
      const { calls } = mockPayPal((call) => {
        const cents = Math.round(Number((call.body as { amount: { value: string } }).amount.value) * 100);
        return refunded(cents, Math.round(cents * 0.05));
      });

      const partial = await refundOrder(db, seller, order.id, { cents: 2000, reason: "Color differs" });
      expect(partial.order).toMatchObject({ status: "PaidHeld", refundedAmount: 2000, platformFeeRefunded: 100 });
      expect(calls[0]!.headers.get("PayPal-Request-Id")).toBe(`refund:${order.id}:1`);
      expect(calls[0]!.body).toEqual({ amount: { currency_code: "USD", value: "20.00" }, note_to_payer: "Color differs" });

      expect(await errorCode(refundOrder(db, seller, order.id, { cents: 15501 }))).toBe("orders.refund.tooMuch");

      const rest = await refundOrder(db, seller, order.id, {});
      expect(rest.refundedCents).toBe(15500);
      expect(rest.order).toMatchObject({ status: "Refunded", refundedAmount: 17500 });
      expect(calls[1]!.headers.get("PayPal-Request-Id")).toBe(`refund:${order.id}:2`);
      const rows = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
      expect(rows.map((r) => [r.n, r.status, r.amount])).toEqual([
        [1, "COMPLETED", 2000],
        [2, "COMPLETED", 15500],
      ]);
      expect((await db.select().from(events).where(eq(events.type, "order.refunded"))).length).toBe(2);
    });

    it("logs the refund under the source that confirmed it", async () => {
      const { seller, order } = await paidOrder();
      mockPayPal(() => refunded(17500, 750));
      await refundOrder(db, seller, order.id, {}, "copilot");
      const logged = await db.select().from(events).where(eq(events.orderId, order.id));
      expect(logged.map((e) => [e.type, e.source])).toEqual([
        ["order.refunded", "copilot"],
        ["order.transition", "copilot"],
      ]);
    });

    it("retries an unanswered refund with the same request id", async () => {
      const { seller, order } = await paidOrder();
      let fail = true;
      const { calls } = mockPayPal(() => (fail ? json(500, { name: "INTERNAL_SERVER_ERROR" }) : refunded(1000, 50)));
      await expect(refundOrder(db, seller, order.id, { cents: 1000 })).rejects.toThrow();
      fail = false;
      // A second tap with a different amount finishes the first request instead of refunding again.
      const result = await refundOrder(db, seller, order.id, { cents: 3000 });
      expect(result.refundedCents).toBe(1000);
      expect(new Set(calls.map((c) => c.headers.get("PayPal-Request-Id")))).toEqual(new Set([`refund:${order.id}:1`]));
    });

    it("frees the slot after a definite PayPal refusal", async () => {
      const { seller, order } = await paidOrder();
      mockPayPal(() => paypalIssue(422, "REFUND_AMOUNT_EXCEEDED"));
      expect(await errorCode(refundOrder(db, seller, order.id, { cents: 1000 }))).toBe("errors.paypal");
      const [row] = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
      expect(row!.status).toBe("failed");
    });

    it("refuses once the money has been released", async () => {
      const { seller, order } = await paidOrder({ status: "Released", releaseStatus: "released" });
      expect(await errorCode(refundOrder(db, seller, order.id, {}))).toBe("orders.refund.afterRelease");
    });
  });

  describe("summary + inbox", () => {
    it("counts orders to ship, held money and live listings", async () => {
      const { seller } = await paidOrder();
      expect(await sellerSummary(db, seller.id)).toEqual({ toShip: 1, heldCents: 16150, live: 1 });
    });

    it("says when the maker gets paid", () => {
      const day = new Date("2026-11-20T00:00:00Z");
      const at = (status: Order["status"], extra: Partial<Order> = {}) =>
        payoutStatus({ status, releasedAt: null, releaseDueAt: null, ...extra });
      expect(at("Released", { releasedAt: day })).toEqual({ key: "orders.releasedOn", date: day });
      expect(at("Shipped", { releaseDueAt: day })).toEqual({ key: "orders.releaseEta", date: day });
      expect(at("PaidHeld")).toEqual({ key: "orders.releaseAfterTracking" });
      expect(at("Disputed")).toEqual({ key: "orders.held" });
      expect(at("Refunded")).toBeUndefined();
    });

    it("sums sales since the start of the maker's day, week and month", async () => {
      const { seller, product } = await seedProduct(db);
      const { seller: other, product: theirs } = await seedProduct(db);
      const now = new Date();
      const today = await salesSummary(db, seller, "today");
      const sale = (patch: Partial<typeof orders.$inferInsert>, sellerId = seller.id, productId = product.id) =>
        db.insert(orders).values({ ...orderValues(sellerId, productId), capturedAt: now, ...patch });
      await sale({ status: "PaidHeld", netAmount: 16150 });
      await sale({ status: "Released", netAmount: 16150, refundedAmount: 2000, platformFeeRefunded: 100, quantity: 2 });
      await sale({ status: "PaidPending" });
      const beforeToday = new Date(today.since.getTime() - 60_000);
      await sale({ status: "PaidHeld", netAmount: 16150, capturedAt: beforeToday });
      await sale({ status: "CheckoutCreated", capturedAt: null });
      await sale({ status: "PaidHeld", netAmount: 16150 }, other.id, theirs.id);

      const local = (date: Date) =>
        Object.fromEntries(
          new Intl.DateTimeFormat("en-US", {
            timeZone: SELLER_TIME_ZONES.MX,
            hourCycle: "h23",
            weekday: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
            .formatToParts(date)
            .map((p) => [p.type, p.value]),
        );
      expect(local(today.since)).toMatchObject({ hour: "00", minute: "00" });
      expect(now.getTime() - today.since.getTime()).toBeLessThan(24 * 3600_000);
      expect((await salesSummary(db, seller, "today")).totals).toEqual([
        {
          currency: "USD",
          orders: 3,
          units: 4,
          grossCents: 3 * 17500,
          refundedCents: 2000,
          // 16150 held, 16150 - 2000 + 100 released, 17500 - 750 estimated before PayPal's fee is known.
          netCents: 16150 + 14250 + 16750,
          heldCents: 16150,
        },
      ]);

      const week = await salesSummary(db, seller, "week");
      expect(local(week.since)).toMatchObject({ weekday: "Mon", hour: "00", minute: "00" });
      const month = await salesSummary(db, seller, "month");
      expect(local(month.since)).toMatchObject({ day: "1", hour: "00", minute: "00" });
      expect(month.totals[0]!.orders).toBe(month.since <= beforeToday ? 4 : 3);
    });

    it("counts unread notifications until read", async () => {
      const { seller } = await seedProduct(db);
      await notify(db, seller.id, "paid", { product: "Tapete", amountCents: 100, currency: "USD" });
      await notify(db, seller.id, "funds_released");
      expect(await unreadCount(db, seller.id)).toBe(2);
      await markAllRead(db, seller.id);
      expect(await unreadCount(db, seller.id)).toBe(0);
    });
  });
});

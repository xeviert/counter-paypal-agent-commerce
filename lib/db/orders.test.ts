import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PolicyError } from "@/lib/policy/errors";
import { CHECKOUT_TTL_MS, InvalidTransitionError } from "@/lib/policy/lifecycle";
import { quoteOrder } from "@/lib/policy/quote";
import type { OrderStatus } from "@/lib/schemas/common";
import { statusToken } from "@/lib/schemas/common";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import type { Db } from "./index";
import { expireStaleCheckouts, openCheckout, transition } from "./orders";
import { events, orders, products } from "./schema";

describe.skipIf(!testDatabaseUrl)("orders", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  const quote = (quantity = 1) =>
    quoteOrder({
      unitCents: 15000,
      quantity,
      currency: "USD",
      sellerCountry: "MX",
      buyerCountry: "US",
      weightClass: "medium",
      feeBps: 500,
    });

  async function checkout(opts: { stock?: number; quantity?: number; now?: Date } = {}) {
    const { product } = await seedProduct(db, { stock: opts.stock ?? 2 });
    const order = await openCheckout(db, {
      product,
      quote: quote(opts.quantity),
      source: "mcp",
      agentId: "agt_test",
      now: opts.now,
    });
    return { product, order };
  }

  const reserved = async (productId: string) =>
    (await db.select().from(products).where(eq(products.id, productId)))[0]!;

  const orderEvents = (orderId: string) =>
    db.select().from(events).where(eq(events.orderId, orderId)).orderBy(asc(events.id));

  async function walk(orderId: string, path: OrderStatus[]) {
    for (const to of path) await transition(db, orderId, to, { source: "web" });
  }

  describe("openCheckout", () => {
    it("reserves stock, stores the quote and logs order.created", async () => {
      const now = new Date("2026-10-30T12:00:00Z");
      const { product, order } = await checkout({ quantity: 2, now });
      expect(order).toMatchObject({
        status: "CheckoutCreated",
        quantity: 2,
        unitAmount: 15000,
        itemAmount: 30000,
        shippingAmount: 2200,
        platformFee: 1500,
        currency: "USD",
        buyerCountry: "US",
        agentId: "agt_test",
        releaseStatus: "held",
      });
      expect(order.expiresAt.getTime()).toBe(now.getTime() + CHECKOUT_TTL_MS);
      expect(statusToken.safeParse(order.statusToken).success).toBe(true);
      expect(await reserved(product.id)).toMatchObject({ stock: 2, reserved: 2 });
      const logged = await orderEvents(order.id);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ type: "order.created", source: "mcp", actor: "agt_test" });
    });

    it("throws OUT_OF_STOCK and writes nothing when stock is short", async () => {
      const { product } = await seedProduct(db, { stock: 1 });
      const err = await openCheckout(db, { product, quote: quote(2), source: "mcp" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PolicyError);
      expect((err as PolicyError).code).toBe("OUT_OF_STOCK");
      expect(await db.select().from(orders)).toHaveLength(0);
      expect(await db.select().from(events)).toHaveLength(0);
      expect(await reserved(product.id)).toMatchObject({ stock: 1, reserved: 0 });
    });
  });

  describe("transition", () => {
    it("applies an allowed edge, sets patch fields and logs one event", async () => {
      const { order } = await checkout();
      const approvedAt = new Date();
      const result = await transition(db, order.id, "Approved", {
        source: "web",
        actor: "buyer",
        patch: { approvedAt },
        payload: { trigger: "return_url" },
      });
      expect(result.changed).toBe(true);
      expect(result.order).toMatchObject({ status: "Approved", approvedAt });
      const logged = await orderEvents(order.id);
      expect(logged).toHaveLength(2);
      expect(logged[1]).toMatchObject({
        type: "order.transition",
        source: "web",
        actor: "buyer",
        payload: { from: "CheckoutCreated", to: "Approved", stock: "none", trigger: "return_url" },
      });
    });

    it("rejects a forbidden edge without writing anything", async () => {
      const { order } = await checkout();
      await expect(transition(db, order.id, "Released", { source: "web" })).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
      expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("CheckoutCreated");
      expect(await orderEvents(order.id)).toHaveLength(1);
    });

    it("treats a repeat of the current status as a no-op", async () => {
      const { order } = await checkout();
      await transition(db, order.id, "Approved", { source: "web" });
      const again = await transition(db, order.id, "Approved", { source: "webhook" });
      expect(again.changed).toBe(false);
      expect(await orderEvents(order.id)).toHaveLength(2);
    });

    it("skips when the order has left the expected `from` states", async () => {
      const { order } = await checkout();
      await transition(db, order.id, "Approved", { source: "web" });
      const result = await transition(db, order.id, "Expired", { source: "cron", from: ["CheckoutCreated"] });
      expect(result).toMatchObject({ changed: false, order: { status: "Approved" } });
      expect(await orderEvents(order.id)).toHaveLength(2);
    });

    it.each([
      [["Expired"]],
      [["Canceled"]],
      [["Approved", "Canceled"]],
      [["Approved", "PaidPending", "Denied"]],
    ] as OrderStatus[][][])("releases reserved stock on %j", async (path) => {
      const { product, order } = await checkout();
      await walk(order.id, path);
      expect(await reserved(product.id)).toMatchObject({ stock: 2, reserved: 0 });
    });

    it("commits stock on capture and keeps it sold through refund", async () => {
      const { product, order } = await checkout({ stock: 3, quantity: 2 });
      await walk(order.id, ["Approved", "PaidPending"]);
      expect(await reserved(product.id)).toMatchObject({ stock: 3, reserved: 2 });
      await walk(order.id, ["PaidHeld", "Shipped", "Refunded"]);
      expect(await reserved(product.id)).toMatchObject({ stock: 1, reserved: 0 });
    });

    it("serializes racing triggers so stock moves once", async () => {
      const { product, order } = await checkout();
      await transition(db, order.id, "Approved", { source: "web" });
      const results = await Promise.all([
        transition(db, order.id, "PaidHeld", { source: "web" }),
        transition(db, order.id, "PaidHeld", { source: "webhook" }),
      ]);
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(await reserved(product.id)).toMatchObject({ stock: 1, reserved: 0 });
    });
  });

  describe("expireStaleCheckouts", () => {
    it("expires only CheckoutCreated orders past expires_at and frees their stock", async () => {
      const longAgo = new Date(Date.now() - CHECKOUT_TTL_MS - 60_000);
      const stale = await checkout({ now: longAgo });
      const fresh = await checkout();
      const staleApproved = await checkout({ now: longAgo });
      await transition(db, staleApproved.order.id, "Approved", { source: "web" });

      expect(await expireStaleCheckouts(db)).toBe(1);

      const status = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!.status;
      expect(await status(stale.order.id)).toBe("Expired");
      expect(await status(fresh.order.id)).toBe("CheckoutCreated");
      expect(await status(staleApproved.order.id)).toBe("Approved");
      expect(await reserved(stale.product.id)).toMatchObject({ reserved: 0 });
      expect(await reserved(fresh.product.id)).toMatchObject({ reserved: 1 });
      expect((await orderEvents(stale.order.id)).at(-1)).toMatchObject({
        source: "cron",
        payload: { from: "CheckoutCreated", to: "Expired", stock: "release" },
      });

      expect(await expireStaleCheckouts(db)).toBe(0);
    });
  });
});

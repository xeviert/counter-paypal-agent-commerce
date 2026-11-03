import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { events, offers, orders, products } from "@/lib/db/schema";
import { clearTokenCache } from "@/lib/paypal/client";
import { PolicyError } from "@/lib/policy/errors";
import { createCheckoutInput, createCheckoutOutput } from "@/lib/schemas/mcp";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { json, mockPayPal, paypalIssue, stubPayPalEnv } from "@/test/paypal";
import { createCheckout } from "./checkout";
import { OFFER_TTL_MS } from "./offers";

const PAYPAL_ID = "7FP370406R848663Y";

const created = () =>
  json(200, {
    id: PAYPAL_ID,
    status: "PAYER_ACTION_REQUIRED",
    links: [{ href: `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ID}`, rel: "payer-action" }],
  });

async function policyCode(promise: Promise<unknown>) {
  const err = await promise.catch((e: unknown) => e);
  return err instanceof PolicyError ? err.code : err;
}

describe.skipIf(!testDatabaseUrl)("createCheckout", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    stubPayPalEnv();
    vi.stubEnv("PLATFORM_FEE_BPS", "500");
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

  const checkout = (productId: string, extra: Record<string, unknown> = {}) =>
    createCheckout(db, createCheckoutInput.parse({ productId, buyerCountry: "US", quantity: 2, ...extra }), {
      agentId: "agt_test",
    });

  const productRow = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0]!;

  it("prices from the listing, creates the PayPal order and stores its link", async () => {
    const { product, seller } = await seedProduct(db, { stock: 3 });
    const { calls } = mockPayPal(created);
    const { output, order } = await checkout(product.id, { price: "0.01" });

    expect(createCheckoutOutput.parse(output)).toEqual(output);
    expect(output).toMatchObject({
      approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ID}`,
      statusUrl: `https://counter.test/o/${order.statusToken}`,
      quantity: 2,
      unitPrice: { currency: "USD", value: "150.00" },
      totals: {
        item: { currency: "USD", value: "300.00" },
        shipping: { currency: "USD", value: "22.00" },
        total: { currency: "USD", value: "322.00" },
      },
    });

    const call = calls.find((c) => c.path === "/v2/checkout/orders")!;
    expect(call.headers.get("PayPal-Request-Id")).toBe(`create:${order.id}`);
    const unit = (call.body as { purchase_units: Record<string, unknown>[] }).purchase_units[0]!;
    expect(unit).toMatchObject({
      reference_id: order.id,
      payee: { merchant_id: seller.merchantId },
      amount: { value: "322.00", breakdown: { item_total: { value: "300.00" }, shipping: { value: "22.00" } } },
      payment_instruction: { platform_fees: [{ amount: { value: "15.00" } }], disbursement_mode: "DELAYED" },
    });

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: "CheckoutCreated", paypalOrderId: PAYPAL_ID, approvalUrl: output.approvalUrl });
    expect(await productRow(product.id)).toMatchObject({ stock: 3, reserved: 2 });
  });

  it.each([
    ["not receivable", { paymentsReceivable: false }],
    ["consent revoked", { consentStatus: "revoked" as const }],
    ["not onboarded", { merchantId: null }],
  ])("refuses a seller that is %s without creating an order", async (_, seller) => {
    const { product } = await seedProduct(db, { seller });
    const { calls } = mockPayPal(created);
    expect(await policyCode(checkout(product.id))).toBe("SELLER_NOT_RECEIVABLE");
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("returns OUT_OF_STOCK without calling PayPal", async () => {
    const { product } = await seedProduct(db, { stock: 1 });
    const { calls } = mockPayPal(created);
    expect(await policyCode(checkout(product.id))).toBe("OUT_OF_STOCK");
    expect(calls).toHaveLength(0);
  });

  it("cancels the order and frees stock when PayPal refuses the payee", async () => {
    const { product } = await seedProduct(db, { stock: 2 });
    mockPayPal(() => paypalIssue(422, "PAYEE_NOT_CONSENTED"));
    expect(await policyCode(checkout(product.id))).toBe("SELLER_NOT_RECEIVABLE");
    const [row] = await db.select().from(orders);
    expect(row).toMatchObject({ status: "Canceled", paypalOrderId: null });
    expect(await productRow(product.id)).toMatchObject({ stock: 2, reserved: 0 });
  });

  it("maps a PayPal outage to PAYMENT_PROVIDER_ERROR and frees stock", async () => {
    const { product } = await seedProduct(db, { stock: 2 });
    mockPayPal(() => json(500, { name: "INTERNAL_SERVER_ERROR", debug_id: "dbg" }));
    expect(await policyCode(checkout(product.id))).toBe("PAYMENT_PROVIDER_ERROR");
    expect(await productRow(product.id)).toMatchObject({ reserved: 0 });
  });

  it("logs the caller's channel on the order events", async () => {
    const { product } = await seedProduct(db, { stock: 4 });
    mockPayPal(created);
    const input = createCheckoutInput.parse({ productId: product.id, buyerCountry: "US" });
    const { order } = await createCheckout(db, input, { agentId: "agt_acp", source: "acp" });
    const logged = await db.select().from(events).where(eq(events.orderId, order.id));
    expect(logged.map((e) => [e.type, e.source])).toEqual([["order.created", "acp"]]);

    mockPayPal(() => json(500, { name: "INTERNAL_SERVER_ERROR" }));
    await createCheckout(db, input, { source: "acp" }).catch(() => {});
    const [canceled] = await db.select().from(events).where(eq(events.type, "order.transition"));
    expect(canceled).toMatchObject({ source: "acp", payload: { to: "Canceled" } });
  });

  it("rejects a destination outside the shipping table", async () => {
    const { product } = await seedProduct(db);
    mockPayPal(created);
    expect(await policyCode(checkout(product.id, { buyerCountry: "IR" }))).toBe("UNSUPPORTED_COUNTRY");
  });

  describe("with an offer", () => {
    const seedOffer = async (productId: string, values: Partial<typeof offers.$inferInsert> = {}) =>
      (
        await db
          .insert(offers)
          .values({
            productId,
            agentId: "agt_test",
            offeredAmount: 12000,
            counterAmount: 13500,
            agreedAmount: 13500,
            currency: "USD",
            decision: "counter",
            expiresAt: new Date(Date.now() + OFFER_TTL_MS),
            ...values,
          })
          .returning()
      )[0]!;

    const offerCheckout = (offerId: string, extra: Record<string, unknown> = {}) =>
      createCheckout(db, createCheckoutInput.parse({ offerId, buyerCountry: "US", quantity: 2, ...extra }), {
        agentId: "agt_test",
      });

    it("charges the agreed price per item and uses the offer once", async () => {
      const { product } = await seedProduct(db, { stock: 4 });
      const offer = await seedOffer(product.id);
      const { calls } = mockPayPal(created);
      const { output, order } = await offerCheckout(offer.id);

      expect(output).toMatchObject({
        unitPrice: { value: "135.00" },
        totals: { item: { value: "270.00" }, shipping: { value: "22.00" }, total: { value: "292.00" } },
      });
      expect(order).toMatchObject({ offerId: offer.id, unitAmount: 13500, platformFee: 1350 });
      const unit = (calls.find((c) => c.path === "/v2/checkout/orders")!.body as { purchase_units: { amount: unknown }[] })
        .purchase_units[0]!;
      expect(unit.amount).toMatchObject({ value: "292.00" });
      expect((await db.select().from(offers).where(eq(offers.id, offer.id)))[0]!.usedAt).not.toBeNull();

      expect(await policyCode(offerCheckout(offer.id))).toBe("OFFER_EXPIRED");
      expect(await db.select().from(orders)).toHaveLength(1);
    });

    it("leaves the offer usable when stock runs out", async () => {
      const { product } = await seedProduct(db, { stock: 1 });
      const offer = await seedOffer(product.id);
      mockPayPal(created);
      expect(await policyCode(offerCheckout(offer.id))).toBe("OUT_OF_STOCK");
      expect((await db.select().from(offers).where(eq(offers.id, offer.id)))[0]!.usedAt).toBeNull();
      await expect(offerCheckout(offer.id, { quantity: 1 })).resolves.toBeDefined();
    });

    it("refuses rejected, expired and mismatched offers", async () => {
      const { product } = await seedProduct(db);
      const other = (await seedProduct(db)).product;
      mockPayPal(created);
      const rejected = await seedOffer(product.id, { decision: "reject", counterAmount: null, agreedAmount: null });
      const expired = await seedOffer(product.id, { expiresAt: new Date(Date.now() - 1000) });
      const fine = await seedOffer(product.id);
      expect(await policyCode(offerCheckout(rejected.id))).toBe("OFFER_REJECTED");
      expect(await policyCode(offerCheckout(expired.id))).toBe("OFFER_EXPIRED");
      expect(await policyCode(offerCheckout(fine.id, { productId: other.id }))).toBe("OFFER_NOT_FOUND");
      expect(await policyCode(offerCheckout(crypto.randomUUID()))).toBe("OFFER_NOT_FOUND");
      expect(await db.select().from(orders)).toHaveLength(0);
    });

    it("needs a product or an offer", async () => {
      expect(
        await policyCode(createCheckout(db, createCheckoutInput.parse({ buyerCountry: "US" }), { agentId: "agt_test" })),
      ).toBe("PRODUCT_NOT_FOUND");
    });
  });
});

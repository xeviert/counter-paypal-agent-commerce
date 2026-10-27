import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockPayPal, paypalIssue, stubPayPalEnv } from "@/test/paypal";
import { clearTokenCache } from "./client";
import {
  buildCreateOrderBody,
  captureDetails,
  captureOrder,
  createOrder,
  SellerNotReceivableError,
  shipToCountry,
  type CreateOrderInput,
} from "./orders";
import { order } from "@/lib/schemas/paypal";

const ORDER_ID = "0b6f7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const PAYPAL_ID = "7FP370406R848663Y";

const input: CreateOrderInput = {
  orderId: ORDER_ID,
  merchantId: "MPMWEFYQWQYUA",
  currency: "USD",
  item: { name: "Handwoven rug", sku: "prod-1", unitCents: 4999, quantity: 3 },
  shippingCents: 2500,
  platformFeeCents: 750,
};

// Real completed order from spike 11: capture, fees, shipping and payer. Delivered after the $2 partial refund.
const completedOrder: unknown = (
  JSON.parse(
    (JSON.parse(readFileSync("test/fixtures/webhooks/CHECKOUT.ORDER.COMPLETED.json", "utf8")) as { raw_body: string })
      .raw_body,
  ) as { resource: unknown }
).resource;

describe("buildCreateOrderBody", () => {
  it("routes to the maker with a delayed platform fee and matching totals", () => {
    const body = buildCreateOrderBody(input, "https://counter.test");
    const unit = body.purchase_units[0]!;
    expect(unit.reference_id).toBe(ORDER_ID);
    expect(unit.custom_id).toBe(ORDER_ID);
    expect(unit.payee).toEqual({ merchant_id: "MPMWEFYQWQYUA" });
    expect(unit.items[0]).toEqual({
      name: "Handwoven rug",
      sku: "prod-1",
      quantity: "3",
      category: "PHYSICAL_GOODS",
      unit_amount: { currency_code: "USD", value: "49.99" },
    });
    expect(unit.amount).toEqual({
      currency_code: "USD",
      value: "174.97",
      breakdown: {
        item_total: { currency_code: "USD", value: "149.97" },
        shipping: { currency_code: "USD", value: "25.00" },
      },
    });
    expect(unit.payment_instruction).toEqual({
      platform_fees: [{ amount: { currency_code: "USD", value: "7.50" } }],
      disbursement_mode: "DELAYED",
    });
    expect(body.payment_source.paypal.experience_context).toEqual({
      return_url: "https://counter.test/checkout/return",
      cancel_url: "https://counter.test/checkout/cancel",
      user_action: "PAY_NOW",
      shipping_preference: "GET_FROM_FILE",
      brand_name: "Counter",
    });
  });

  it("omits a zero platform fee but keeps DELAYED", () => {
    const body = buildCreateOrderBody({ ...input, platformFeeCents: 0 }, "https://counter.test");
    expect(body.purchase_units[0]!.payment_instruction).toEqual({ disbursement_mode: "DELAYED" });
  });

  it.each([
    ["fractional cents", { ...input, shippingCents: 2.5 }],
    ["negative cents", { ...input, platformFeeCents: -1 }],
    ["zero quantity", { ...input, item: { ...input.item, quantity: 0 } }],
    ["fee above item total", { ...input, platformFeeCents: 15000 }],
  ])("rejects %s", (_, bad) => {
    expect(() => buildCreateOrderBody(bad, "https://counter.test")).toThrow();
  });
});

describe("orders API", () => {
  beforeEach(() => {
    stubPayPalEnv();
    clearTokenCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates with the order-derived request id and returns the payer-action link", async () => {
    const { calls } = mockPayPal(() =>
      json(200, {
        id: PAYPAL_ID,
        status: "PAYER_ACTION_REQUIRED",
        links: [{ href: `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ID}`, rel: "payer-action" }],
      }),
    );
    const result = await createOrder(input);
    expect(result.paypalOrderId).toBe(PAYPAL_ID);
    expect(result.approvalUrl).toContain("checkoutnow");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/checkout/orders" });
    expect(calls[0]?.headers.get("PayPal-Request-Id")).toBe(`create:${ORDER_ID}`);
  });

  it("maps payee errors to SellerNotReceivableError", async () => {
    mockPayPal(() => paypalIssue(403, "PAYEE_NOT_CONSENTED"));
    await expect(createOrder(input)).rejects.toMatchObject({
      name: "SellerNotReceivableError",
      issue: "PAYEE_NOT_CONSENTED",
    });
    await expect(createOrder(input)).rejects.toBeInstanceOf(SellerNotReceivableError);
  });

  it("captures with request id and full representation", async () => {
    const { calls } = mockPayPal(() => json(201, completedOrder));
    const result = await captureOrder(ORDER_ID, PAYPAL_ID);
    expect(result.kind).toBe("captured");
    expect(calls[0]).toMatchObject({ method: "POST", path: `/v2/checkout/orders/${PAYPAL_ID}/capture` });
    expect(calls[0]?.headers.get("PayPal-Request-Id")).toBe(`capture:${ORDER_ID}`);
    expect(calls[0]?.headers.get("Prefer")).toBe("return=representation");
  });

  it("treats ORDER_ALREADY_CAPTURED as success by fetching the order", async () => {
    const { calls } = mockPayPal((call) =>
      call.method === "POST" ? paypalIssue(422, "ORDER_ALREADY_CAPTURED") : json(200, completedOrder),
    );
    const result = await captureOrder(ORDER_ID, PAYPAL_ID);
    expect(result.kind).toBe("captured");
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it.each(["INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "ORDER_NOT_APPROVED"])(
    "sends the buyer back on %s",
    async (issue) => {
      mockPayPal(() => paypalIssue(422, issue));
      expect(await captureOrder(ORDER_ID, PAYPAL_ID)).toEqual({ kind: "payer_action", issue });
    },
  );

  it("rethrows other capture errors", async () => {
    mockPayPal(() => paypalIssue(422, "TRANSACTION_REFUSED"));
    await expect(captureOrder(ORDER_ID, PAYPAL_ID)).rejects.toMatchObject({ issue: "TRANSACTION_REFUSED" });
  });
});

describe("captureDetails", () => {
  it("extracts what we store from the real spike capture", () => {
    const o = order.parse(completedOrder);
    expect(shipToCountry(o)).toBe("US");
    expect(captureDetails(o)).toEqual({
      captureId: "2DH54088UW786173Y",
      status: "PARTIALLY_REFUNDED",
      statusReason: undefined,
      amount: { currency: "USD", cents: 1000 },
      paypalFeeCents: 69,
      platformFeeCents: 50,
      netCents: 881,
      shipping: expect.objectContaining({ name: { full_name: "John Doe" } }),
      payer: { payerId: "KG9W38PMY52F8", email: "sb-xkveo53530182@personal.example.com", name: "John Doe" },
    });
  });

  it("throws when the order has no capture", () => {
    expect(() => captureDetails(order.parse({ id: PAYPAL_ID, status: "APPROVED" }))).toThrow(/no capture/);
  });
});

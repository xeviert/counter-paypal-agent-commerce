import { describe, expect, it } from "vitest";
import type { Order } from "@/lib/db/orders";
import { ORDER_STATUSES } from "@/lib/schemas/common";
import { getOrderStatusOutput } from "@/lib/schemas/mcp";
import { nextStep, orderStatusView, shipToSummary } from "./order-status";

const now = new Date("2026-10-30T12:00:00Z");

const order: Order = {
  id: "0b6f7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b",
  statusToken: "q8Vb3xYz0123456789_-AB",
  paypalOrderId: "7FP370406R848663Y",
  approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=7FP370406R848663Y",
  captureId: null,
  sellerId: "2f1c6a1e-8a2b-4c3d-9e4f-5a6b7c8d9e01",
  productId: "2f1c6a1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f",
  offerId: null,
  agentId: "agt_test",
  quantity: 2,
  unitAmount: 15000,
  itemAmount: 30000,
  shippingAmount: 2200,
  currency: "USD",
  platformFee: 1500,
  paypalFee: null,
  netAmount: null,
  refundedAmount: 0,
  platformFeeRefunded: 0,
  buyerCountry: "US",
  buyerName: null,
  buyerEmail: null,
  payerId: null,
  shippingAddress: null,
  status: "CheckoutCreated",
  captureStatus: null,
  captureStatusReason: null,
  releaseStatus: "held",
  releaseDueAt: null,
  releasedAt: null,
  payoutItemId: null,
  disputeId: null,
  carrier: null,
  carrierNameOther: null,
  trackingNumber: null,
  shippedAt: null,
  expiresAt: new Date("2026-10-30T15:00:00Z"),
  approvedAt: null,
  capturedAt: null,
  buyerConfirmedAt: null,
  createdAt: new Date("2026-10-30T12:00:00Z"),
  updatedAt: new Date("2026-10-30T12:00:00Z"),
};

const product = { id: order.productId, title: "Handwoven wool rug" };

const address = {
  name: { full_name: "John Doe" },
  address: {
    address_line_1: "1 Main St",
    admin_area_2: "San Jose",
    admin_area_1: "CA",
    postal_code: "95131",
    country_code: "US",
  },
};

describe("nextStep", () => {
  it.each(ORDER_STATUSES)("has a sentence for %s", (status) => {
    expect(nextStep({ ...order, status }, now)).toMatch(/\.$/);
  });

  it("tells the agent an unswept, past-expiry checkout has expired", () => {
    expect(nextStep(order, now)).toMatch(/approve the payment on PayPal/);
    expect(nextStep(order, new Date("2026-10-30T15:00:00Z"))).toMatch(/expired/);
  });

  it("includes the pending reason and carrier when known", () => {
    expect(nextStep({ ...order, status: "PaidPending", captureStatusReason: "PENDING_REVIEW" })).toContain(
      "PENDING_REVIEW",
    );
    expect(nextStep({ ...order, status: "Shipped", carrier: "OTHER", carrierNameOther: "Estafeta" })).toContain(
      "Estafeta",
    );
  });

  it("says why a ship-to region mismatch canceled the checkout", () => {
    const canceled = { ...order, status: "Canceled" as const, buyerCountry: "DE", shippingAddress: { address: { country_code: "US" } } };
    expect(nextStep(canceled)).toMatch(/quoted to DE, but the PayPal address is in US/);
    expect(nextStep({ ...order, status: "Canceled", shippingAddress: null })).toMatch(/^This checkout was canceled/);
  });
});

describe("shipToSummary", () => {
  it("keeps only city and country", () => {
    expect(shipToSummary(address)).toEqual({ city: "San Jose", country: "US" });
    expect(shipToSummary({ address: { country_code: "DE" } })).toEqual({ country: "DE" });
  });

  it("is empty without an address", () => {
    expect(shipToSummary(null)).toBeUndefined();
    expect(shipToSummary({ name: { full_name: "x" } })).toBeUndefined();
    expect(shipToSummary("garbage")).toBeUndefined();
  });
});

describe("orderStatusView", () => {
  it("shows the approval link and expiry while awaiting approval", () => {
    const view = orderStatusView(order, product, now);
    expect(getOrderStatusOutput.parse(view)).toEqual(view);
    expect(view).toMatchObject({
      status: "CheckoutCreated",
      approvalUrl: order.approvalUrl,
      expiresAt: "2026-10-30T15:00:00.000Z",
      totals: {
        item: { currency: "USD", value: "300.00" },
        shipping: { currency: "USD", value: "22.00" },
        total: { currency: "USD", value: "322.00" },
      },
    });
  });

  it("drops the approval link once paid and never exposes the street address", () => {
    const view = orderStatusView(
      { ...order, status: "Shipped", shippingAddress: address, carrier: "FEDEX", trackingNumber: "123" },
      product,
      now,
    );
    expect(getOrderStatusOutput.parse(view)).toEqual(view);
    expect(view.approvalUrl).toBeUndefined();
    expect(view.expiresAt).toBeUndefined();
    expect(view.tracking).toEqual({ carrier: "FEDEX", number: "123" });
    expect(JSON.stringify(view)).not.toMatch(/Main St|95131|John Doe/);
  });
});

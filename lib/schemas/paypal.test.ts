import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  approvalLink,
  capture,
  firstCapture,
  grantedScopes,
  merchantIntegration,
  order,
  paypalMoney,
  referencedPayoutItem,
} from "./paypal";

// Real sandbox deliveries from spike 11 (Oct 27).
function fixtureResource(eventType: string): unknown {
  const { raw_body } = JSON.parse(readFileSync(`test/fixtures/webhooks/${eventType}.json`, "utf8")) as {
    raw_body: string;
  };
  return (JSON.parse(raw_body) as { resource: unknown }).resource;
}

describe("paypalMoney", () => {
  it("converts to cents", () => {
    expect(paypalMoney.parse({ currency_code: "USD", value: "8.81" })).toEqual({ currency: "USD", cents: 881 });
  });

  it("rejects malformed values without throwing outside zod", () => {
    expect(paypalMoney.safeParse({ currency_code: "USD", value: "8.811" }).success).toBe(false);
    expect(paypalMoney.safeParse({ currency_code: "USD", value: 8.81 }).success).toBe(false);
  });
});

describe("capture", () => {
  it("parses the PAYMENT.CAPTURE.COMPLETED resource with the DELAYED fee breakdown", () => {
    const c = capture.parse(fixtureResource("PAYMENT.CAPTURE.COMPLETED"));
    expect(c.disbursement_mode).toBe("DELAYED");
    expect(c.amount).toEqual({ currency: "USD", cents: 1000 });
    const b = c.seller_receivable_breakdown!;
    expect(b.paypal_fee?.cents).toBe(69);
    expect(b.platform_fees?.[0]?.amount.cents).toBe(50);
    expect(b.net_amount?.cents).toBe(881);
    expect(b.receivable_amount).toEqual({ currency_code: "PHP", value: "543.41" });
    expect(c.supplementary_data?.related_ids?.order_id).toBe("7FP370406R848663Y");
  });

  it("keeps PENDING reasons", () => {
    const c = capture.parse({
      id: "C1",
      status: "PENDING",
      status_details: { reason: "PENDING_REVIEW" },
      amount: { currency_code: "USD", value: "10.00" },
    });
    expect(c.status_details?.reason).toBe("PENDING_REVIEW");
  });
});

describe("order", () => {
  it("parses the CHECKOUT.ORDER.COMPLETED resource: capture, shipping and payer", () => {
    const o = order.parse(fixtureResource("CHECKOUT.ORDER.COMPLETED"));
    expect(firstCapture(o)?.id).toBe("2DH54088UW786173Y");
    expect(o.purchase_units?.[0]?.shipping?.address?.country_code).toBe("US");
    expect(o.purchase_units?.[0]?.shipping?.name?.full_name).toBe("John Doe");
    expect(o.payer?.payer_id).toBe("KG9W38PMY52F8");
    expect(o.payer?.email_address).toMatch(/@personal\.example\.com$/);
  });

  it("parses CHECKOUT.ORDER.APPROVED", () => {
    expect(order.safeParse(fixtureResource("CHECKOUT.ORDER.APPROVED")).success).toBe(true);
  });

  it("finds the payer-action link on a create response", () => {
    const o = order.parse({
      id: "5O190127TN364715T",
      status: "PAYER_ACTION_REQUIRED",
      links: [
        { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T", rel: "self", method: "GET" },
        { href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action", method: "GET" },
      ],
    });
    expect(approvalLink(o)).toBe("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T");
    expect(firstCapture(o)).toBeUndefined();
  });
});

describe("merchantIntegration", () => {
  it("collects granted scopes", () => {
    const m = merchantIntegration.parse({
      merchant_id: "MPMWEFYQWQYUA",
      tracking_id: "seller-1",
      payments_receivable: true,
      primary_email_confirmed: true,
      oauth_integrations: [
        {
          integration_type: "OAUTH_THIRD_PARTY",
          oauth_third_party: [
            { partner_client_id: "x", scopes: ["https://uri.paypal.com/services/payments/payment", "a"] },
            { scopes: ["a", "b"] },
          ],
        },
      ],
    });
    expect(grantedScopes(m)).toEqual(["https://uri.paypal.com/services/payments/payment", "a", "b"]);
  });
});

describe("referencedPayoutItem", () => {
  it("parses the webhook resource with its minor-unit payout_amount", () => {
    const item = referencedPayoutItem.parse(fixtureResource("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED"));
    expect(item.processing_state?.status).toBe("SUCCESS");
    expect(item.payout_amount).toMatchObject({ amount: expect.any(Number), currencyCode: expect.any(String) });
  });

  it("parses a release response whose payout_amount isn't in the webhook shape", () => {
    const item = referencedPayoutItem.parse({
      item_id: "ITEM-1",
      reference_id: "0UR37491K86413925",
      reference_type: "TRANSACTION_ID",
      processing_state: { status: "SUCCESS" },
      payout_amount: { currency_code: "MXN", value: "512.40" },
    });
    expect(item.payout_amount).toEqual({ currency_code: "MXN", value: "512.40" });
  });

  // Written by `pnpm e2e:release`.
  const release = "test/fixtures/paypal/referenced-payouts.release.json";
  it.skipIf(!existsSync(release))("parses the sandbox release response", () => {
    const item = referencedPayoutItem.parse(JSON.parse(readFileSync(release, "utf8")));
    expect(item.processing_state?.status).toBe("SUCCESS");
  });
});

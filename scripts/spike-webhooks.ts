// Spike 11: drive a real sandbox order so PayPal emits webhooks to /api/webhooks/paypal.
// create (payee PH maker, platform fee, DELAYED) → buyer approves → capture → partial refund → release.
// Usage: pnpm spike:webhooks   (needs the app reachable at APP_BASE_URL and the webhook registered)
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { getEnv } = await import("@/lib/env");
const { paypalRequest } = await import("@/lib/paypal/client");

const PH_MERCHANT_ID = "MPMWEFYQWQYUA";
const env = getEnv();
const run = randomUUID();
const assertion = (payerId: string) =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(
    JSON.stringify({ iss: env.PLATFORM_CLIENT_ID, payer_id: payerId }),
  ).toString("base64url")}.`;

type Link = { rel: string; href: string };
type Order = { id: string; status: string; links: Link[] };
type Capture = {
  id: string;
  status: string;
  status_details?: { reason: string };
  seller_receivable_breakdown?: unknown;
};

const order = await paypalRequest<Order>("orders.create", "/v2/checkout/orders", {
  method: "POST",
  headers: { "PayPal-Request-Id": `spike-create:${run}` },
  body: {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: `spike-${run}`,
        custom_id: `spike-${run}`,
        payee: { merchant_id: PH_MERCHANT_ID },
        items: [
          { name: "Spike 11 test basket", quantity: "1", category: "PHYSICAL_GOODS", unit_amount: { currency_code: "USD", value: "10.00" } },
        ],
        amount: {
          currency_code: "USD",
          value: "10.00",
          breakdown: { item_total: { currency_code: "USD", value: "10.00" } },
        },
        payment_instruction: {
          platform_fees: [{ amount: { currency_code: "USD", value: "0.50" } }],
          disbursement_mode: "DELAYED",
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: `${env.APP_BASE_URL}/checkout/return`,
          cancel_url: `${env.APP_BASE_URL}/checkout/cancel`,
          user_action: "PAY_NOW",
          shipping_preference: "GET_FROM_FILE",
          brand_name: "Counter",
        },
      },
    },
  },
});

const approve = order.links.find((l) => l.rel === "payer-action")?.href;
console.log(`order ${order.id} ${order.status}`);
console.log(`\nAPPROVE AS THE SANDBOX BUYER:\n${approve}\n`);

const deadline = Date.now() + 15 * 60_000;
let status = order.status;
while (status !== "APPROVED") {
  if (Date.now() > deadline) throw new Error("timed out waiting for approval");
  await new Promise((r) => setTimeout(r, 5000));
  status = (await paypalRequest<Order>("orders.get", `/v2/checkout/orders/${order.id}`)).status;
}
console.log("approved");

const captured = await paypalRequest<{ purchase_units: { payments: { captures: Capture[] } }[] }>(
  "orders.capture",
  `/v2/checkout/orders/${order.id}/capture`,
  { method: "POST", headers: { "PayPal-Request-Id": `spike-capture:${run}`, Prefer: "return=representation" } },
);
const capture = captured.purchase_units[0]?.payments.captures[0];
if (!capture) throw new Error("no capture in response");
console.log(`capture ${capture.id} ${capture.status}${capture.status_details ? ` (${capture.status_details.reason})` : ""}`);
console.log(JSON.stringify(capture.seller_receivable_breakdown));

await new Promise((r) => setTimeout(r, 5000));
const refund = await paypalRequest<{ id: string; status: string }>(
  "captures.refund",
  `/v2/payments/captures/${capture.id}/refund`,
  {
    method: "POST",
    headers: { "PayPal-Request-Id": `spike-refund:${run}:1`, "PayPal-Auth-Assertion": assertion(PH_MERCHANT_ID), Prefer: "return=representation" },
    body: { amount: { currency_code: "USD", value: "2.00" }, note_to_payer: "Spike 11 partial refund" },
  },
);
console.log(`partial refund ${refund.id} ${refund.status}`);

await new Promise((r) => setTimeout(r, 5000));
const release = await paypalRequest<{ item_id?: string; processing_state?: { status: string } }>(
  "referenced-payouts.release",
  "/v1/payments/referenced-payouts-items",
  {
    method: "POST",
    headers: { "PayPal-Request-Id": `spike-release:${run}`, Prefer: "return=representation" },
    body: { reference_id: capture.id, reference_type: "TRANSACTION_ID" },
  },
);
console.log(`release ${release.item_id ?? "?"} ${release.processing_state?.status ?? JSON.stringify(release)}`);
console.log(`\nDONE order=${order.id} capture=${capture.id} refund=${refund.id}`);

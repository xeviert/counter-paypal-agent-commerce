// Money-flow check for lib/paypal (BUILDOUT §2 rule 4): create → buyer approves → capture → assert.
// Usage: pnpm e2e:purchase [--merchant-id MPMWEFYQWQYUA] [--buyer-country US]
// Calls lib/paypal directly with script-computed amounts; switch to create_checkout once lib/policy lands.
// Raw responses are saved to test/fixtures/paypal/ for unit tests.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { getEnv } = await import("@/lib/env");
const { PayPalError, paypalRequest } = await import("@/lib/paypal/client");
const { buildCreateOrderBody, captureDetails, captureOrder, createOrder, shipToCountry } = await import(
  "@/lib/paypal/orders"
);
const { order: orderSchema } = await import("@/lib/schemas/paypal");

const { values } = parseArgs({
  options: {
    "merchant-id": { type: "string", default: "MPMWEFYQWQYUA" }, // PH maker until MX is onboarded
    "buyer-country": { type: "string", default: "US" },
  },
});

const env = getEnv();
const orderId = randomUUID();
const unitCents = 1250;
const quantity = 2;
const shippingCents = 1800;
const itemCents = unitCents * quantity;
// Half-up to the cent; lib/policy/fees.ts will own this.
const platformFeeCents = Math.floor((itemCents * env.PLATFORM_FEE_BPS + 5_000) / 10_000);
const totalCents = itemCents + shippingCents;

const fixtures: Record<string, unknown> = {};
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
};

const input = {
  orderId,
  merchantId: values["merchant-id"],
  currency: "USD",
  item: { name: "E2E test basket", sku: `e2e-${orderId.slice(0, 8)}`, unitCents, quantity },
  shippingCents,
  platformFeeCents,
};
const created = await createOrder(input);
console.log(`order ${created.paypalOrderId} ${created.order.status} (ours ${orderId})`);

// Same request id again, without a schema: proves idempotency and gives the raw body for fixtures.
const createReplay = await paypalRequest<{ id: string }>("orders.create.replay", "/v2/checkout/orders", {
  method: "POST",
  requestId: `create:${orderId}`,
  body: buildCreateOrderBody(input, env.APP_BASE_URL),
});
fixtures["orders.create"] = createReplay;
check(createReplay.id === created.paypalOrderId, "repeat create with the same request id returns the same order");

console.log(`\nAPPROVE AS THE SANDBOX BUYER:\n${created.approvalUrl}\n`);

const getRaw = () => paypalRequest<unknown>("orders.get", `/v2/checkout/orders/${created.paypalOrderId}`);
const deadline = Date.now() + 15 * 60_000;
let approvedRaw = await getRaw();
while (orderSchema.parse(approvedRaw).status !== "APPROVED") {
  if (Date.now() > deadline) throw new Error("timed out waiting for approval");
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  approvedRaw = await getRaw();
}
fixtures["orders.get.approved"] = approvedRaw;
const shipTo = shipToCountry(orderSchema.parse(approvedRaw));
console.log(`approved; ship-to ${shipTo ?? "?"}`);
check(shipTo === values["buyer-country"], `ship-to country ${shipTo} matches quoted ${values["buyer-country"]}`);

const result = await captureOrder(orderId, created.paypalOrderId);
if (result.kind !== "captured") throw new Error(`capture needs payer action: ${result.issue}`);

// PayPal either replays the first capture or answers ORDER_ALREADY_CAPTURED; captureOrder handles both.
try {
  fixtures["orders.capture"] = await paypalRequest<unknown>(
    "orders.capture.replay",
    `/v2/checkout/orders/${created.paypalOrderId}/capture`,
    { method: "POST", requestId: `capture:${orderId}`, headers: { Prefer: "return=representation" } },
  );
  console.log("capture replay: PayPal returned the original response");
} catch (err) {
  if (!(err instanceof PayPalError) || err.issue !== "ORDER_ALREADY_CAPTURED") throw err;
  console.log("capture replay: PayPal answered ORDER_ALREADY_CAPTURED");
  fixtures["orders.capture"] = await getRaw();
}
const replay = await captureOrder(orderId, created.paypalOrderId);
check(replay.kind === "captured", "captureOrder is idempotent");

const d = captureDetails(result.order);
const capture = result.order.purchase_units?.[0]?.payments?.captures?.[0];
console.log(`capture ${d.captureId} ${d.status}${d.statusReason ? ` (${d.statusReason})` : ""}`);
check(d.status === "COMPLETED", "capture COMPLETED");
check(capture?.disbursement_mode === "DELAYED", "disbursement_mode DELAYED");
check(d.amount.cents === totalCents, `gross ${d.amount.cents} = item ${itemCents} + shipping ${shippingCents}`);
check(d.platformFeeCents === platformFeeCents, `platform fee ${d.platformFeeCents} = ${env.PLATFORM_FEE_BPS} bps of item`);
check(d.paypalFeeCents !== undefined && d.paypalFeeCents > 0, `PayPal fee ${d.paypalFeeCents}`);
check(
  d.netCents === totalCents - (d.paypalFeeCents ?? 0) - platformFeeCents,
  `net ${d.netCents} = gross - PayPal fee - platform fee`,
);
check(Boolean(d.shipping?.address?.country_code), "buyer shipping address present");
check(Boolean(d.payer.payerId && d.payer.email), "payer id + email present");

mkdirSync("test/fixtures/paypal", { recursive: true });
for (const [name, body] of Object.entries(fixtures)) {
  writeFileSync(`test/fixtures/paypal/${name}.json`, `${JSON.stringify(body, null, 2)}\n`);
}
console.log(`saved ${Object.keys(fixtures).length} raw responses to test/fixtures/paypal/`);

console.log(failures.length ? `\n${failures.length} FAILED` : `\nALL PASSED order=${created.paypalOrderId} capture=${d.captureId}`);
process.exitCode = failures.length ? 1 : 0;

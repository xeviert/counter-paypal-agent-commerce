// Money-flow check (BUILDOUT §6.3): sandbox purchase → tracking as the maker → release → replay.
// Usage: pnpm e2e:release [--merchant-id 2Y6DQGZ4HV2DE]
// Afterwards check the deployed app's events table for PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED with
// the printed capture id: that proves the release event arrives under the explicit subscription.
// The raw release response is saved to test/fixtures/paypal/ for unit tests.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { paypalRequest } = await import("@/lib/paypal/client");
const { addTracker, buildReleaseBody, releaseFunds } = await import("@/lib/paypal/post-sale");
const { referencedPayoutItem } = await import("@/lib/schemas/paypal");
const { checker, DEFAULT_MERCHANT_ID, sandboxPurchase } = await import("./lib/e2e");

const { values } = parseArgs({ options: { "merchant-id": { type: "string", default: DEFAULT_MERCHANT_ID } } });
const merchantId = values["merchant-id"];
const { check, finish } = checker();

const bought = await sandboxPurchase({ merchantId, label: "E2E release test rug" });
check(bought.status === "COMPLETED", "capture COMPLETED");

await addTracker(
  { merchantId },
  {
    orderId: bought.orderId,
    paypalOrderId: bought.paypalOrderId,
    captureId: bought.captureId,
    trackingNumber: `E2E${Date.now()}`,
    carrier: "DHL",
  },
);
check(true, "tracker added with the maker's assertion");

// Same request as releaseFunds but without the schema, so the raw body is saved even if parsing fails.
const raw = await paypalRequest<unknown>("referenced-payouts.release.raw", "/v1/payments/referenced-payouts-items", {
  method: "POST",
  requestId: `release:${bought.orderId}`,
  headers: { Prefer: "return=representation" },
  body: buildReleaseBody(bought.captureId),
});
mkdirSync("test/fixtures/paypal", { recursive: true });
writeFileSync("test/fixtures/paypal/referenced-payouts.release.json", `${JSON.stringify(raw, null, 2)}\n`);
console.log("saved the raw release response to test/fixtures/paypal/");
const parsed = referencedPayoutItem.safeParse(raw);
check(parsed.success, "release response matches referencedPayoutItem");

const first = await releaseFunds({ orderId: bought.orderId, captureId: bought.captureId });
console.log(`release ${first.item_id} ${first.processing_state?.status}`);
check(first.reference_id === bought.captureId, "payout references the capture");
check(first.processing_state?.status === "SUCCESS", `processing_state SUCCESS (got ${first.processing_state?.status})`);
check(parsed.success && parsed.data.item_id === first.item_id, "repeat release with the same request id returns the same payout item");

finish(`capture=${bought.captureId} payout_item=${first.item_id}`);

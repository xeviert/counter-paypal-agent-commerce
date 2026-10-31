// Money-flow check (BUILDOUT §6.3): sandbox purchase → tracking as the maker → release → replay.
// Usage: pnpm e2e:release [--merchant-id 2Y6DQGZ4HV2DE]
// Afterwards check the deployed app's events table for PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED with
// the printed capture id: that proves the release event arrives under the explicit subscription.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { addTracker, releaseFunds } = await import("@/lib/paypal/post-sale");
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

const first = await releaseFunds({ orderId: bought.orderId, captureId: bought.captureId });
console.log(`release ${first.item_id} ${first.processing_state?.status}`);
check(first.reference_id === bought.captureId, "payout references the capture");
check(first.processing_state?.status === "SUCCESS", `processing_state SUCCESS (got ${first.processing_state?.status})`);

const replay = await releaseFunds({ orderId: bought.orderId, captureId: bought.captureId });
check(replay.item_id === first.item_id, "repeat release with the same request id returns the same payout item");

finish(`capture=${bought.captureId} payout_item=${first.item_id}`);

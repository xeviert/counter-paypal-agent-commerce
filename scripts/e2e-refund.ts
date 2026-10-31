// Money-flow check (BUILDOUT §6.3): sandbox purchase → partial refund → replay → refund the rest →
// over-refund refused. Refunds run as the maker (PayPal-Auth-Assertion).
// Usage: pnpm e2e:refund [--merchant-id 2Y6DQGZ4HV2DE]
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { PayPalError } = await import("@/lib/paypal/client");
const { platformFeeReturned, refundCapture } = await import("@/lib/paypal/post-sale");
const { checker, DEFAULT_MERCHANT_ID, sandboxPurchase } = await import("./lib/e2e");

const { values } = parseArgs({ options: { "merchant-id": { type: "string", default: DEFAULT_MERCHANT_ID } } });
const maker = { merchantId: values["merchant-id"] };
const { check, finish } = checker();

const bought = await sandboxPurchase({ merchantId: maker.merchantId, label: "E2E refund test basket" });
check(bought.status === "COMPLETED", "capture COMPLETED");

const base = { orderId: bought.orderId, captureId: bought.captureId, currency: "USD" };
const partial = await refundCapture(maker, { ...base, n: 1, cents: 200, reason: "E2E partial refund" });
const fee1 = platformFeeReturned(partial);
console.log(`partial refund ${partial.id} ${partial.status}, platform fee returned ${fee1}`);
check(partial.status === "COMPLETED", "partial refund COMPLETED");
check(partial.amount?.cents === 200, "partial refund is $2.00");
check(fee1 > 0 && fee1 < bought.platformFeeCents, `platform fee returned proportionally (${fee1} of ${bought.platformFeeCents})`);

const replay = await refundCapture(maker, { ...base, n: 1, cents: 200 });
check(replay.id === partial.id, "repeat refund with the same request id returns the same refund");

const restCents = bought.totalCents - 200;
const rest = await refundCapture(maker, { ...base, n: 2, cents: restCents, reason: "E2E rest" });
const fee2 = platformFeeReturned(rest);
check(rest.status === "COMPLETED", `remaining ${restCents} refunded`);
check(fee1 + fee2 === bought.platformFeeCents, `whole platform fee returned (${fee1} + ${fee2} = ${bought.platformFeeCents})`);

try {
  await refundCapture(maker, { ...base, n: 3, cents: 100 });
  check(false, "refund beyond the capture is refused");
} catch (err) {
  const issue = err instanceof PayPalError ? err.issue : String(err);
  check(err instanceof PayPalError && err.status === 422, `refund beyond the capture is refused (${issue})`);
}

finish(`capture=${bought.captureId}`);

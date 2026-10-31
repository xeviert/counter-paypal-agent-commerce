// Shared sandbox purchase for the money-flow scripts (BUILDOUT §2 rule 4): create a real DELAYED
// order with a platform fee, wait for the human to approve it on PayPal, capture it.
import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { paypalRequest } from "@/lib/paypal/client";
import { captureDetails, captureOrder, createOrder } from "@/lib/paypal/orders";
import { platformFeeCents as feeCents } from "@/lib/policy/fees";
import { order as orderSchema } from "@/lib/schemas/paypal";

/** MX maker (Lucía) in sandbox; PH is MPMWEFYQWQYUA, KE is RWTZ65SJSKYB4. */
export const DEFAULT_MERCHANT_ID = "2Y6DQGZ4HV2DE";

export function checker() {
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };
  const finish = (summary: string) => {
    console.log(failures.length ? `\n${failures.length} FAILED` : `\nALL PASSED ${summary}`);
    process.exitCode = failures.length ? 1 : 0;
  };
  return { check, finish };
}

export async function sandboxPurchase(opts: {
  merchantId: string;
  label: string;
  unitCents?: number;
  shippingCents?: number;
}) {
  const env = getEnv();
  const orderId = randomUUID();
  const unitCents = opts.unitCents ?? 2000;
  const shippingCents = opts.shippingCents ?? 1000;
  const platformFeeCents = feeCents(unitCents, env.PLATFORM_FEE_BPS);
  const created = await createOrder({
    orderId,
    merchantId: opts.merchantId,
    currency: "USD",
    item: { name: opts.label, sku: `e2e-${orderId.slice(0, 8)}`, unitCents, quantity: 1 },
    shippingCents,
    platformFeeCents,
  });
  console.log(`order ${created.paypalOrderId} (ours ${orderId})`);
  console.log(`\nAPPROVE AS THE SANDBOX BUYER:\n${created.approvalUrl}\n`);

  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const raw = await paypalRequest<unknown>("orders.get", `/v2/checkout/orders/${created.paypalOrderId}`);
    if (orderSchema.parse(raw).status === "APPROVED") break;
    if (Date.now() > deadline) throw new Error("timed out waiting for approval");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const result = await captureOrder(orderId, created.paypalOrderId);
  if (result.kind !== "captured") throw new Error(`capture needs payer action: ${result.issue}`);
  const d = captureDetails(result.order);
  if (!d.captureId) throw new Error("no capture id");
  console.log(`capture ${d.captureId} ${d.status}`);
  return {
    orderId,
    paypalOrderId: created.paypalOrderId,
    captureId: d.captureId,
    status: d.status,
    totalCents: unitCents + shippingCents,
    platformFeeCents,
  };
}

// Replay check (BUILDOUT §8.2): one real sandbox order through Counter's own code, with the steps
// that can repeat in production run twice at once. Return URL hit twice → one capture; release run
// twice → one release request, one Released transition, one notification.
// Usage: pnpm e2e:replay [--merchant-id 2Y6DQGZ4HV2DE] [--buyer-country US]
// Runs against DATABASE_URL (a live product of that maker must exist: pnpm seed). The human approves
// on PayPal as the sandbox buyer. PayPal webhooks go to the deployed app, not this database; their
// replay safety (unique paypal_event_id) is covered by lib/shop/webhook-handlers tests.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { and, eq, inArray } = await import("drizzle-orm");
const { getDb } = await import("@/lib/db");
const { events, notifications, orders, products, sellers } = await import("@/lib/db/schema");
const { paypalRequest } = await import("@/lib/paypal/client");
const { order: orderSchema } = await import("@/lib/schemas/paypal");
const { sellableConditions } = await import("@/lib/shop/catalog");
const { createCheckout } = await import("@/lib/shop/checkout");
const { returnRedirect } = await import("@/lib/shop/checkout-return");
const { addTracking } = await import("@/lib/shop/fulfillment");
const { releaseOrder } = await import("@/lib/shop/release");
const { checker, DEFAULT_MERCHANT_ID } = await import("./lib/e2e");

const { values } = parseArgs({
  options: {
    "merchant-id": { type: "string", default: DEFAULT_MERCHANT_ID },
    "buyer-country": { type: "string", default: "US" },
  },
});
const db = getDb();
const { check, finish } = checker();

const [found] = await db
  .select({ product: products, seller: sellers })
  .from(products)
  .innerJoin(sellers, eq(products.sellerId, sellers.id))
  .where(and(eq(sellers.merchantId, values["merchant-id"]), ...sellableConditions()))
  .limit(1);
if (!found) throw new Error(`no live product for merchant ${values["merchant-id"]}; run pnpm seed`);
const { product, seller } = found;

const { order: created, output } = await createCheckout(
  db,
  { productId: product.id, quantity: 1, buyerCountry: values["buyer-country"] },
  { agentId: "e2e-replay", source: "script" },
);
console.log(`order ${created.id} (PayPal ${created.paypalOrderId}) for ${product.slug}, total ${output.totals.total.value}`);
console.log(`\nAPPROVE AS THE SANDBOX BUYER:\n${output.approvalUrl}\n`);

const deadline = Date.now() + 15 * 60_000;
for (;;) {
  const raw = await paypalRequest<unknown>("orders.get", `/v2/checkout/orders/${created.paypalOrderId}`);
  if (orderSchema.parse(raw).status === "APPROVED") break;
  if (Date.now() > deadline) throw new Error("timed out waiting for approval");
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

// The buyer's browser can land on the return URL twice (refresh, back button, double redirect).
await Promise.all([returnRedirect(db, created.paypalOrderId!), returnRedirect(db, created.paypalOrderId!)]);
const [paid] = await db.select().from(orders).where(eq(orders.id, created.id));
check(paid?.status === "PaidHeld", `order PaidHeld after two returns (got ${paid?.status})`);
check(Boolean(paid?.captureId), `one capture id ${paid?.captureId}`);
const transitions = await db.select().from(events).where(and(eq(events.orderId, created.id), eq(events.type, "order.transition")));
const toPaid = transitions.filter((e) => (e.payload as { to?: string }).to === "PaidHeld");
check(toPaid.length === 1, `one PaidHeld transition (got ${toPaid.length})`);
const paidNotes = await db
  .select()
  .from(notifications)
  .where(and(eq(notifications.orderId, created.id), eq(notifications.kind, "paid")));
check(paidNotes.length === 1, `one "paid" notification (got ${paidNotes.length})`);

await addTracking(db, seller, created.id, { carrier: "DHL", trackingNumber: `E2E${Date.now()}` }, "script");
check(true, "tracking added");

const trigger = { source: "script" as const, actor: "e2e-replay" };
const results = await Promise.all([releaseOrder(db, created.id, trigger), releaseOrder(db, created.id, trigger)]);
console.log(`release results: ${results.map((r) => r.kind).join(", ")}`);
check(results.filter((r) => r.kind === "skipped").length === 1, "the second concurrent release was skipped");
const after = await db.select().from(events).where(eq(events.orderId, created.id));
const requested = after.filter((e) => e.type === "order.release_requested");
check(requested.length === 1, `one release request (got ${requested.length})`);
const released = after.filter((e) => e.type === "order.transition" && (e.payload as { to?: string }).to === "Released");
check(released.length <= 1, `at most one Released transition (got ${released.length})`);
const releaseNotes = await db
  .select()
  .from(notifications)
  .where(and(eq(notifications.orderId, created.id), inArray(notifications.kind, ["funds_released"])));
check(releaseNotes.length === released.length, `one "funds_released" notification per Released (got ${releaseNotes.length})`);

await db.$client.end();
finish(`order=${created.id} capture=${paid?.captureId} release=${results.map((r) => r.kind).join("/")}`);

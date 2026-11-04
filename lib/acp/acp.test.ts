import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { expireStaleCheckouts } from "@/lib/db/orders";
import { acpSessions, events, idempotencyKeys, orders, products } from "@/lib/db/schema";
import { RateLimiter } from "@/lib/mcp/rate-limit";
import type { AcpCheckoutSession, AcpError } from "@/lib/schemas/acp";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { json, mockPayPal, stubPayPalEnv } from "@/test/paypal";
import { handleAcp, type AcpOp } from "./handler";
import { purgeIdempotencyKeys } from "./idempotency";

const PAYPAL_ID = "7FP370406R848663Y";
const APPROVAL = `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ID}`;
const created = () => json(200, { id: PAYPAL_ID, status: "PAYER_ACTION_REQUIRED", links: [{ href: APPROVAL, rel: "payer-action" }] });

const address = (country: string) => ({
  name: "Sam Buyer",
  line_one: "1 Main St",
  city: "Austin",
  state: "TX",
  country,
  postal_code: "78701",
});

describe.skipIf(!testDatabaseUrl)("ACP checkout sessions", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(async () => {
    stubPayPalEnv();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await truncateAll(db);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function call(op: AcpOp, opts: { id?: string; body?: unknown; key?: string; raw?: string } = {}) {
    const method = op === "get" ? "GET" : "POST";
    const path = `/api/acp/checkout_sessions${opts.id ? `/${opts.id}` : ""}${op === "complete" || op === "cancel" ? `/${op}` : ""}`;
    const headers: Record<string, string> = { "user-agent": "acp-test/1", "x-forwarded-for": "203.0.113.7", "request-id": "req_1" };
    if (opts.key) headers["idempotency-key"] = opts.key;
    const request = new Request(`https://counter.test${path}`, {
      method,
      headers,
      ...(method === "POST" && { body: opts.raw ?? JSON.stringify(opts.body ?? {}) }),
    });
    const response = await handleAcp(request, op, opts.id, { db: () => db, limiter: new RateLimiter() });
    return { response, body: (await response.json()) as AcpCheckoutSession & AcpError };
  }

  const create = (productId: string, extra: Record<string, unknown> = {}, key?: string) =>
    call("create", { body: { items: [{ id: productId, quantity: 1 }], ...extra }, key });

  it("creates a session that needs an address, then quotes it once the address is in", async () => {
    const { product } = await seedProduct(db);
    const first = await create(product.id);
    expect(first.response.status).toBe(201);
    expect(first.response.headers.get("API-Version")).toBe("2025-09-29");
    expect(first.response.headers.get("Request-Id")).toBe("req_1");
    expect(first.body).toMatchObject({
      status: "not_ready_for_payment",
      currency: "usd",
      line_items: [{ item: { id: product.id, quantity: 1 }, base_amount: 15000, total: 15000 }],
      fulfillment_options: [],
      links: [],
      messages: [{ type: "error", code: "missing", param: "$.fulfillment_address" }],
    });

    const updated = await call("update", { id: first.body.id, body: { fulfillment_address: address("US") } });
    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({
      status: "ready_for_payment",
      fulfillment_option_id: "standard",
      fulfillment_options: [{ type: "shipping", id: "standard", subtotal: 2200, total: 2200 }],
      messages: [],
    });
    expect(updated.body.totals.find((t) => t.type === "total")!.amount).toBe(17200);
    const got = await call("get", { id: first.body.id });
    expect(got.body).toEqual(updated.body);
  });

  it("completes into a PayPal order the human approves, once", async () => {
    const { product } = await seedProduct(db);
    const { calls } = mockPayPal(created);
    const { body: session } = await create(product.id, { fulfillment_address: address("US") });
    const done = await call("complete", { id: session.id, body: { payment_data: { token: "tok", provider: "stripe" } } });
    expect(done.response.status).toBe(200);
    const [order] = await db.select().from(orders);
    expect(order).toMatchObject({ status: "CheckoutCreated", itemAmount: 15000, shippingAmount: 2200 });
    expect(done.body).toMatchObject({
      status: "completed",
      order: { id: order!.id, checkout_session_id: session.id, permalink_url: `https://counter.test/o/${order!.statusToken}` },
    });
    expect(done.body.messages.map((m) => m.content).join(" ")).toContain(APPROVAL);
    const [opened] = await db.select().from(events).where(eq(events.type, "order.created"));
    expect(opened).toMatchObject({ source: "acp", orderId: order!.id });

    const again = await call("complete", { id: session.id });
    expect(again.body.order!.id).toBe(order!.id);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/v2/checkout/orders")).toHaveLength(1);
    expect(await db.select().from(orders)).toHaveLength(1);

    const late = await call("update", { id: session.id, body: { fulfillment_address: address("DE") } });
    expect(late.response.status).toBe(405);
  });

  it("refuses to complete a session that isn't ready", async () => {
    const { product } = await seedProduct(db);
    const { body: session } = await create(product.id);
    const res = await call("complete", { id: session.id });
    expect(res.response.status).toBe(422);
    expect(res.body).toMatchObject({ type: "invalid_request", code: "not_ready_for_payment" });
  });

  it("replays a repeated Idempotency-Key and rejects a reused one", async () => {
    const { product } = await seedProduct(db);
    const first = await create(product.id, {}, "key-1");
    const replay = await create(product.id, {}, "key-1");
    expect(replay.response.status).toBe(201);
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.response.headers.get("Idempotency-Key")).toBe("key-1");
    expect(replay.body.id).toBe(first.body.id);
    expect(await db.select().from(acpSessions)).toHaveLength(1);

    const reused = await create(product.id, { fulfillment_address: address("US") }, "key-1");
    expect(reused.response.status).toBe(422);
    expect(reused.body).toMatchObject({ type: "request_not_idempotent", code: "idempotency_conflict" });

    await db.update(idempotencyKeys).set({ responseStatus: null, responseBody: null });
    const inFlight = await create(product.id, {}, "key-1");
    expect(inFlight.response.status).toBe(409);
    expect(inFlight.response.headers.get("Retry-After")).toBe("1");
    expect(inFlight.body.code).toBe("idempotency_in_flight");
  });

  it("purges keys after a day", async () => {
    const { product } = await seedProduct(db);
    await create(product.id, {}, "old");
    await db.update(idempotencyKeys).set({ createdAt: new Date(Date.now() - 25 * 3600_000) });
    expect(await purgeIdempotencyKeys(db)).toBe(1);
  });

  it("cancels before and after complete while the order is unpaid, then refuses", async () => {
    const { product } = await seedProduct(db, { stock: 2 });
    mockPayPal(created);
    const { body: open } = await create(product.id, { fulfillment_address: address("US") });
    expect((await call("cancel", { id: open.id })).body.status).toBe("canceled");
    expect((await call("cancel", { id: open.id })).response.status).toBe(405);

    const { body: session } = await create(product.id, { fulfillment_address: address("US") });
    await call("complete", { id: session.id });
    const canceled = await call("cancel", { id: session.id });
    expect(canceled.body.status).toBe("canceled");
    const [order] = await db.select().from(orders);
    expect(order!.status).toBe("Canceled");
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row!.reserved).toBe(0);
  });

  it("shows an order the sweep expired on GET", async () => {
    const { product } = await seedProduct(db);
    mockPayPal(created);
    const { body: session } = await create(product.id, { fulfillment_address: address("US") });
    await call("complete", { id: session.id });
    await expireStaleCheckouts(db, new Date(Date.now() + 4 * 3600_000));
    const got = await call("get", { id: session.id });
    expect(got.body.status).toBe("completed");
    expect(got.body.messages.map((m) => m.content).join(" ")).toMatch(/Order Expired\. This checkout expired/);
    expect(got.body.messages.map((m) => m.content).join(" ")).not.toContain(APPROVAL);
  });

  it("explains what blocks payment", async () => {
    const { product } = await seedProduct(db, { stock: 1 });
    const blocked = await create(product.id, { fulfillment_address: address("IR") });
    expect(blocked.body.messages).toMatchObject([{ code: "invalid", param: "$.fulfillment_address.country" }]);

    const many = await call("create", { body: { items: [{ id: product.id, quantity: 2 }], fulfillment_address: address("US") } });
    expect(many.body).toMatchObject({ status: "not_ready_for_payment", messages: [{ code: "out_of_stock" }] });

    await db.update(products).set({ status: "paused" }).where(eq(products.id, product.id));
    const paused = await call("get", { id: many.body.id });
    expect(paused.body.messages).toMatchObject([{ code: "invalid", param: "$.line_items[0]" }]);
  });

  it("answers bad requests with the spec's error shape", async () => {
    const { product } = await seedProduct(db);
    const unknown = await create("2f1c6a1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f");
    expect(unknown.response.status).toBe(400);
    expect(unknown.body).toMatchObject({ type: "invalid_request", code: "product_not_found", param: "$.items[0].id" });
    const tooMany = await call("create", { body: { items: [{ id: product.id, quantity: 11 }] } });
    expect(tooMany.body).toMatchObject({ code: "invalid", param: "$.items[0].quantity" });
    const twoItems = await call("create", { body: { items: [{ id: product.id, quantity: 1 }, { id: product.id, quantity: 1 }] } });
    expect(twoItems.body).toMatchObject({ code: "multiple_items_unsupported", param: "$.items[1]" });
    const extra = await call("create", { body: { items: [{ id: product.id, quantity: 1 }], coupon: "FREE" } });
    expect(extra.response.status).toBe(400);
    const notJson = await call("create", { raw: "{" });
    expect(notJson.body.code).toBe("invalid_json");
    expect((await call("get", { id: "nope" })).response.status).toBe(404);
  });

  it("logs one acp event per request without buyer details", async () => {
    const { product } = await seedProduct(db);
    const { body } = await create(product.id, {
      fulfillment_address: address("US"),
      buyer: { first_name: "Sam", last_name: "Buyer", email: "sam@example.com" },
    });
    await call("get", { id: body.id });
    const logged = await db.select().from(events).where(like(events.type, "acp.%"));
    expect(logged.map((e) => e.type)).toEqual(["acp.create", "acp.get"]);
    expect(logged[0]).toMatchObject({ source: "acp", productId: product.id, payload: { sessionId: body.id, httpStatus: 201 } });
    expect(JSON.stringify(logged)).not.toMatch(/sam@example|Main St/);
  });
});

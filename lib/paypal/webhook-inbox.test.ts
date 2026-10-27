import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { receivePayPalWebhook, type InboxDeps } from "./webhook-inbox";
import { buildVerifyBody } from "./webhooks";

const rawEvent = (id = "WH-TEST-1") =>
  // Odd spacing and key order on purpose: the raw text must survive untouched.
  `{"id":"${id}",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"status":"COMPLETED","id":"CAP-1"},"create_time":"2026-10-27T00:00:00Z"}`;

const transmission = new Headers({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-10-27T00:00:01Z",
});

describe("buildVerifyBody", () => {
  it("splices the raw event in byte-for-byte", () => {
    const raw = rawEvent();
    const body = buildVerifyBody(raw, Object.fromEntries(transmission), "WH-ID");
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
      auth_algo: "SHA256withRSA",
      transmission_id: "tx-1",
      webhook_id: "WH-ID",
      webhook_event: { id: "WH-TEST-1", resource: { id: "CAP-1" } },
    });
  });
});

describe.skipIf(!testDatabaseUrl)("receivePayPalWebhook", () => {
  let db: Db;
  let deps: InboxDeps;

  beforeAll(() => {
    db = testDb();
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(async () => {
    await truncateAll(db);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    deps = { db, verify: vi.fn(async () => true), handle: vi.fn(async () => {}) };
  });

  const row = async (id = "WH-TEST-1") =>
    (await db.select().from(events).where(eq(events.paypalEventId, id)))[0];

  it("stores, verifies and processes a new event, keeping the raw body", async () => {
    const result = await receivePayPalWebhook(rawEvent(), transmission, deps);
    expect(result).toEqual({ status: 200, outcome: "processed" });
    const stored = await row();
    expect(stored).toMatchObject({ type: "PAYMENT.CAPTURE.COMPLETED", source: "webhook", verified: true, rawBody: rawEvent() });
    expect(stored?.processedAt).toBeInstanceOf(Date);
    expect(stored?.headers).toMatchObject({ "paypal-transmission-id": "tx-1" });
    expect(deps.handle).toHaveBeenCalledOnce();
  });

  it("acknowledges a redelivery without verifying or handling again", async () => {
    await receivePayPalWebhook(rawEvent(), transmission, deps);
    const again = await receivePayPalWebhook(rawEvent(), transmission, deps);
    expect(again).toEqual({ status: 200, outcome: "duplicate" });
    expect(deps.verify).toHaveBeenCalledOnce();
    expect(deps.handle).toHaveBeenCalledOnce();
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("rejects a bad signature and never handles the event", async () => {
    deps.verify = vi.fn(async () => false);
    expect(await receivePayPalWebhook(rawEvent(), transmission, deps)).toEqual({ status: 400, outcome: "bad-signature" });
    expect(deps.handle).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({ verified: false, processedAt: null });
  });

  it("asks PayPal to retry when verification is unavailable, then recovers", async () => {
    deps.verify = vi.fn().mockRejectedValueOnce(new Error("PAYPAL_WEBHOOK_ID is not set")).mockResolvedValue(true);
    expect((await receivePayPalWebhook(rawEvent(), transmission, deps)).status).toBe(503);
    expect(await receivePayPalWebhook(rawEvent(), transmission, deps)).toEqual({ status: 200, outcome: "processed" });
    expect(await row()).toMatchObject({ verified: true, error: null });
  });

  it("returns 500 when the handler fails so PayPal retries, without re-verifying", async () => {
    deps.handle = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    expect((await receivePayPalWebhook(rawEvent(), transmission, deps)).status).toBe(500);
    expect(await receivePayPalWebhook(rawEvent(), transmission, deps)).toEqual({ status: 200, outcome: "processed" });
    expect(deps.verify).toHaveBeenCalledOnce();
  });

  it("rejects malformed bodies without storing them", async () => {
    expect((await receivePayPalWebhook("not json", transmission, deps)).status).toBe(400);
    expect((await receivePayPalWebhook(`{"id":"x"}`, transmission, deps)).status).toBe(400);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});

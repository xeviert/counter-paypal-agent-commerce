import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { webhookEnvelope, type WebhookEnvelope } from "@/lib/schemas/paypal";
import { pickTransmissionHeaders, type TransmissionHeaders } from "./webhooks";

export type InboxDeps = {
  db: Db;
  verify: (rawBody: string, headers: TransmissionHeaders) => Promise<boolean>;
  /** Returns our order id, if any, to link the stored event to it. */
  handle: (event: WebhookEnvelope) => Promise<{ orderId?: string } | void>;
};

export type InboxResult = { status: number; outcome: string };

/**
 * Store → verify → process. PayPal retries non-2xx responses, so transient
 * failures return 5xx and a retry of the same event id picks up where it left off.
 */
export async function receivePayPalWebhook(
  rawBody: string,
  requestHeaders: Headers,
  deps: InboxDeps,
): Promise<InboxResult> {
  let event: WebhookEnvelope;
  try {
    event = webhookEnvelope.parse(JSON.parse(rawBody));
  } catch {
    log.warn("webhook rejected: malformed body", { bytes: rawBody.length });
    return { status: 400, outcome: "malformed" };
  }

  const { db } = deps;
  const headers = pickTransmissionHeaders(requestHeaders);
  const payload: unknown = JSON.parse(rawBody);
  const [inserted] = await db
    .insert(events)
    .values({
      type: event.event_type,
      source: "webhook",
      actor: "paypal",
      paypalEventId: event.id,
      rawBody,
      headers,
      payload,
    })
    .onConflictDoNothing({ target: events.paypalEventId })
    .returning();
  const row = inserted ?? (await db.select().from(events).where(eq(events.paypalEventId, event.id)))[0];
  if (!row) throw new Error(`webhook ${event.id} vanished after insert`);
  if (row.processedAt) return { status: 200, outcome: "duplicate" };

  if (row.verified !== true) {
    let verified: boolean;
    try {
      verified = await deps.verify(rawBody, headers);
    } catch (err) {
      log.error("webhook verification unavailable", { event_id: event.id, err });
      await db.update(events).set({ error: "verification unavailable" }).where(eq(events.id, row.id));
      return { status: 503, outcome: "verify-unavailable" };
    }
    if (!verified) {
      log.warn("webhook rejected: bad signature", { event_id: event.id, event_type: event.event_type });
      await db.update(events).set({ verified: false, error: "bad signature" }).where(eq(events.id, row.id));
      return { status: 400, outcome: "bad-signature" };
    }
    // This delivery is authentic; if an earlier unverified copy was stored, replace it.
    await db
      .update(events)
      .set({ verified: true, error: null, rawBody, headers, payload })
      .where(eq(events.id, row.id));
  }

  let orderId: string | undefined;
  try {
    orderId = (await deps.handle(event))?.orderId;
  } catch (err) {
    log.error("webhook handler failed", { event_id: event.id, event_type: event.event_type, err });
    await db.update(events).set({ error: String(err) }).where(eq(events.id, row.id));
    return { status: 500, outcome: "handler-failed" };
  }
  await db
    .update(events)
    .set({ processedAt: new Date(), error: null, ...(orderId && { orderId }) })
    .where(eq(events.id, row.id));
  return { status: 200, outcome: "processed" };
}

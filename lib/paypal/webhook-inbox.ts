import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { log } from "@/lib/log";
import {
  pickTransmissionHeaders,
  verifyWebhookSignature,
  webhookEnvelope,
  type TransmissionHeaders,
  type WebhookEnvelope,
} from "./webhooks";

export type InboxDeps = {
  db: Db;
  verify: (rawBody: string, headers: TransmissionHeaders) => Promise<boolean>;
  handle: (event: WebhookEnvelope) => Promise<void>;
};

export type InboxResult = { status: number; outcome: string };

// P1 replaces this with real handlers (ARCHITECTURE §4.6).
async function logOnly(event: WebhookEnvelope) {
  log.info("webhook event", { event_type: event.event_type, event_id: event.id, resource_id: event.resource.id });
}

/**
 * Store → verify → process. PayPal retries non-2xx responses, so transient
 * failures return 5xx and a retry of the same event id picks up where it left off.
 */
export async function receivePayPalWebhook(
  rawBody: string,
  requestHeaders: Headers,
  deps: InboxDeps = { db: getDb(), verify: verifyWebhookSignature, handle: logOnly },
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

  try {
    await deps.handle(event);
  } catch (err) {
    log.error("webhook handler failed", { event_id: event.id, event_type: event.event_type, err });
    await db.update(events).set({ error: String(err) }).where(eq(events.id, row.id));
    return { status: 500, outcome: "handler-failed" };
  }
  await db.update(events).set({ processedAt: new Date(), error: null }).where(eq(events.id, row.id));
  return { status: 200, outcome: "processed" };
}

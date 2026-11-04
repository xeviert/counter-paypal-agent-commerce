import { and, eq, inArray, isNotNull, lte, notExists, or, sql } from "drizzle-orm";
import { purgeIdempotencyKeys } from "@/lib/acp/idempotency";
import type { Tx } from "@/lib/db";
import { expireStaleCheckouts } from "@/lib/db/orders";
import { notifications, orders, products } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { MAX_HOLD_DAYS, SHIP_REMINDER_DAYS } from "@/lib/policy/release";
import { failStalePipelines } from "./listing-pipeline";
import { notify } from "./notifications";
import { releaseOrder, staleRequestedReleases } from "./release";
import { makerTitle } from "./seller-orders";

// The every-minute cron job (scripts/cron-sweep.ts, BUILDOUT §6.3). Each step is independent and
// idempotent; a failing order is logged and left for the next run.

const DAY_MS = 24 * 3600_000;
const trigger = { source: "cron" as const, actor: "system" };

/** Shipped past the due date, or held as long as PayPal allows (MAX_HOLD_DAYS) whether shipped or not. */
export async function dueReleases(db: Tx, now = new Date(), limit = 20): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["PaidHeld", "Shipped"]),
        eq(orders.releaseStatus, "held"),
        isNotNull(orders.captureId),
        sql`${orders.refundedAmount} < ${orders.itemAmount} + ${orders.shippingAmount}`,
        or(
          and(eq(orders.status, "Shipped"), lte(orders.releaseDueAt, now)),
          lte(orders.capturedAt, new Date(now.getTime() - MAX_HOLD_DAYS * DAY_MS)),
        ),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Paid orders with no tracking after SHIP_REMINDER_DAYS, reminded once each. */
export async function sendShipReminders(db: Tx, now = new Date()): Promise<number> {
  const rows = await db
    .select({ id: orders.id, sellerId: orders.sellerId, listing: products.listing })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(
      and(
        eq(orders.status, "PaidHeld"),
        lte(orders.capturedAt, new Date(now.getTime() - SHIP_REMINDER_DAYS * DAY_MS)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(notifications)
            .where(and(eq(notifications.orderId, orders.id), eq(notifications.kind, "ship_reminder"))),
        ),
      ),
    )
    .limit(50);
  for (const row of rows) {
    await notify(db, row.sellerId, "ship_reminder", { product: makerTitle(row.listing), days: SHIP_REMINDER_DAYS }, row.id);
  }
  return rows.length;
}

async function each(ids: string[], fn: (id: string) => Promise<unknown>, label: string): Promise<number> {
  let done = 0;
  for (const id of ids) {
    try {
      await fn(id);
      done++;
    } catch (err) {
      log.error(`sweep: ${label} failed`, { order_id: id, error: err });
    }
  }
  return done;
}

export async function runSweep(db: Tx, now = new Date()) {
  const expired = await expireStaleCheckouts(db, now);
  const staleDrafts = await failStalePipelines(db, now);
  const released = await each(await dueReleases(db, now), (id) => releaseOrder(db, id, trigger), "release");
  const retried = await each(
    await staleRequestedReleases(db, now),
    (id) => releaseOrder(db, id, trigger, { retry: true }),
    "release retry",
  );
  const reminders = await sendShipReminders(db, now);
  const idempotencyKeys = await purgeIdempotencyKeys(db, now);
  return { expired, staleDrafts, released, retried, reminders, idempotencyKeys };
}

import { and, eq, inArray, isNull, like, not, notInArray, or } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  acpSessions,
  copilotActions,
  copilotMessages,
  drafts,
  events,
  notifications,
  offers,
  orders,
  photos,
  products,
  refunds,
  sellers,
  voiceNotes,
} from "@/lib/db/schema";
import { canPublish } from "@/lib/policy/seller";

/**
 * Puts the demo makers back between filming takes (BUILDOUT §8.3): removes every order that isn't
 * `pnpm seed:activity` history (`SEED-` PayPal ids), products that aren't in the seed catalog, offers,
 * drafts, copilot chats and the inbox, then restores catalog stock. Real makers are never touched.
 */
export async function resetDemo(db: Tx, catalog: { slug: string; stock: number }[]) {
  const demo = await db.select().from(sellers).where(isNull(sellers.email));
  const sellerIds = demo.map((s) => s.id);
  const counts = { orders: 0, products: 0, offers: 0, drafts: 0, notifications: 0, copilotMessages: 0, restocked: 0 };
  if (sellerIds.length === 0) return counts;
  const slugs = catalog.map((p) => p.slug);

  const filmed = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.sellerId, sellerIds), or(isNull(orders.paypalOrderId), not(like(orders.paypalOrderId, "SEED-%")))));
  const orderIds = filmed.map((o) => o.id);
  const extra = await db
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.sellerId, sellerIds), slugs.length ? notInArray(products.slug, slugs) : undefined));
  const extraIds = extra.map((p) => p.id);
  const productIds = db.select({ id: products.id }).from(products).where(inArray(products.sellerId, sellerIds));

  await db.delete(copilotActions).where(inArray(copilotActions.sellerId, sellerIds));
  counts.copilotMessages = (
    await db.delete(copilotMessages).where(inArray(copilotMessages.sellerId, sellerIds)).returning({ id: copilotMessages.id })
  ).length;
  counts.notifications = (
    await db.delete(notifications).where(inArray(notifications.sellerId, sellerIds)).returning({ id: notifications.id })
  ).length;
  await db.delete(acpSessions).where(inArray(acpSessions.productId, productIds));
  if (orderIds.length) {
    await db.delete(refunds).where(inArray(refunds.orderId, orderIds));
    await db.delete(events).where(inArray(events.orderId, orderIds));
    counts.orders = (await db.delete(orders).where(inArray(orders.id, orderIds)).returning({ id: orders.id })).length;
  }
  counts.offers = (await db.delete(offers).where(inArray(offers.productId, productIds)).returning({ id: offers.id })).length;

  counts.drafts = (await db.delete(drafts).where(inArray(drafts.sellerId, sellerIds)).returning({ id: drafts.id })).length;
  await db.delete(voiceNotes).where(inArray(voiceNotes.sellerId, sellerIds));
  await db.delete(photos).where(and(inArray(photos.sellerId, sellerIds), isNull(photos.productId)));

  if (extraIds.length) {
    await db.delete(events).where(inArray(events.productId, extraIds));
    counts.products = (await db.delete(products).where(inArray(products.id, extraIds)).returning({ id: products.id })).length;
  }

  for (const p of catalog) {
    const updated = await db
      .update(products)
      .set({ stock: p.stock, reserved: 0 })
      .where(and(inArray(products.sellerId, sellerIds), eq(products.slug, p.slug)))
      .returning({ id: products.id });
    counts.restocked += updated.length;
  }
  const publishable = demo.filter(canPublish).map((s) => s.id);
  if (publishable.length && slugs.length) {
    await db
      .update(products)
      .set({ status: "live" })
      .where(and(inArray(products.sellerId, publishable), inArray(products.slug, slugs)));
  }

  await db.insert(events).values({ type: "demo.reset", source: "script", actor: "system", payload: counts });
  return counts;
}

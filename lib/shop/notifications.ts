import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import type { NotificationKind } from "@/lib/schemas/common";

// Maker inbox (BUILDOUT §10 #4: in-app first). Rows hold a kind + params; the text is rendered from
// the maker's catalog when shown, so a language change applies to old entries too.

export type Notification = typeof notifications.$inferSelect;

export async function notify(
  db: Tx,
  sellerId: string,
  kind: NotificationKind,
  params: Record<string, string | number> = {},
  orderId?: string,
): Promise<void> {
  await db.insert(notifications).values({ sellerId, kind, params, orderId });
}

export async function listNotifications(db: Tx, sellerId: string, limit = 50): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.sellerId, sellerId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(db: Tx, sellerId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.sellerId, sellerId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markAllRead(db: Tx, sellerId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.sellerId, sellerId), isNull(notifications.readAt)));
}

"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { statusToken } from "@/lib/schemas/common";
import { releaseOrder } from "@/lib/shop/release";

/** The buyer's "I received it": releases the held money to the maker now (BUILDOUT §6.3). */
export async function confirmReceived(token: string): Promise<void> {
  if (!statusToken.safeParse(token).success) redirect("/");
  const db = getDb();
  const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.statusToken, token));
  if (order) {
    const result = await releaseOrder(db, order.id, { source: "web", actor: "buyer" }, { buyerConfirmed: true });
    log.info("buyer confirmed receipt", { order_id: order.id, release: result.kind });
  }
  redirect(`/o/${token}`);
}

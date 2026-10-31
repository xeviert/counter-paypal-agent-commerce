"use server";

import { revalidatePath } from "next/cache";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { markAllRead } from "@/lib/shop/notifications";

export async function markInboxRead(): Promise<void> {
  const seller = await requireSeller();
  await markAllRead(getDb(), seller.id);
  revalidatePath("/s", "layout");
}

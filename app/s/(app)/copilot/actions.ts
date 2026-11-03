"use server";

import { revalidatePath } from "next/cache";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { uuid } from "@/lib/schemas/common";
import { cancelCopilotAction, confirmCopilotAction, type ActionDecision } from "@/lib/shop/copilot";

/** The maker's tap on a copilot refund card: the only way a copilot refund moves money (BUILDOUT §7.1). */
export async function confirmCard(actionId: string): Promise<ActionDecision> {
  const seller = await requireSeller();
  if (!uuid.safeParse(actionId).success) return { ok: false, error: "errors.notFound" };
  const result = await confirmCopilotAction(getDb(), seller, actionId);
  revalidatePath("/s/orders", "layout");
  return result;
}

export async function cancelCard(actionId: string): Promise<ActionDecision> {
  const seller = await requireSeller();
  if (!uuid.safeParse(actionId).success) return { ok: false, error: "errors.notFound" };
  return cancelCopilotAction(getDb(), seller, actionId);
}

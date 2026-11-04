"use server";

import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { resetDashboard, saveDashboard } from "@/lib/shop/dashboards";

/** Studio's report state after an edit (by hand or by the AI). Always the session's maker. */
export async function saveReport(state: unknown): Promise<boolean> {
  const seller = await requireSeller();
  return saveDashboard(getDb(), seller.id, state);
}

export async function resetReport(): Promise<void> {
  const seller = await requireSeller();
  await resetDashboard(getDb(), seller.id);
}

"use server";

import { revalidatePath } from "next/cache";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import type { MessageKey } from "@/lib/i18n/core";
import { log } from "@/lib/log";
import { parseMoney } from "@/lib/schemas/common";
import { addTracking, FulfillmentError, refundOrder } from "@/lib/shop/fulfillment";

export type ActionState = { ok?: boolean; error?: MessageKey; refundedCents?: number };

function failed(err: unknown): ActionState {
  if (err instanceof FulfillmentError) return { error: err.code };
  log.error("order action failed", { error: err });
  return { error: "errors.generic" };
}

const str = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export async function submitTracking(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const seller = await requireSeller();
  try {
    await addTracking(getDb(), seller, orderId, {
      carrier: str(form, "carrier"),
      carrierNameOther: str(form, "carrierNameOther") || undefined,
      trackingNumber: str(form, "trackingNumber"),
    });
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/s/orders/${orderId}`);
  return { ok: true };
}

/** `amount` blank → full refund of what's left. Also the action the P3 copilot's confirm card calls. */
export async function submitRefund(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const seller = await requireSeller();
  const amount = str(form, "amount");
  let cents: number | undefined;
  if (amount) {
    try {
      cents = parseMoney(amount);
    } catch {
      return { error: "orders.refund.tooMuch" };
    }
  }
  try {
    const result = await refundOrder(getDb(), seller, orderId, { cents, reason: str(form, "reason") || undefined });
    revalidatePath(`/s/orders/${orderId}`);
    return { ok: true, refundedCents: result.refundedCents };
  } catch (err) {
    return failed(err);
  }
}

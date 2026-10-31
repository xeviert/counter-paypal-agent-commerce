"use server";

import { redirect } from "next/navigation";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { createReferral } from "@/lib/paypal/referrals";
import { syncOnboarding } from "@/lib/shop/onboarding";

export async function connectPayPal(): Promise<void> {
  const seller = await requireSeller();
  let actionUrl: string;
  try {
    actionUrl = await createReferral(seller.id, `${getEnv().APP_BASE_URL}/s/onboarding/return`, seller.email ?? undefined);
  } catch (err) {
    log.error("partner referral failed", { seller_id: seller.id, error: err });
    redirect("/s/onboarding?error=paypal");
  }
  redirect(actionUrl);
}

export async function checkOnboarding(): Promise<void> {
  const seller = await requireSeller();
  let linked: boolean;
  try {
    linked = (await syncOnboarding(getDb(), seller, { source: "web", actor: seller.id })) !== undefined;
  } catch (err) {
    log.error("onboarding check failed", { seller_id: seller.id, error: err });
    redirect("/s/onboarding?error=paypal");
  }
  redirect(linked ? "/s/onboarding" : "/s/onboarding?pending=1");
}

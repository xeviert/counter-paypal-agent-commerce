import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { EventSource } from "@/lib/db/orders";
import { events, sellers } from "@/lib/db/schema";
import { findMerchantIdByTrackingId, getMerchantIntegration, onboardingStatus } from "@/lib/paypal/referrals";

// ARCHITECTURE §6.1. PayPal's return-URL params are hints only; merchant-integrations is the truth.

type OnboardingSeller = { id: string; merchantId: string | null; onboardedAt: Date | null };

export type OnboardingStatus = ReturnType<typeof onboardingStatus>;

/**
 * Looks the maker up at PayPal (by `tracking_id` = our seller id, unless `merchantId` is known) and
 * stores the result. Undefined while the maker hasn't finished connecting.
 */
export async function syncOnboarding(
  db: Tx,
  seller: OnboardingSeller,
  opts: { source: EventSource; actor?: string; merchantId?: string },
): Promise<OnboardingStatus | undefined> {
  const merchantId = opts.merchantId ?? seller.merchantId ?? (await findMerchantIdByTrackingId(seller.id));
  if (!merchantId) return undefined;
  const status = onboardingStatus(await getMerchantIntegration(merchantId));
  await db.transaction(async (tx) => {
    await tx
      .update(sellers)
      .set({
        merchantId: status.merchantId,
        paymentsReceivable: status.paymentsReceivable,
        primaryEmailConfirmed: status.primaryEmailConfirmed,
        grantedScopes: status.grantedScopes,
        consentStatus: "granted",
        consentRevokedAt: null,
        onboardedAt: seller.onboardedAt ?? new Date(),
      })
      .where(eq(sellers.id, seller.id));
    await tx.insert(events).values({
      type: "seller.onboarded",
      source: opts.source,
      actor: opts.actor ?? "system",
      sellerId: seller.id,
      payload: status,
    });
  });
  return status;
}

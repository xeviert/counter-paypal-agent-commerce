import { getEnv } from "@/lib/env";
import {
  findLink,
  grantedScopes,
  merchantIntegration,
  merchantIntegrationRef,
  partnerReferral,
  type MerchantIntegration,
} from "@/lib/schemas/paypal";
import { PayPalError, paypalRequest } from "./client";

/** Requested on every referral (ARCHITECTURE §4.3). TRACKING_SHIPMENT_READWRITE is refused for our app. */
export const REFERRAL_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "DELAY_FUNDS_DISBURSEMENT",
  "ACCESS_MERCHANT_INFORMATION",
  "ADVANCED_TRANSACTIONS_SEARCH",
  "READ_SELLER_DISPUTE",
  "UPDATE_SELLER_DISPUTE",
] as const;

/** `trackingId` is our `sellers.id`; merchant-integrations is looked up by it afterwards. */
export function buildReferralBody(trackingId: string, returnUrl: string, email?: string) {
  return {
    tracking_id: trackingId,
    ...(email ? { email } : {}),
    partner_config_override: { return_url: returnUrl },
    operations: [
      {
        operation: "API_INTEGRATION",
        api_integration_preference: {
          rest_api_integration: {
            integration_method: "PAYPAL",
            integration_type: "THIRD_PARTY",
            third_party_details: { features: REFERRAL_FEATURES },
          },
        },
      },
    ],
    products: ["EXPRESS_CHECKOUT"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
  };
}

/** Returns the URL the maker opens to connect PayPal. */
export async function createReferral(trackingId: string, returnUrl: string, email?: string): Promise<string> {
  const referral = await paypalRequest("partner-referrals.create", "/v2/customer/partner-referrals", {
    method: "POST",
    requestId: `referral:${trackingId}`,
    body: buildReferralBody(trackingId, returnUrl, email),
    schema: partnerReferral,
  });
  const actionUrl = findLink(referral.links, "action_url");
  if (!actionUrl) throw new Error("partner referral has no action_url link");
  return actionUrl;
}

const integrationsPath = () =>
  `/v1/customer/partners/${encodeURIComponent(getEnv().PLATFORM_MERCHANT_ID)}/merchant-integrations`;

/** Undefined until the maker has finished connecting PayPal. */
export async function findMerchantIdByTrackingId(trackingId: string): Promise<string | undefined> {
  try {
    const ref = await paypalRequest(
      "merchant-integrations.find",
      `${integrationsPath()}?tracking_id=${encodeURIComponent(trackingId)}`,
      { schema: merchantIntegrationRef, expectedStatuses: [404] },
    );
    return ref.merchant_id;
  } catch (err) {
    if (err instanceof PayPalError && err.status === 404) return undefined;
    throw err;
  }
}

export async function getMerchantIntegration(merchantId: string): Promise<MerchantIntegration> {
  return paypalRequest("merchant-integrations.get", `${integrationsPath()}/${encodeURIComponent(merchantId)}`, {
    schema: merchantIntegration,
  });
}

/** Fields stored on `sellers`. Listings may go live only when `paymentsReceivable`. */
export function onboardingStatus(m: MerchantIntegration) {
  return {
    merchantId: m.merchant_id,
    paymentsReceivable: m.payments_receivable,
    primaryEmailConfirmed: m.primary_email_confirmed,
    grantedScopes: grantedScopes(m),
  };
}

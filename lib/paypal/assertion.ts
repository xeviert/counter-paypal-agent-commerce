import { getEnv } from "@/lib/env";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * `PayPal-Auth-Assertion` for acting as a maker (ARCHITECTURE §4.2). Takes the seller row rather than
 * a bare id so `payer_id` always comes from our DB, never from request or model input.
 */
export function authAssertion(seller: { merchantId: string | null }): string {
  if (!seller.merchantId) throw new Error("seller has no PayPal merchant id (not onboarded)");
  return `${b64({ alg: "none" })}.${b64({ iss: getEnv().PLATFORM_CLIENT_ID, payer_id: seller.merchantId })}.`;
}

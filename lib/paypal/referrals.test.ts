import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockPayPal, stubPayPalEnv } from "@/test/paypal";
import { authAssertion } from "./assertion";
import { clearTokenCache } from "./client";
import {
  buildReferralBody,
  createReferral,
  findMerchantIdByTrackingId,
  getMerchantIntegration,
  onboardingStatus,
  REFERRAL_FEATURES,
} from "./referrals";

const SELLER_ID = "5d2a0b4e-1c3f-4a6b-9d8e-7f6a5b4c3d2e";

beforeEach(() => {
  stubPayPalEnv();
  clearTokenCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authAssertion", () => {
  it("encodes the platform client id and the seller's merchant id, unsigned", () => {
    const [header, payload, signature] = authAssertion({ merchantId: "MPMWEFYQWQYUA" }).split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      iss: "test-client-id",
      payer_id: "MPMWEFYQWQYUA",
    });
    expect(signature).toBe("");
  });

  it("refuses a seller that hasn't onboarded", () => {
    expect(() => authAssertion({ merchantId: null })).toThrow(/not onboarded/);
  });
});

describe("referrals", () => {
  it("builds a third-party referral with every feature", () => {
    const body = buildReferralBody(SELLER_ID, "https://counter.test/");
    expect(body.tracking_id).toBe(SELLER_ID);
    expect(body).not.toHaveProperty("email");
    expect(body.operations[0]?.api_integration_preference.rest_api_integration).toEqual({
      integration_method: "PAYPAL",
      integration_type: "THIRD_PARTY",
      third_party_details: { features: REFERRAL_FEATURES },
    });
    expect(body.products).toEqual(["EXPRESS_CHECKOUT"]);
  });

  it("returns the action_url link", async () => {
    const { calls } = mockPayPal(() =>
      json(201, {
        links: [
          { href: "https://api-m.sandbox.paypal.com/v1/customer/partner-referrals/abc", rel: "self" },
          { href: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=abc", rel: "action_url" },
        ],
      }),
    );
    expect(await createReferral(SELLER_ID, "https://counter.test/")).toContain("referralToken=abc");
    expect(calls[0]?.headers.get("PayPal-Request-Id")).toBe(`referral:${SELLER_ID}`);
  });

  it("looks the merchant up by tracking id and returns undefined before onboarding", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls } = mockPayPal((call) =>
      call.path.includes("tracking_id=") && call.path.includes(SELLER_ID)
        ? json(200, { merchant_id: "MPMWEFYQWQYUA", tracking_id: SELLER_ID })
        : json(404, { name: "RESOURCE_NOT_FOUND" }),
    );
    expect(await findMerchantIdByTrackingId(SELLER_ID)).toBe("MPMWEFYQWQYUA");
    expect(await findMerchantIdByTrackingId("other")).toBeUndefined();
    // Polled every few seconds while the maker signs up; the expected 404 isn't an error log.
    expect(errors).not.toHaveBeenCalled();
    expect(calls[0]?.path).toBe(
      `/v1/customer/partners/9MGXZVWN9N9EE/merchant-integrations?tracking_id=${SELLER_ID}`,
    );
  });

  it("maps merchant-integrations to seller fields", async () => {
    mockPayPal(() =>
      json(200, {
        merchant_id: "MPMWEFYQWQYUA",
        payments_receivable: true,
        primary_email_confirmed: false,
        oauth_integrations: [{ oauth_third_party: [{ scopes: ["https://uri.paypal.com/services/payments/refund"] }] }],
      }),
    );
    expect(onboardingStatus(await getMerchantIntegration("MPMWEFYQWQYUA"))).toEqual({
      merchantId: "MPMWEFYQWQYUA",
      paymentsReceivable: true,
      primaryEmailConfirmed: false,
      grantedScopes: ["https://uri.paypal.com/services/payments/refund"],
    });
  });
});

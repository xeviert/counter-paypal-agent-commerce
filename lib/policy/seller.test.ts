import { describe, expect, it } from "vitest";
import { canPublish, canReceive, publishBlockers } from "./seller";

const ready = {
  merchantId: "M1",
  paymentsReceivable: true,
  primaryEmailConfirmed: true,
  consentStatus: "granted" as const,
};

describe("publishBlockers", () => {
  it("is empty for a fully onboarded maker", () => {
    expect(publishBlockers(ready)).toEqual([]);
    expect(canPublish(ready)).toBe(true);
  });

  it("only asks to connect when there's no merchant id", () => {
    expect(publishBlockers({ ...ready, merchantId: null, paymentsReceivable: false })).toEqual(["not_connected"]);
  });

  it("lists every remaining step", () => {
    expect(publishBlockers({ ...ready, paymentsReceivable: false, primaryEmailConfirmed: false })).toEqual([
      "not_receivable",
      "email_unconfirmed",
    ]);
    expect(publishBlockers({ ...ready, consentStatus: "revoked" })).toEqual(["consent_revoked"]);
    expect(publishBlockers({ ...ready, consentStatus: "pending" })).toEqual(["not_connected"]);
  });
});

describe("canReceive", () => {
  it("ignores email confirmation, which only gates new listings", () => {
    expect(canReceive({ ...ready, primaryEmailConfirmed: false })).toBe(true);
    expect(canReceive({ ...ready, consentStatus: "revoked" })).toBe(false);
    expect(canReceive({ ...ready, merchantId: null })).toBe(false);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { webhookEnvelope } from "@/lib/schemas/paypal";
import { buildVerifyBody, pickTransmissionHeaders } from "./webhooks";

// Real sandbox deliveries captured during spike 11 (Oct 27): headers + exact raw body.
const dir = "test/fixtures/webhooks";
const fixtures = readdirSync(dir).map((file) => {
  const { headers, raw_body } = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as {
    headers: Record<string, string>;
    raw_body: string;
  };
  return { file, headers, rawBody: raw_body };
});

describe.each(fixtures)("fixture $file", ({ file, headers, rawBody }) => {
  it("parses with the envelope schema and matches its event type", () => {
    const event = webhookEnvelope.parse(JSON.parse(rawBody));
    expect(`${event.event_type}.json`).toBe(file);
  });

  it("carries every transmission header verification needs", () => {
    expect(Object.keys(pickTransmissionHeaders(new Headers(headers))).sort()).toEqual([
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ]);
  });

  it("is spliced into the verify body unchanged", () => {
    expect(buildVerifyBody(rawBody, headers, "WH-ID").endsWith(`"webhook_event":${rawBody}}`)).toBe(true);
  });
});

it("has the release event, which links back to the capture", () => {
  const release = fixtures.find((f) => f.file.startsWith("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED"));
  const event = JSON.parse(release!.rawBody) as { resource: { reference_id: string; reference_type: string } };
  expect(event.resource).toMatchObject({ reference_type: "TRANSACTION_ID", reference_id: expect.any(String) });
});

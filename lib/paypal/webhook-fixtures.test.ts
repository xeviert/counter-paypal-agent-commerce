import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { refundCaptureId, webhookEnvelope } from "@/lib/schemas/paypal";
import { buildVerifyBody, parseWebhookResource, pickTransmissionHeaders } from "./webhooks";

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

describe("parseWebhookResource", () => {
  const parse = (eventType: string) =>
    parseWebhookResource(webhookEnvelope.parse(JSON.parse(fixtures.find((f) => f.file === `${eventType}.json`)!.rawBody)));

  it("types the capture and approved-order resources", () => {
    const completed = parse("PAYMENT.CAPTURE.COMPLETED");
    expect(completed.kind === "capture" && completed.capture.seller_receivable_breakdown?.net_amount?.cents).toBe(881);
    // Resources carry state at delivery time: this APPROVED event arrived after the capture.
    const approved = parse("CHECKOUT.ORDER.APPROVED");
    expect(approved.kind === "order" && approved.order.status).toBe("COMPLETED");
  });

  it("parses refunds and payouts, and finds the refunded capture through its up link", () => {
    const refunded = parse("PAYMENT.CAPTURE.REFUNDED");
    expect(refunded.kind).toBe("refund");
    if (refunded.kind === "refund") {
      expect(refundCaptureId(refunded.refund)).toBe("2DH54088UW786173Y");
      expect(refunded.refund.amount?.cents).toBe(200);
    }
    const payout = parse("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED");
    expect(payout).toMatchObject({
      kind: "payout",
      payout: { reference_id: "2DH54088UW786173Y", processing_state: { status: "SUCCESS" } },
    });
  });

  // Bodies only (Nov 10, copied from the /ops audit log): the signature headers aren't stored.
  it.each([
    ["dispute-created", "created", "UNDER_REVIEW"],
    ["dispute-updated", "updated", "WAITING_FOR_SELLER_RESPONSE"],
  ])("parses the real %s body and finds the disputed capture", (name, stage, status) => {
    const body = readFileSync(`test/fixtures/paypal/webhook.${name}.json`, "utf8");
    expect(parseWebhookResource(webhookEnvelope.parse(JSON.parse(body)))).toMatchObject({
      kind: "dispute",
      stage,
      dispute: { dispute_id: "PP-R-LZL-10198117", status, disputed_transactions: [{ seller_transaction_id: "1DG173080X385283X" }] },
    });
  });

  it("leaves unsubscribed events alone", () => {
    expect(parse("CHECKOUT.ORDER.COMPLETED").kind).toBe("unhandled");
  });
});

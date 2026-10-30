import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { receivePayPalWebhook } from "@/lib/paypal/webhook-inbox";
import { verifyWebhookSignature } from "@/lib/paypal/webhooks";
import { handlePayPalEvent } from "@/lib/shop/webhook-handlers";

export async function POST(request: Request) {
  await connection();
  const db = getDb();
  const { status, outcome } = await receivePayPalWebhook(await request.text(), request.headers, {
    db,
    verify: verifyWebhookSignature,
    handle: (event) => handlePayPalEvent(db, event),
  });
  return Response.json({ outcome }, { status });
}

import { connection } from "next/server";
import { receivePayPalWebhook } from "@/lib/paypal/webhook-inbox";

export async function POST(request: Request) {
  await connection();
  const { status, outcome } = await receivePayPalWebhook(await request.text(), request.headers);
  return Response.json({ outcome }, { status });
}

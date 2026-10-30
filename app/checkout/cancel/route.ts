import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { cancelRedirect } from "@/lib/shop/checkout-return";

export async function GET(request: Request) {
  await connection();
  const target = await cancelRedirect(getDb(), new URL(request.url).searchParams.get("token"));
  if (!target) notFound();
  return Response.redirect(target, 303);
}

import { NextResponse } from "next/server";
import { getSessionSellerId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { sellers } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { syncOnboarding } from "@/lib/shop/onboarding";
import { eq } from "drizzle-orm";

// PayPal sends the maker here after "Connect PayPal". The query params (merchantIdInPayPal,
// permissionsGranted, consentStatus) are only hints; syncOnboarding asks merchant-integrations.
export async function GET() {
  // Behind Render's proxy request.url is the internal http://localhost:10000, so build from APP_BASE_URL.
  const to = (path: string) => NextResponse.redirect(new URL(path, getEnv().APP_BASE_URL), 303);
  const sellerId = await getSessionSellerId();
  if (!sellerId) return to("/s/login");
  const db = getDb();
  const [seller] = await db.select().from(sellers).where(eq(sellers.id, sellerId));
  if (!seller) return to("/s/login");
  try {
    const status = await syncOnboarding(db, seller, { source: "web", actor: seller.id });
    return to(status ? "/s/onboarding" : "/s/onboarding?pending=1");
  } catch (err) {
    log.error("onboarding return failed", { seller_id: seller.id, error: err });
    return to("/s/onboarding?error=paypal");
  }
}

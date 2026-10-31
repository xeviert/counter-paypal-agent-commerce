import { cookies } from "next/headers";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE } from "./cookie";
import { SESSION_TTL_S, signSession, verifySession } from "./token";

function secret(): string {
  const value = getEnv().SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set; maker sessions need it");
  return value;
}

export async function getSessionSellerId(): Promise<string | undefined> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return undefined;
  // The expiry check reads the clock, which Cache Components only allows at request time.
  await connection();
  return verifySession(secret(), value);
}

export async function startSession(sellerId: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, signSession(secret(), sellerId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, not Strict: PayPal's redirect back to /s/onboarding/return is a cross-site navigation.
    sameSite: "lax",
    path: "/s",
    maxAge: SESSION_TTL_S,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/s" });
}

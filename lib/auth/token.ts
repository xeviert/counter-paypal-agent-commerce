import { createHmac, timingSafeEqual } from "node:crypto";

// Maker session cookie value: `{sellerId}.{expiresAtSeconds}.{hmac}`. Stateless, so sign-out only
// clears the cookie; a stolen value works until it expires (BUILDOUT plan D3).

export const SESSION_TTL_S = 30 * 24 * 3600;

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function signSession(secret: string, sellerId: string, now = Date.now()): string {
  const payload = `${sellerId}.${Math.floor(now / 1000) + SESSION_TTL_S}`;
  return `${payload}.${mac(secret, payload)}`;
}

/** The seller id, or undefined for a malformed, tampered or expired value. */
export function verifySession(secret: string, value: string, now = Date.now()): string | undefined {
  const parts = value.split(".");
  if (parts.length !== 3) return undefined;
  const [sellerId, exp, given] = parts as [string, string, string];
  const expected = Buffer.from(mac(secret, `${sellerId}.${exp}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return undefined;
  return sellerId;
}

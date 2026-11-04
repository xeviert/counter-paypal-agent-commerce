import { createHmac, timingSafeEqual } from "node:crypto";

// Signed cookie values: `{subject}.{expiresAtSeconds}.{hmac}`. Stateless, so sign-out only clears the
// cookie; a stolen value works until it expires (BUILDOUT plan D3). The scope goes into the MAC but not
// the value, so a maker cookie never verifies as an operator one (or the reverse).

export const SESSION_TTL_S = 30 * 24 * 3600;

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

// The maker scope is empty so cookies issued before scopes existed stay valid.
const scoped = (scope: string, payload: string) => (scope ? `${scope}:${payload}` : payload);

export function signToken(secret: string, scope: string, subject: string, ttlS: number, now = Date.now()): string {
  const payload = `${subject}.${Math.floor(now / 1000) + ttlS}`;
  return `${payload}.${mac(secret, scoped(scope, payload))}`;
}

/** The subject, or undefined for a malformed, tampered, expired or other-scope value. */
export function verifyToken(secret: string, scope: string, value: string, now = Date.now()): string | undefined {
  const parts = value.split(".");
  if (parts.length !== 3) return undefined;
  const [subject, exp, given] = parts as [string, string, string];
  const expected = Buffer.from(mac(secret, scoped(scope, `${subject}.${exp}`)));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return undefined;
  return subject;
}

export const signSession = (secret: string, sellerId: string, now = Date.now()) =>
  signToken(secret, "", sellerId, SESSION_TTL_S, now);

export const verifySession = (secret: string, value: string, now = Date.now()) => verifyToken(secret, "", value, now);

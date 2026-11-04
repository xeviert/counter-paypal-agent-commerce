import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getEnv, type Env } from "@/lib/env";
import { OPS_COOKIE } from "./cookie";
import { signToken, verifyToken } from "./token";

// Operator console auth (BUILDOUT §7.4). One shared password, plus an optional read-only judge
// password (§10 #8). The role lives in the signed cookie; there is no operator table.

export type OpsRole = "operator" | "judge";

const OPS_SCOPE = "ops";
const OPS_TTL_S = 12 * 3600;

const digest = (value: string) => createHash("sha256").update(value).digest();

// Hashing first makes both sides 32 bytes, so the comparison doesn't leak the password's length.
const same = (given: string, expected: string | undefined) =>
  expected !== undefined && timingSafeEqual(digest(given), digest(expected));

/** Which role a password unlocks. The operator password wins if both are set to the same value. */
export function matchOpsPassword(env: Pick<Env, "OPS_PASSWORD" | "OPS_JUDGE_PASSWORD">, given: string): OpsRole | undefined {
  if (!env.OPS_PASSWORD) return undefined;
  if (same(given, env.OPS_PASSWORD)) return "operator";
  if (same(given, env.OPS_JUDGE_PASSWORD)) return "judge";
  return undefined;
}

export const opsEnabled = () => Boolean(getEnv().OPS_PASSWORD);

function secret(): string {
  const value = getEnv().SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set; operator sessions need it");
  return value;
}

export const signOpsToken = (secret: string, role: OpsRole, now = Date.now()) =>
  signToken(secret, OPS_SCOPE, role, OPS_TTL_S, now);

export function verifyOpsToken(secret: string, value: string, now = Date.now()): OpsRole | undefined {
  const role = verifyToken(secret, OPS_SCOPE, value, now);
  return role === "operator" || role === "judge" ? role : undefined;
}

export async function startOpsSession(role: OpsRole): Promise<void> {
  (await cookies()).set(OPS_COOKIE, signOpsToken(secret(), role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/ops",
    maxAge: OPS_TTL_S,
  });
}

export async function endOpsSession(): Promise<void> {
  (await cookies()).delete({ name: OPS_COOKIE, path: "/ops" });
}

export const currentOpsRole = cache(async (): Promise<OpsRole | undefined> => {
  // Request time first: OPS_PASSWORD is read at runtime, never baked into a prerendered shell. The
  // expiry check reads the clock, which Cache Components also only allows here.
  await connection();
  if (!opsEnabled()) return undefined;
  const value = (await cookies()).get(OPS_COOKIE)?.value;
  if (!value) return undefined;
  const role = verifyOpsToken(secret(), value);
  // A judge cookie outlives a removed judge password otherwise.
  if (role === "judge" && !getEnv().OPS_JUDGE_PASSWORD) return undefined;
  return role;
});

/** Every /ops page, action and route starts here. Console off → 404; signed out → login. */
export async function requireOperator(): Promise<OpsRole> {
  await connection();
  if (!opsEnabled()) notFound();
  const role = await currentOpsRole();
  if (!role) redirect("/ops/login");
  return role;
}

/** Write actions and the copilot: the judge role is read-only. */
export async function requireOperatorWrite(): Promise<"operator"> {
  const role = await requireOperator();
  if (role !== "operator") notFound();
  return role;
}

"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { endOpsSession, matchOpsPassword, opsEnabled, requireOperatorWrite, startOpsSession } from "@/lib/auth/operator";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { clientIp } from "@/lib/mcp/agent";
import { RateLimiter } from "@/lib/mcp/rate-limit";
import { approveListing, rejectListing } from "@/lib/shop/ops";

export type OpsLoginState = { error?: "wrong" | "tooMany" };

const globalForOps = globalThis as unknown as { opsLoginLimiter?: RateLimiter };

export async function opsLogIn(_prev: OpsLoginState, form: FormData): Promise<OpsLoginState> {
  if (!opsEnabled()) notFound();
  globalForOps.opsLoginLimiter ??= new RateLimiter();
  const ip = clientIp(await headers());
  // Counts every attempt, right or wrong: 5 per 10 minutes per IP.
  if (!globalForOps.opsLoginLimiter.check([{ key: `ops-login:${ip}`, max: 5, windowMs: 10 * 60_000 }]).ok) {
    return { error: "tooMany" };
  }
  const role = matchOpsPassword(getEnv(), String(form.get("password") ?? ""));
  await getDb()
    .insert(events)
    .values({
      type: role ? "ops.login" : "ops.login_failed",
      source: "ops",
      actor: role ?? "unknown",
      payload: { ip: createHash("sha256").update(ip).digest("base64url").slice(0, 12) },
    });
  if (!role) return { error: "wrong" };
  await startOpsSession(role);
  redirect("/ops");
}

export async function opsLogOut(): Promise<void> {
  await endOpsSession();
  redirect("/ops/login");
}

export async function approve(form: FormData): Promise<void> {
  await requireOperatorWrite();
  await approveListing(getDb(), String(form.get("productId")));
  revalidatePath("/ops", "layout");
}

export async function reject(form: FormData): Promise<void> {
  await requireOperatorWrite();
  await rejectListing(getDb(), String(form.get("productId")), String(form.get("reason") ?? ""));
  revalidatePath("/ops", "layout");
}

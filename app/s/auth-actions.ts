"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { MessageKey } from "@/lib/i18n/core";
import { clientIp } from "@/lib/mcp/agent";
import { RateLimiter } from "@/lib/mcp/rate-limit";
import { loginInput, signupInput } from "@/lib/schemas/maker";
import { authenticate, createSellerAccount, isDemoSeller } from "@/lib/shop/sellers";

export type FormState = {
  error?: MessageKey;
  fields?: Partial<Record<string, MessageKey>>;
  values?: Record<string, string>;
};

const globalForAuth = globalThis as unknown as { authLimiter?: RateLimiter };

/** Sign-up and sign-in attempts per client IP: slows password guessing and seller spam. */
async function allowAttempt(kind: "login" | "signup"): Promise<boolean> {
  globalForAuth.authLimiter ??= new RateLimiter();
  const ip = clientIp(await headers());
  const limit = kind === "login" ? { max: 10, windowMs: 60_000 } : { max: 5, windowMs: 10 * 60_000 };
  return globalForAuth.authLimiter.check([{ key: `${kind}:${ip}`, ...limit }]).ok;
}

function fieldErrors(error: z.ZodError): FormState["fields"] {
  const fields: Record<string, MessageKey> = {};
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? "");
    fields[name] ??= (issue.message.includes(".") ? issue.message : "errors.required") as MessageKey;
  }
  return fields;
}

function formValues(form: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(form.get(name) ?? "")]));
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form, ["name", "email", "country", "language"]);
  const parsed = signupInput.safeParse({ ...values, password: form.get("password") });
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };
  if (!(await allowAttempt("signup"))) return { error: "errors.tooMany", values };
  const result = await createSellerAccount(getDb(), parsed.data);
  if (!result.ok) return { fields: { email: "auth.emailTaken" }, values };
  await startSession(result.sellerId);
  redirect("/s/onboarding");
}

export async function logIn(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form, ["email"]);
  const parsed = loginInput.safeParse({ ...values, password: form.get("password") });
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };
  if (!(await allowAttempt("login"))) return { error: "errors.tooMany", values };
  const sellerId = await authenticate(getDb(), parsed.data.email, parsed.data.password);
  if (!sellerId) return { error: "auth.wrongCredentials", values };
  await startSession(sellerId);
  redirect("/s");
}

export async function demoLogIn(form: FormData): Promise<void> {
  const sellerId = z.uuid().safeParse(form.get("sellerId"));
  if (!getEnv().DEMO_LOGIN || !sellerId.success || !(await isDemoSeller(getDb(), sellerId.data))) {
    redirect("/s/login");
  }
  await startSession(sellerId.data);
  redirect("/s");
}

export async function logOut(): Promise<void> {
  await endSession();
  redirect("/s/login");
}

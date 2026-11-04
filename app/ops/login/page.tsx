import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentOpsRole, opsEnabled } from "@/lib/auth/operator";
import { OpsLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function OpsLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <Suspense>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  // The console exists only where OPS_PASSWORD is set at runtime, not at build time.
  await connection();
  if (!opsEnabled()) notFound();
  if (await currentOpsRole()) redirect("/ops");
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Counter</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Operator console</h1>
      </div>
      <OpsLoginForm />
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicShell } from "../public-shell";
import { SignupForm } from "./signup-form";
import { PageLoading } from "@/components/maker/page-loading";

export const metadata: Metadata = { title: "Start selling · Counter", robots: { index: false } };

export default function SignupPage({ searchParams }: PageProps<"/s/signup">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <p className="text-sm font-medium text-muted-foreground">Counter</p>
      <Suspense fallback={<PageLoading />}>
        <PublicShell searchParams={searchParams} path="/s/signup">
          {({ t }) => (
            <>
              <header className="flex flex-col gap-1">
                <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("auth.signupTitle")}</h1>
                <p className="text-muted-foreground">{t("auth.signupIntro")}</p>
              </header>
              <SignupForm />
            </>
          )}
        </PublicShell>
      </Suspense>
    </main>
  );
}

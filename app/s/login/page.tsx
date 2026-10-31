import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { countryName, languageName, type Locale, type T } from "@/lib/i18n";
import { listDemoSellers } from "@/lib/shop/sellers";
import { demoLogIn } from "../auth-actions";
import { PublicShell } from "../public-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Counter", robots: { index: false } };

export default function LoginPage({ searchParams }: PageProps<"/s/login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <p className="text-sm font-medium text-muted-foreground">Counter</p>
      <Suspense>
        <PublicShell searchParams={searchParams} path="/s/login">
          {({ locale, t }) => (
            <>
              <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("auth.loginTitle")}</h1>
              <LoginForm />
              {getEnv().DEMO_LOGIN && <DemoMakers locale={locale} t={t} />}
            </>
          )}
        </PublicShell>
      </Suspense>
    </main>
  );
}

async function DemoMakers({ locale, t }: { locale: Locale; t: T }) {
  const makers = await listDemoSellers(getDb());
  if (makers.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="font-medium">{t("auth.demoTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("auth.demoHint")}</p>
      </div>
      {makers.map((maker) => (
        <form key={maker.id} action={demoLogIn}>
          <input type="hidden" name="sellerId" value={maker.id} />
          <Button type="submit" variant="outline" className="h-auto w-full flex-col items-start gap-0.5 p-3 text-left">
            <span className="font-medium">{t("auth.demoSignIn", { name: maker.name })}</span>
            <span className="text-xs font-normal whitespace-normal text-muted-foreground">
              {[maker.locality, countryName(maker.country, locale), languageName(maker.language, locale)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Button>
        </form>
      ))}
    </section>
  );
}

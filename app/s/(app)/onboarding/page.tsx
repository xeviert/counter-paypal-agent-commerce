import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { requireSeller } from "@/lib/auth/seller";
import { translator } from "@/lib/i18n";
import { publishBlockers } from "@/lib/policy/seller";
import { checkOnboarding, connectPayPal } from "./actions";

export default function OnboardingPage({ searchParams }: PageProps<"/s/onboarding">) {
  return (
    <Suspense>
      <Onboarding searchParams={searchParams} />
    </Suspense>
  );
}

async function Onboarding({ searchParams }: { searchParams: PageProps<"/s/onboarding">["searchParams"] }) {
  const seller = await requireSeller();
  const { pending, error } = await searchParams;
  const t = translator(seller.locale);
  const blockers = publishBlockers(seller);
  const connected = seller.merchantId !== null && seller.consentStatus === "granted";

  const steps = [
    { done: connected, label: t("onboarding.status.connected") },
    { done: connected && seller.paymentsReceivable, label: t("onboarding.status.receivable") },
    { done: connected && seller.primaryEmailConfirmed, label: t("onboarding.status.emailConfirmed") },
  ];

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
        <p className="text-muted-foreground">{t("onboarding.intro")}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {t("errors.paypal")}
        </p>
      )}
      {pending && !connected && <p className="rounded-lg bg-muted p-3 text-sm">{t("onboarding.notLinkedYet")}</p>}

      <ul className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-2">
            {step.done ? (
              <CheckCircle2Icon className="size-5 text-green-700" aria-hidden />
            ) : (
              <CircleIcon className="size-5 text-muted-foreground" aria-hidden />
            )}
            <span className={step.done ? "" : "text-muted-foreground"}>{step.label}</span>
          </li>
        ))}
      </ul>

      {blockers.length === 0 ? (
        <p className="rounded-lg bg-green-50 p-4 font-medium text-green-900">{t("onboarding.ready")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {blockers.map((b) => (
            <li key={b} className="rounded-lg border p-3">
              {t(`onboarding.blockers.${b}`)}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {!connected && (
          <form action={connectPayPal}>
            <Button type="submit" size="lg" className="h-11 w-full text-base">
              {seller.consentStatus === "revoked" ? t("onboarding.reconnect") : t("onboarding.connect")}
            </Button>
          </form>
        )}
        {blockers.length > 0 && (
          <form action={checkOnboarding}>
            <Button type="submit" variant="outline" size="lg" className="h-11 w-full text-base">
              {t("onboarding.checkAgain")}
            </Button>
          </form>
        )}
      </div>
    </>
  );
}

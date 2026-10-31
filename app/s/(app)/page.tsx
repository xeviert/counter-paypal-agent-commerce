import { ArrowRightIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { formatMoney, translator } from "@/lib/i18n";
import { publishBlockers } from "@/lib/policy/seller";
import { sellerSummary } from "@/lib/shop/seller-orders";

export default function MakerHome() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  const summary = await sellerSummary(getDb(), seller.id);
  const blocked = publishBlockers(seller).length > 0;

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("home.greeting", { name: seller.name })}</h1>

      {blocked && (
        <Link href="/s/onboarding" className="flex items-center justify-between rounded-lg bg-amber-100 p-4 text-sm font-medium text-amber-950">
          {t("home.finishSetup")}
          <ArrowRightIcon className="size-4" aria-hidden />
        </Link>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label={t("home.toShip")} value={String(summary.toShip)} href="/s/orders" />
        <Stat label={t("home.held")} value={formatMoney(summary.heldCents, "USD", seller.locale)} href="/s/orders" />
        <Stat label={t("home.live")} value={String(summary.live)} href="/s/listings" />
      </dl>

      <Link href="/s/new" className={buttonVariants({ size: "lg", className: "h-auto flex-col items-start gap-1 p-4 text-left" })}>
        <span className="flex items-center gap-2 text-base">
          <PlusIcon className="size-5" aria-hidden />
          {t("home.newListing")}
        </span>
        <span className="text-sm font-normal whitespace-normal opacity-80">{t("home.newListingHint")}</span>
      </Link>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-1 rounded-lg border p-3">
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      <dt className="order-first text-xs text-muted-foreground">{label}</dt>
    </Link>
  );
}

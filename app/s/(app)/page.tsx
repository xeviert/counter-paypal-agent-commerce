import { ArrowRightIcon, ChartColumnIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { formatMoney, translator } from "@/lib/i18n";
import { publishBlockers } from "@/lib/policy/seller";
import { salesSummary, sellerSummary, type SalesTotals } from "@/lib/shop/seller-orders";

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
  const db = getDb();
  const [summary, today, week] = await Promise.all([
    sellerSummary(db, seller.id),
    salesSummary(db, seller, "today"),
    salesSummary(db, seller, "week"),
  ]);
  // One currency today (USD); the card shows the first.
  const net = (totals: SalesTotals[]) => formatMoney(totals[0]?.netCents ?? 0, totals[0]?.currency ?? "USD", seller.locale);
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

      <Link href="/s/dashboard" className="flex flex-col gap-2 rounded-lg border p-4">
        <span className="flex items-center justify-between text-base font-medium">
          <span className="flex items-center gap-2">
            <ChartColumnIcon className="size-5" aria-hidden />
            {t("home.dashboard")}
          </span>
          <ArrowRightIcon className="size-4" aria-hidden />
        </span>
        <dl className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("home.today")}</dt>
            <dd className="font-semibold tabular-nums">{net(today.totals)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("home.week")}</dt>
            <dd className="font-semibold tabular-nums">{net(week.totals)}</dd>
          </div>
        </dl>
        <span className="text-sm text-muted-foreground">{t("home.dashboardHint")}</span>
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

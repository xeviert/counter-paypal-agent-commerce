import { ArrowRightIcon, ChartColumnIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { OrderMap } from "@/components/maker/order-map";
import { PageLoading } from "@/components/maker/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { requireSeller, type SessionSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { countryName, formatMoney, translator, type T } from "@/lib/i18n";
import { publishBlockers } from "@/lib/policy/seller";
import { buyerCountries, salesSummary, sellerSummary, type SalesTotals } from "@/lib/shop/seller-orders";

export default function MakerHome() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  const db = getDb();
  const [summary, today, week, shippedTo] = await Promise.all([
    sellerSummary(db, seller.id),
    salesSummary(db, seller, "today"),
    salesSummary(db, seller, "week"),
    buyerCountries(db, seller.id),
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

      <ul className="grid grid-cols-3 divide-x rounded-lg border bg-card">
        <Stat label={t("home.toShip")} value={String(summary.toShip)} href="/s/orders" />
        <Stat label={t("home.held")} value={formatMoney(summary.heldCents, "USD", seller.locale)} href="/s/orders" />
        <Stat label={t("home.live")} value={String(summary.live)} href="/s/listings" />
      </ul>

      <Link href="/s/new" className={buttonVariants({ size: "lg", className: "h-auto flex-col items-start gap-1 p-4 text-left" })}>
        <span className="flex items-center gap-2 text-base">
          <PlusIcon className="size-5" aria-hidden />
          {t("home.newListing")}
        </span>
        <span className="text-sm font-normal whitespace-normal opacity-80">{t("home.newListingHint")}</span>
      </Link>

      <ShippedTo seller={seller} countries={shippedTo} t={t} />

      <Link href="/s/dashboard" className="flex flex-col gap-2 rounded-lg border bg-card p-4">
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
    <li>
      <Link href={href} className="flex h-full flex-col justify-between gap-1 p-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-heading text-xl font-semibold tabular-nums">{value}</span>
      </Link>
    </li>
  );
}

function ShippedTo({ seller, countries, t }: { seller: SessionSeller; countries: { country: string; orders: number }[]; t: T }) {
  const abroad = countries.filter((c) => c.country !== seller.country);
  const place = [seller.locality, countryName(seller.country, seller.locale)].filter(Boolean).join(", ");
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="px-4 pt-3 font-heading text-lg font-semibold">{t("home.mapTitle")}</h2>
      <OrderMap from={seller.country} to={abroad.map((c) => c.country)} className="px-2 py-2" />
      {countries.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">{t("home.mapEmpty", { place })}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-3 text-sm">
          {countries.map((c) => (
            <li key={c.country}>
              {countryName(c.country, seller.locale)} <span className="text-muted-foreground tabular-nums">{c.orders}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

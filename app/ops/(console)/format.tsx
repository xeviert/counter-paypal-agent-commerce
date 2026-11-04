import Link from "next/link";
import { formatMoney } from "@/lib/i18n";
import type { OpsOrderRow } from "@/lib/shop/ops";

// The console is English-only and shows every time in UTC (BUILDOUT §7.4).

export const money = (cents: number, currency: string) => formatMoney(cents, currency, "en", "code");

const utc = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export const when = (date: Date) => `${utc.format(date)} UTC`;

export function ago(date: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Order ref linking to its audit trail, with what the operator needs at a glance. */
export function OrderSummary({ order }: { order: OpsOrderRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <Link href={`/ops/events?order=${order.id}`} className="font-mono text-sm underline underline-offset-4">
          #{order.ref}
        </Link>
        <span className="truncate text-sm">{order.title}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {order.sellerName} · {order.status} · release {order.releaseStatus} · {money(order.totalCents, order.currency)} → {order.buyerCountry}
        {order.buyerName && ` · ${order.buyerName}`}
        {order.buyerEmail && ` <${order.buyerEmail}>`}
      </span>
    </div>
  );
}

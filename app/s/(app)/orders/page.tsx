import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/maker/page-loading";
import { OrderStatusBadge } from "@/components/maker/order-status";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { countryName, formatDate, formatMoney, translator } from "@/lib/i18n";
import { listSellerOrders, makerNet, orderRef } from "@/lib/shop/seller-orders";

export default function OrdersPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Orders />
    </Suspense>
  );
}

async function Orders() {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  const rows = await listSellerOrders(getDb(), seller.id);
  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("orders.title")}</h1>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("orders.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {rows.map(({ order, title }) => (
            <li key={order.id}>
              <Link href={`/s/orders/${order.id}`} className="flex flex-col gap-1 p-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{title}</span>
                  <span className="tabular-nums">{formatMoney(makerNet(order).cents, order.currency, seller.locale)}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span className="truncate">
                    {orderRef(order.id)} · {formatDate(order.createdAt, seller.locale)} · {countryName(order.buyerCountry, seller.locale)}
                  </span>
                  <OrderStatusBadge status={order.status} label={t(`orders.status.${order.status}`)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

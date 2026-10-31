import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { formatDate, formatMoney, translator } from "@/lib/i18n";
import { listSellerOrders, makerNet, orderRef } from "@/lib/shop/seller-orders";

export default function OrdersPage() {
  return (
    <Suspense>
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
        <ul className="flex flex-col gap-2">
          {rows.map(({ order, title }) => (
            <li key={order.id}>
              <Link href={`/s/orders/${order.id}`} className="flex flex-col gap-1 rounded-lg border p-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{title}</span>
                  <span className="tabular-nums">{formatMoney(makerNet(order).cents, order.currency, seller.locale)}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    {orderRef(order.id)} · {formatDate(order.createdAt, seller.locale)}
                  </span>
                  <Badge variant={order.status === "PaidHeld" ? "default" : "secondary"}>{t(`orders.status.${order.status}`)}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

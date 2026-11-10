import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/maker/page-loading";
import { OrderMap } from "@/components/maker/order-map";
import { OrderStatusBadge } from "@/components/maker/order-status";
import { requireSeller, type SessionSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import type { Order } from "@/lib/db/orders";
import { countryName, formatDate, formatMoney, translator, type T } from "@/lib/i18n";
import { CARRIERS, carrierLabel } from "@/lib/policy/carriers";
import { sellerCountry } from "@/lib/schemas/common";
import { shipping } from "@/lib/schemas/paypal";
import { refundableCents } from "@/lib/shop/fulfillment";
import { getSellerOrder, makerNet, orderRef, payoutStatus } from "@/lib/shop/seller-orders";
import { RefundDialog } from "../refund-dialog";
import { TrackingForm } from "../tracking-form";

export default function OrderPage({ params }: PageProps<"/s/orders/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <OrderDetail params={params} />
    </Suspense>
  );
}

async function OrderDetail({ params }: { params: PageProps<"/s/orders/[id]">["params"] }) {
  const seller = await requireSeller();
  const { id } = await params;
  const found = await getSellerOrder(getDb(), seller.id, id);
  if (!found) notFound();
  const { order, title } = found;
  const t = translator(seller.locale);
  const money = (cents: number) => formatMoney(cents, order.currency, seller.locale);
  const net = makerNet(order);
  const refundable = order.releaseStatus === "held" && ["PaidHeld", "Shipped", "Disputed"].includes(order.status);
  const remaining = refundableCents(order);

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("orders.order", { ref: orderRef(order.id) })}</p>
        <h1 className="font-heading text-xl font-semibold tracking-tight">{t("orders.item", { title, quantity: order.quantity })}</h1>
        <OrderStatusBadge status={order.status} label={t(`orders.status.${order.status}`)} />
      </header>

      <Release order={order} seller={seller} t={t} />

      {order.status === "PaidHeld" && order.captureId && (
        <TrackingForm orderId={order.id} carriers={CARRIERS[sellerCountry.parse(seller.country)]} />
      )}
      {order.trackingNumber && order.carrier && (
        <p className="text-sm">
          {t("orders.tracking.shippedWith", {
            carrier: carrierLabel(order.carrier, order.carrierNameOther),
            number: order.trackingNumber,
          })}
        </p>
      )}

      <section className="overflow-hidden rounded-lg border bg-card">
        <OrderMap from={seller.country} to={[order.buyerCountry]} className="border-b bg-muted/40 px-2 py-3" />
        <ShipTo order={order} seller={seller} t={t} />
      </section>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-lg border bg-card p-3 text-sm">
        <dt className="text-muted-foreground">{t("orders.itemTotal")}</dt>
        <dd className="text-right tabular-nums">{money(order.itemAmount)}</dd>
        <dt className="text-muted-foreground">{t("orders.shipping")}</dt>
        <dd className="text-right tabular-nums">{money(order.shippingAmount)}</dd>
        <dt className="text-muted-foreground">{t("orders.counterFee")}</dt>
        <dd className="text-right tabular-nums">−{money(order.platformFee - order.platformFeeRefunded)}</dd>
        {order.paypalFee !== null && (
          <>
            <dt className="text-muted-foreground">{t("orders.paypalFee")}</dt>
            <dd className="text-right tabular-nums">−{money(order.paypalFee)}</dd>
          </>
        )}
        {order.refundedAmount > 0 && (
          <>
            <dt className="text-muted-foreground">{t("orders.refunded")}</dt>
            <dd className="text-right tabular-nums">−{money(order.refundedAmount)}</dd>
          </>
        )}
        <dt className="font-medium">{t("orders.net")}</dt>
        <dd className="text-right font-medium tabular-nums">
          {net.final ? money(net.cents) : t("orders.netPending", { amount: money(net.cents) })}
        </dd>
      </dl>

      {refundable && remaining > 0 && <RefundDialog orderId={order.id} remainingCents={remaining} currency={order.currency} />}
      {order.status === "Released" && <p className="text-sm text-muted-foreground">{t("orders.refund.afterRelease")}</p>}
    </>
  );
}

function Release({ order, seller, t }: { order: Order; seller: SessionSeller; t: T }) {
  const payout = payoutStatus(order);
  if (!payout) return null;
  const text = t(payout.key, payout.date && { date: formatDate(payout.date, seller.locale) });
  return <p className="rounded-lg bg-muted p-3 text-sm">{text}</p>;
}

/** Full address: the maker ships it. Public pages and agents only ever see city + country. */
function ShipTo({ order, seller, t }: { order: Order; seller: SessionSeller; t: T }) {
  const parsed = shipping.safeParse(order.shippingAddress);
  const a = parsed.success ? parsed.data.address : undefined;
  const name = (parsed.success && parsed.data.name?.full_name) || order.buyerName;
  if (!a && !name) return null;
  const lines = [
    name,
    a?.address_line_1,
    a?.address_line_2,
    [a?.admin_area_2, a?.admin_area_1, a?.postal_code].filter(Boolean).join(", "),
    a && countryName(a.country_code, seller.locale),
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1 p-3 text-sm">
      <h2 className="font-medium">{t("orders.shipTo")}</h2>
      <address className="not-italic whitespace-pre-line select-all">{lines.join("\n")}</address>
      {order.buyerEmail && <p className="text-muted-foreground">{order.buyerEmail}</p>}
    </div>
  );
}

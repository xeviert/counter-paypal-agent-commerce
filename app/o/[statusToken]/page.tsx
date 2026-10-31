import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { PolicyError } from "@/lib/policy/errors";
import { statusToken, type Money, type OrderStatus } from "@/lib/schemas/common";
import { getOrderStatus } from "@/lib/shop/order-status";
import { ConfirmReceived } from "./confirm-received";

export const metadata: Metadata = {
  title: "Your order · Counter",
  robots: { index: false, follow: false },
  // The token in this URL controls the order; don't hand it to PayPal or anyone else via Referer.
  referrer: "no-referrer",
};

const LABELS: Record<OrderStatus, string> = {
  CheckoutCreated: "Waiting for your approval",
  Approved: "Completing payment",
  PaidPending: "Payment under review",
  PaidHeld: "Paid",
  Shipped: "Shipped",
  Disputed: "Dispute open",
  Released: "Complete",
  Refunded: "Refunded",
  Expired: "Expired",
  Canceled: "Canceled",
  Denied: "Payment declined",
};

const NOT_CHARGED: ReadonlySet<OrderStatus> = new Set(["Expired", "Canceled", "Denied"]);

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const fmt = (m: Money) => `$${m.value} ${m.currency}`;

export default function OrderPage({ params }: PageProps<"/o/[statusToken]">) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 p-6">
      <p className="text-sm font-medium text-muted-foreground">Counter</p>
      <Suspense fallback={<p className="text-muted-foreground">Loading your order…</p>}>
        <OrderStatusView params={params} />
      </Suspense>
    </main>
  );
}

async function OrderStatusView({ params }: { params: PageProps<"/o/[statusToken]">["params"] }) {
  const { statusToken: token } = await params;
  if (!statusToken.safeParse(token).success) notFound();
  let view;
  try {
    ({ view } = await getOrderStatus(getDb(), token));
  } catch (err) {
    if (err instanceof PolicyError && err.code === "ORDER_NOT_FOUND") notFound();
    throw err;
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{LABELS[view.status]}</h1>
        <p className="text-muted-foreground">{view.product.title}</p>
      </header>

      {NOT_CHARGED.has(view.status) && <p className="font-medium">You weren&apos;t charged.</p>}
      <p>{view.nextStep}</p>

      {(view.status === "Shipped" || view.status === "PaidHeld") && view.releaseStatus === "held" && (
        <ConfirmReceived token={token} />
      )}
      {view.releaseStatus === "requested" && <p className="text-sm text-muted-foreground">Paying the maker…</p>}

      {view.approvalUrl && (
        <a href={view.approvalUrl} rel="noreferrer" className={buttonVariants({ size: "lg" })}>
          Approve on PayPal
        </a>
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
        <dt className="text-muted-foreground">Item × {view.quantity}</dt>
        <dd className="text-right tabular-nums">{fmt(view.totals.item)}</dd>
        <dt className="text-muted-foreground">Shipping</dt>
        <dd className="text-right tabular-nums">{fmt(view.totals.shipping)}</dd>
        <dt className="font-medium">Total</dt>
        <dd className="text-right font-medium tabular-nums">{fmt(view.totals.total)}</dd>
      </dl>

      {(view.shipTo ?? view.tracking) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {view.shipTo && (
            <>
              <dt className="text-muted-foreground">Ships to</dt>
              <dd>{[view.shipTo.city, regionNames.of(view.shipTo.country)].filter(Boolean).join(", ")}</dd>
            </>
          )}
          {view.tracking && (
            <>
              <dt className="text-muted-foreground">Tracking</dt>
              <dd>
                {view.tracking.carrier} {view.tracking.number}
              </dd>
            </>
          )}
        </dl>
      )}

      <p className="text-xs text-muted-foreground">
        Keep this link private: anyone with it can see and manage this order.
      </p>
    </>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { requireOperator } from "@/lib/auth/operator";
import { getDb } from "@/lib/db";
import { makerOverview, needsAttention, type AttentionKey } from "@/lib/shop/ops";
import { ago, OrderSummary } from "./format";

const BUCKETS: Record<AttentionKey, { title: string; hint: string }> = {
  captureOnClosed: {
    title: "Captured after we closed the order",
    hint: "Money moved for an expired or canceled checkout. Refund it by hand on PayPal.",
  },
  reversed: { title: "Chargebacks", hint: "PayPal reversed a capture." },
  releaseStuck: { title: "Releases failing", hint: "Release failed, or requested 15+ min ago with no confirmation." },
  refundStuck: { title: "Refunds failing", hint: "Refund failed, or pending for 15+ min." },
  disputed: { title: "Open disputes", hint: "Release is paused until PayPal resolves them." },
  approvedNotCaptured: { title: "Approved, not captured", hint: "Buyer approved 1+ h ago; stock is still reserved." },
  paidPending: { title: "Capture pending", hint: "PayPal has been reviewing the payment for 24+ h." },
  notShipped: { title: "Paid, not shipped", hint: "No tracking 5+ days after payment." },
  webhookFailed: { title: "Webhooks not processed", hint: "Handler error, or stored 5+ min ago and never processed." },
};

export default function AttentionPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <Attention />
    </Suspense>
  );
}

async function Attention() {
  const role = await requireOperator();
  const db = getDb();
  const [buckets, makers] = await Promise.all([needsAttention(db, role), makerOverview(db)]);
  const open = buckets.filter((b) => b.count > 0);
  const now = new Date();

  return (
    <>
      <section className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Needs attention</h1>
        {open.length === 0 && <p className="text-muted-foreground">Nothing stuck. Every order, release, refund and webhook is moving.</p>}
        {open.map((bucket) => (
          <section key={bucket.key} aria-labelledby={`b-${bucket.key}`} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 id={`b-${bucket.key}`} className="font-medium">
                {BUCKETS[bucket.key].title}
              </h2>
              <Badge variant="destructive">{bucket.count}</Badge>
              <p className="text-sm text-muted-foreground">{BUCKETS[bucket.key].hint}</p>
            </div>
            <ul className="flex flex-col divide-y">
              {bucket.rows.map((row, i) => (
                <li key={row.order?.id ?? row.eventId ?? i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2">
                  {row.order ? (
                    <OrderSummary order={row.order} />
                  ) : (
                    <Link href={`/ops/events?before=${(row.eventId ?? 0) + 1}`} className="font-mono text-sm underline underline-offset-4">
                      event {row.eventId}
                    </Link>
                  )}
                  <span className="text-sm">
                    {row.detail} <span className="text-muted-foreground">{ago(row.at, now)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {bucket.count > bucket.rows.length && (
              <p className="text-xs text-muted-foreground">Showing the {bucket.rows.length} oldest of {bucket.count}.</p>
            )}
          </section>
        ))}
      </section>

      <section aria-labelledby="makers" className="flex flex-col gap-2">
        <h2 id="makers" className="font-medium">
          Makers
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-4 font-medium">Maker</th>
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 pr-4 font-medium">PayPal</th>
                <th className="py-2 pr-4 text-right font-medium">Live</th>
                <th className="py-2 pr-4 text-right font-medium">In review</th>
                <th className="py-2 text-right font-medium">Orders held</th>
              </tr>
            </thead>
            <tbody>
              {makers.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/ops/events?seller=${m.id}`} className="underline-offset-4 hover:underline">
                      {m.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{m.country}</td>
                  <td className="py-2 pr-4">
                    {m.paymentsReceivable && m.consentStatus === "granted" ? (
                      "Connected"
                    ) : (
                      <span className="text-destructive">
                        {m.consentStatus === "revoked" ? "Consent revoked" : m.paymentsReceivable ? "Consent pending" : "Can't receive"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{m.live}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {m.review > 0 ? (
                      <Link href="/ops/listings" className="underline underline-offset-4">
                        {m.review}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{m.heldOrders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

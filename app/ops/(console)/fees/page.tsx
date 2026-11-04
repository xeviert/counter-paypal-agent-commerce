import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/operator";
import { getDb } from "@/lib/db";
import { feeSummary, moneyState } from "@/lib/shop/ops";
import { SALES_PERIODS, type SalesPeriod } from "@/lib/shop/seller-orders";
import { money, when } from "../format";

export const metadata: Metadata = { title: "Fees" };

const LABELS: Record<SalesPeriod, string> = { today: "Today", week: "This week", month: "This month" };

export default function FeesPage({ searchParams }: PageProps<"/ops/fees">) {
  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Fees and held money</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Fees searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Fees({ searchParams }: { searchParams: PageProps<"/ops/fees">["searchParams"] }) {
  await requireOperator();
  const requested = (await searchParams).period;
  const period = SALES_PERIODS.find((p) => p === requested) ?? "week";
  const db = getDb();
  const [fees, state] = await Promise.all([feeSummary(db, period), moneyState(db)]);

  return (
    <>
      <section aria-labelledby="earned" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-4">
          <h2 id="earned" className="font-medium">
            Platform fees earned
          </h2>
          <nav aria-label="Period" className="flex gap-3 text-sm">
            {SALES_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/ops/fees?period=${p}`}
                aria-current={p === period ? "page" : undefined}
                className="text-muted-foreground underline-offset-4 hover:underline aria-[current=page]:font-medium aria-[current=page]:text-foreground"
              >
                {LABELS[p]}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-xs text-muted-foreground">
          Orders captured since {when(fees.since)}, including seeded history. Fees earned = platform fee minus the share PayPal returned with refunds.
        </p>
        <MoneyTable
          head={["Currency", "Orders", "Gross", "Refunded", "Fees earned"]}
          rows={fees.totals.map((t) => [t.currency, t.orders, money(t.grossCents, t.currency), money(t.refundedCents, t.currency), money(t.feesCents, t.currency)])}
          empty="No captures in this period."
        />
      </section>

      <section aria-labelledby="held" className="flex flex-col gap-3">
        <h2 id="held" className="font-medium">
          Makers&apos; money, all time
        </h2>
        <p className="text-xs text-muted-foreground">Held: paid, not yet released (incl. disputes). Amounts are what makers receive after fees and refunds.</p>
        <MoneyTable
          head={["Currency", "Held orders", "Held", "Released orders", "Released"]}
          rows={state.map((s) => [s.currency, s.heldOrders, money(s.heldCents, s.currency), s.releasedOrders, money(s.releasedCents, s.currency)])}
          empty="No paid orders yet."
        />
      </section>
    </>
  );
}

function MoneyTable({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-3xl text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            {head.map((h, i) => (
              <th key={h} className={`py-2 pr-4 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])} className="border-b last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={`py-2 pr-4 tabular-nums ${i > 0 ? "text-right" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

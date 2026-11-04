import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireOperator } from "@/lib/auth/operator";
import { getDb } from "@/lib/db";
import { eventSource } from "@/lib/db/schema";
import { EVENTS_PAGE, listEvents, type EventFilter, type OpsEventRow } from "@/lib/shop/ops";
import { when } from "../format";

export const metadata: Metadata = { title: "Audit log" };

const FILTER_PARAMS = { order: "order", product: "productId", seller: "sellerId", actor: "actor", type: "type", source: "source" } as const;
type Param = keyof typeof FILTER_PARAMS;

export default function EventsPage({ searchParams }: PageProps<"/ops/events">) {
  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Audit log</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Events searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

async function Events({ searchParams }: { searchParams: PageProps<"/ops/events">["searchParams"] }) {
  const role = await requireOperator();
  const params = await searchParams;
  const values = Object.fromEntries((Object.keys(FILTER_PARAMS) as Param[]).map((p) => [p, one(params[p])])) as Record<Param, string | undefined>;
  const filter: EventFilter = Object.fromEntries(
    (Object.keys(FILTER_PARAMS) as Param[]).map((p) => [FILTER_PARAMS[p], values[p]]),
  );
  const beforeId = Number(one(params.before));
  if (Number.isSafeInteger(beforeId) && beforeId > 0) filter.before = beforeId;

  const rows = await listEvents(getDb(), role, filter);
  const linkWith = (patch: Partial<Record<Param | "before", string>>) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...values, before: undefined, ...patch })) if (v) query.set(k, v);
    return `/ops/events?${query}`;
  };

  return (
    <>
      <form className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Filter events">
        <FilterInput name="order" label="Order (ref or id)" value={values.order} />
        <FilterInput name="actor" label="Agent / actor" value={values.actor} />
        <FilterInput name="type" label="Type starts with" value={values.type} placeholder="mcp.make_offer" />
        <FilterInput name="product" label="Product id" value={values.product} />
        <FilterInput name="seller" label="Seller id" value={values.seller} />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Source
          <select name="source" defaultValue={values.source ?? ""} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground">
            <option value="">Any</option>
            {eventSource.enumValues.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">Filter</Button>
          <Link href="/ops/events" className="pb-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline">
            Clear
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">No events match.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border">
          {rows.map((row) => (
            <EventItem key={row.id} row={row} linkWith={linkWith} />
          ))}
        </ol>
      )}
      {rows.length === EVENTS_PAGE && (
        <Link href={linkWith({ before: String(rows.at(-1)!.id) })} className="self-start text-sm underline underline-offset-4">
          Older events
        </Link>
      )}
    </>
  );
}

function FilterInput({ name, label, value, placeholder }: { name: string; label: string; value?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input name={name} defaultValue={value} placeholder={placeholder} className="font-mono text-foreground" />
    </label>
  );
}

function EventItem({ row, linkWith }: { row: OpsEventRow; linkWith: (patch: Partial<Record<Param, string>>) => string }) {
  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="text-xs text-muted-foreground tabular-nums">
          #{row.id} · {when(row.createdAt)}
        </span>
        <Link href={linkWith({ type: row.type })} className="font-mono font-medium underline-offset-4 hover:underline">
          {row.type}
        </Link>
        <Badge variant="outline">{row.source}</Badge>
        {row.actor && (
          <Link href={linkWith({ actor: row.actor })} className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline">
            {row.actor}
          </Link>
        )}
        {row.orderId && (
          <Link href={linkWith({ order: row.orderId })} className="font-mono text-xs underline underline-offset-4">
            order #{row.orderId.slice(0, 8).toUpperCase()}
          </Link>
        )}
        {row.productId && (
          <Link href={linkWith({ product: row.productId })} className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline">
            product {row.productId.slice(0, 8)}
          </Link>
        )}
        {row.summary && <span className="text-muted-foreground">{row.summary}</span>}
        {row.error && <Badge variant="destructive">{row.error}</Badge>}
        {row.verified === false && <Badge variant="destructive">unverified</Badge>}
      </div>
      {row.offer && <OfferAudit offer={row.offer} />}
      {row.payload !== null && row.payload !== undefined ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Payload</summary>
          <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap break-all">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </details>
      ) : (
        row.source === "webhook" && <p className="text-xs text-muted-foreground">Payload hidden in the judge view (buyer details).</p>
      )}
    </li>
  );
}

type Audit = { decision?: string; offered?: number; agreed?: number | null; clamped?: boolean; reasons?: string[]; floorLeak?: boolean };

/** The injection beat: what the agent said, then what policy let through. */
function OfferAudit({ offer }: { offer: NonNullable<OpsEventRow["offer"]> }) {
  const audit = (offer.audit ?? {}) as Audit;
  const usd = (cents?: number | null) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "—");
  return (
    <div className="grid gap-2 rounded-md border bg-muted/40 p-2 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted-foreground">Agent&apos;s message (untrusted)</p>
        <p className="whitespace-pre-wrap break-words">{offer.message ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Policy result</p>
        <p>
          {audit.offered !== undefined && `offered ${usd(audit.offered)} → `}
          {audit.decision ?? "?"}
          {typeof audit.agreed === "number" && ` at ${usd(audit.agreed)}`}
          {audit.clamped && <Badge variant="secondary" className="ml-2">clamped</Badge>}
          {audit.floorLeak && <Badge variant="destructive" className="ml-2">floor leak caught</Badge>}
        </p>
        {audit.reasons && audit.reasons.length > 0 && <p className="text-xs text-muted-foreground">{audit.reasons.join(", ")}</p>}
      </div>
    </div>
  );
}

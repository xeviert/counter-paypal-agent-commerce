import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requireOperator } from "@/lib/auth/operator";
import { getDb } from "@/lib/db";
import { flaggedListings, REJECT_REASON_MAX, type FlaggedListing } from "@/lib/shop/ops";
import { approve, reject } from "../../actions";
import { money, when } from "../format";

export const metadata: Metadata = { title: "Flagged listings" };

export default function ListingsPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Flagged listings</h1>
        <p className="text-sm text-muted-foreground">
          The listing builder flags items that may break PayPal&apos;s acceptable use policy. They stay hidden from agents until approved here.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Listings />
      </Suspense>
    </>
  );
}

async function Listings() {
  const role = await requireOperator();
  const items = await flaggedListings(getDb());
  if (items.length === 0) return <p className="text-muted-foreground">Nothing waiting for review.</p>;
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <Item key={item.id} item={item} canAct={role === "operator"} />
      ))}
    </ul>
  );
}

function Item({ item, canAct }: { item: FlaggedListing; canAct: boolean }) {
  return (
    <li className="flex flex-col gap-4 rounded-lg border p-4 md:flex-row">
      <div className="size-32 shrink-0 overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {item.photoId && <img src={`/api/photos/${item.photoId}`} alt={item.enTitle} className="size-full object-cover" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="font-medium">{item.enTitle}</h2>
        {item.nativeTitle && item.nativeTitle !== item.enTitle && <p className="text-sm text-muted-foreground">{item.nativeTitle}</p>}
        <p className="text-sm">
          {item.sellerName} ({item.sellerCountry}) · {money(item.listPriceCents, item.currency)} · {item.stock} in stock · submitted {when(item.createdAt)}
        </p>
        <p className="line-clamp-3 text-sm text-muted-foreground">{item.description}</p>
        <p className="mt-1 rounded-md bg-destructive/10 p-2 text-sm">
          <span className="font-medium">Flag reason: </span>
          {item.reason ?? "No reason given by the listing builder."}
        </p>
      </div>
      {canAct && (
        <div className="flex w-full flex-col gap-3 md:w-72">
          <form action={approve} className="flex flex-col gap-1">
            <input type="hidden" name="productId" value={item.id} />
            <Button type="submit">Approve</Button>
            <p className="text-xs text-muted-foreground">
              {item.publishable ? "Goes live right away." : "Becomes a draft: the maker can't receive payments yet."}
            </p>
          </form>
          <form action={reject} className="flex flex-col gap-2">
            <input type="hidden" name="productId" value={item.id} />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Reason sent to the maker
              <Textarea name="reason" required maxLength={REJECT_REASON_MAX} rows={2} className="text-sm text-foreground" />
            </label>
            <Button type="submit" variant="destructive">
              Reject
            </Button>
          </form>
        </div>
      )}
    </li>
  );
}

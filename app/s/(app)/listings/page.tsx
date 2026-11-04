import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { formatMoney, translator } from "@/lib/i18n";
import { canPublish } from "@/lib/policy/seller";
import { listOpenDrafts } from "@/lib/shop/drafts";
import { listSellerProducts } from "@/lib/shop/seller-products";
import { changeNegotiation, changeStatus, changeStock } from "./actions";

export default function ListingsPage() {
  return (
    <Suspense>
      <Listings />
    </Suspense>
  );
}

async function Listings() {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  const db = getDb();
  const [items, drafts] = await Promise.all([listSellerProducts(db, seller.id), listOpenDrafts(db, seller.id)]);
  const publishable = canPublish(seller);

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("listings.title")}</h1>

      {drafts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("listings.drafts")}</h2>
          {drafts.map((d) => (
            <Link key={d.id} href={`/s/drafts/${d.id}`} className="flex items-center gap-3 rounded-lg border p-2">
              <Thumb photoId={d.photoId} />
              <span className="flex-1 truncate text-sm">{d.transcript || t(`stages.${d.stage}`)}</span>
              <span className="text-sm underline underline-offset-4">{t("listings.continueDraft")}</span>
            </Link>
          ))}
        </section>
      )}

      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("listings.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex gap-3">
                <Thumb photoId={p.photoId} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="text-sm tabular-nums">{formatMoney(p.listPrice, p.currency, seller.locale)}</span>
                  <Badge variant={p.status === "live" ? "default" : "secondary"} className="w-fit">
                    {t(`listings.status.${p.status}`)}
                  </Badge>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <form action={changeStock} className="flex items-end gap-2">
                  <input type="hidden" name="productId" value={p.id} />
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("listings.stock")}
                    <Input name="stock" inputMode="numeric" defaultValue={p.stock} className="h-9 w-20 text-base" />
                  </label>
                  <Button type="submit" variant="outline" size="lg">
                    {t("common.save")}
                  </Button>
                </form>
                <div className="ml-auto flex gap-2">
                  {p.status === "live" && (
                    <>
                      <Link href={`/p/${p.slug}`} className="self-center text-sm underline underline-offset-4">
                        {t("listings.view")}
                      </Link>
                      <StatusButton productId={p.id} action="pause" label={t("listings.pause")} />
                    </>
                  )}
                  {(p.status === "paused" || p.status === "draft") && publishable && !p.restrictedFlag && (
                    <StatusButton
                      productId={p.id}
                      action="resume"
                      label={p.status === "draft" ? t("listings.publish") : t("listings.resume")}
                    />
                  )}
                </div>
              </div>
              <form action={changeNegotiation} className="flex items-center gap-2">
                <input type="hidden" name="productId" value={p.id} />
                <input type="hidden" name="to" value={p.autoNegotiate ? "off" : "on"} />
                <p className="flex-1 text-xs text-muted-foreground">
                  {t(p.autoNegotiate ? "listings.negotiateOn" : "listings.negotiateOff")}
                </p>
                <Button type="submit" variant="outline" size="lg">
                  {t(p.autoNegotiate ? "listings.negotiateDisable" : "listings.negotiateEnable")}
                </Button>
              </form>
              {p.status === "paused" && p.restrictedFlag && (
                <p className="text-xs text-destructive">{t("listings.rejected")}</p>
              )}
              {p.reserved > 0 && <p className="text-xs text-muted-foreground">{t("listings.reserved", { count: p.reserved })}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StatusButton({ productId, action, label }: { productId: string; action: "pause" | "resume"; label: string }) {
  return (
    <form action={changeStatus}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" variant={action === "pause" ? "outline" : "default"} size="lg">
        {label}
      </Button>
    </form>
  );
}

function Thumb({ photoId }: { photoId?: string }) {
  return (
    <div className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photoId && <img src={`/api/photos/${photoId}`} alt="" className="size-full object-cover" />}
    </div>
  );
}

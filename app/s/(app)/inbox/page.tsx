import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/maker/page-loading";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { formatDateTime, translator } from "@/lib/i18n";
import { listNotifications } from "@/lib/shop/notifications";
import { MarkRead } from "./mark-read";
import { notificationText } from "./notification-text";

export default function InboxPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Inbox />
    </Suspense>
  );
}

async function Inbox() {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  const items = await listNotifications(getDb(), seller.id);
  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("notifications.title")}</h1>
      <MarkRead unread={items.some((n) => !n.readAt)} />
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("notifications.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const body = (
              <>
                <span className={n.readAt ? "" : "font-medium"}>{notificationText(n, t, seller.locale)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt, seller.locale)}</span>
              </>
            );
            return (
              <li key={n.id}>
                {n.orderId ? (
                  <Link href={`/s/orders/${n.orderId}`} className="flex flex-col gap-1 rounded-lg border p-3">
                    {body}
                  </Link>
                ) : (
                  <div className="flex flex-col gap-1 rounded-lg border p-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

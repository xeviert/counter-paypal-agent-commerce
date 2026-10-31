import { formatMoney, type Locale, type T } from "@/lib/i18n";
import type { Notification } from "@/lib/shop/notifications";

/** Stored params are raw (cents, currency); money is formatted in the maker's locale here. */
export function notificationText(n: Notification, t: T, locale: Locale): string {
  const { amountCents, currency, ...rest } = n.params;
  const amount =
    typeof amountCents === "number" && typeof currency === "string" ? formatMoney(amountCents, currency, locale) : "";
  return t(`notifications.${n.kind}`, { ...rest, amount });
}

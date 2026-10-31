import { formatMoney, type Locale, type T } from "@/lib/i18n";
import type { Notification } from "@/lib/shop/notifications";

/** Stored params are raw (cents, currency, outcome codes); they're rendered in the maker's locale here. */
export function notificationText(n: Notification, t: T, locale: Locale): string {
  const { amountCents, currency, outcome, ...rest } = n.params;
  const amount =
    typeof amountCents === "number" && typeof currency === "string" ? formatMoney(amountCents, currency, locale) : "";
  const outcomeText =
    outcome === "maker" ? t("notifications.outcomeMaker") : outcome === "buyer" ? t("notifications.outcomeBuyer") : "";
  return t(`notifications.${n.kind}`, { ...rest, amount, outcome: outcomeText });
}

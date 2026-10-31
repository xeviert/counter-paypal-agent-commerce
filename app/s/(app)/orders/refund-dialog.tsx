"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/components/i18n";
import { FormError, TextField } from "@/components/maker/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/i18n/core";
import { submitRefund, type ActionState } from "./actions";

function toCents(value: string): number | undefined {
  return /^\d{1,5}(\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : undefined;
}

/** Refunds always go through a confirm step (BUILDOUT §6.1). */
export function RefundDialog({ orderId, remainingCents, currency }: { orderId: string; remainingCents: number; currency: string }) {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState<ActionState, FormData>(submitRefund.bind(null, orderId), {});
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const cents = partial ? toCents(amount) : remainingCents;
  const valid = cents !== undefined && cents > 0 && cents <= remainingCents;

  if (state.ok && state.refundedCents) {
    return <p className="rounded-lg bg-muted p-3 text-sm">{t("orders.refund.done", { amount: money(state.refundedCents) })}</p>;
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <h2 className="font-medium">{t("orders.refund.title")}</h2>
      <FormError error={state.error} />
      <div className="flex gap-2 text-sm" role="radiogroup">
        <Button type="button" variant={partial ? "outline" : "secondary"} aria-pressed={!partial} onClick={() => setPartial(false)}>
          {t("orders.refund.full", { amount: money(remainingCents) })}
        </Button>
        <Button type="button" variant={partial ? "secondary" : "outline"} aria-pressed={partial} onClick={() => setPartial(true)}>
          {t("orders.refund.partial")}
        </Button>
      </div>
      {partial && (
        <TextField
          name="amount-input"
          label={t("orders.refund.amount")}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint={t("orders.refund.tooMuch", { amount: money(remainingCents) })}
        />
      )}
      <TextField name="reason-input" label={t("orders.refund.reason")} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Dialog>
        <DialogTrigger render={<Button type="button" variant="destructive" size="lg" className="h-11 text-base" disabled={!valid} />}>
          {t("orders.refund.title")}
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>{t("orders.refund.confirmTitle", { amount: cents ? money(cents) : "" })}</DialogTitle>
          <DialogDescription>{t("orders.refund.confirmBody")}</DialogDescription>
          <form action={action}>
            <input type="hidden" name="amount" value={partial ? amount : ""} />
            <input type="hidden" name="reason" value={reason} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>{t("common.cancel")}</DialogClose>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? t("orders.refund.sending") : t("orders.refund.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

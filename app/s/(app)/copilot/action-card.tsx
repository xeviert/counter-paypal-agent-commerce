"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/components/i18n";
import { FormError } from "@/components/maker/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatMoney, type MessageKey } from "@/lib/i18n/core";
import type { CopilotActionView } from "@/lib/schemas/copilot";
import { cancelCard, confirmCard } from "./actions";

/** A refund the copilot proposed. Nothing moves until the maker confirms here (BUILDOUT §7.1). */
export function ActionCard({ action }: { action: CopilotActionView }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState(action.status);
  const [error, setError] = useState<MessageKey>();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const amount = formatMoney(action.amountCents, action.currency, locale);

  function decide(confirm: boolean) {
    setError(undefined);
    setConfirming(confirm);
    startTransition(async () => {
      const result = await (confirm ? confirmCard : cancelCard)(action.id);
      if (result.ok) setStatus(result.status);
      else setError(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{t("copilot.card.title", { amount })}</h2>
        {status !== "proposed" && (
          <Badge variant={status === "confirmed" ? "default" : "secondary"}>{t(`copilot.card.${status}`)}</Badge>
        )}
      </div>
      <p className="text-sm">{t("copilot.card.order", { ref: action.orderRef, title: action.title })}</p>
      {action.buyerName && <p className="text-sm text-muted-foreground">{t("copilot.card.buyer", { name: action.buyerName })}</p>}
      {action.reason && <p className="text-sm text-muted-foreground">{t("copilot.card.reason", { reason: action.reason })}</p>}
      <FormError error={error} />
      {status === "proposed" && (
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger render={<Button type="button" variant="destructive" className="h-11 flex-1 text-base" disabled={pending} />}>
              {t("copilot.card.confirm")}
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>{t("copilot.card.confirmTitle", { amount })}</DialogTitle>
              <DialogDescription>{t("copilot.card.confirmBody")}</DialogDescription>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>{t("common.cancel")}</DialogClose>
                <DialogClose render={<Button type="button" variant="destructive" disabled={pending} onClick={() => decide(true)} />}>
                  {t("copilot.card.yes")}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => decide(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
      {pending && confirming && <p className="text-sm text-muted-foreground" aria-live="polite">{t("copilot.card.sending")}</p>}
    </section>
  );
}

"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/components/i18n";
import { FormError, SelectField, TextField } from "@/components/maker/field";
import { Button } from "@/components/ui/button";
import { CARRIER_LABELS, OTHER_CARRIER } from "@/lib/policy/carriers";
import { submitTracking, type ActionState } from "./actions";

export function TrackingForm({ orderId, carriers }: { orderId: string; carriers: readonly string[] }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<ActionState, FormData>(submitTracking.bind(null, orderId), {});
  const [carrier, setCarrier] = useState(carriers[0] ?? OTHER_CARRIER);
  const options = [
    ...carriers.map((c) => ({ value: c, label: CARRIER_LABELS[c] ?? c })),
    { value: OTHER_CARRIER, label: t("orders.tracking.other") },
  ];
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border p-3">
      <h2 className="font-medium">{t("orders.tracking.title")}</h2>
      <FormError error={state.error} />
      <SelectField name="carrier" label={t("orders.tracking.carrier")} value={carrier} onChange={(e) => setCarrier(e.target.value)} options={options} />
      {carrier === OTHER_CARRIER && <TextField name="carrierNameOther" label={t("orders.tracking.carrierOther")} maxLength={64} required />}
      <TextField name="trackingNumber" label={t("orders.tracking.number")} autoCapitalize="characters" autoComplete="off" maxLength={64} required />
      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        {pending ? t("orders.tracking.sending") : t("orders.tracking.submit")}
      </Button>
    </form>
  );
}

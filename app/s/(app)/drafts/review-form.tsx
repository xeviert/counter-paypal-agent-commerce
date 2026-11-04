"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/components/i18n";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/maker/field";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/i18n/core";
import { approxLocal } from "@/lib/policy/fx";
import { CATEGORIES, formatCents, WEIGHT_CLASSES, type Category, type SellerCountry, type WeightClass } from "@/lib/schemas/common";
import type { Dimensions, ListingText, PriceGuidance } from "@/lib/schemas/listing";
import { publish, type PublishState } from "./actions";

const FIELDS: { name: keyof ListingText; long?: boolean; max: number }[] = [
  { name: "title", max: 127 },
  { name: "description", long: true, max: 2000 },
  { name: "materials", max: 300 },
  { name: "care", long: true, max: 500 },
  { name: "provenance", long: true, max: 1500 },
];

/** Default floor: 85% of list (BUILDOUT §6.1). */
const FLOOR_SHARE = 0.85;

function toCents(value: string): number | undefined {
  return /^\d{1,5}(\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : undefined;
}

export type ReviewDefaults = {
  category?: Category;
  weightClass?: WeightClass;
  en?: Partial<ListingText>;
  native?: Partial<ListingText>;
  dimensions?: Partial<Dimensions>;
  listPrice?: number;
  stock: number;
};

export function ReviewForm({
  draftId,
  language,
  country,
  defaults,
  guidance,
  canGoLive,
}: {
  draftId: string;
  language: string;
  country: SellerCountry;
  defaults: ReviewDefaults;
  guidance?: PriceGuidance;
  canGoLive: boolean;
}) {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState<PublishState, FormData>(publish.bind(null, draftId), {});
  const [list, setList] = useState(defaults.listPrice ? formatCents(defaults.listPrice) : "");
  const [floor, setFloor] = useState(defaults.listPrice ? formatCents(Math.round(defaults.listPrice * FLOOR_SHARE)) : "");
  const [floorTouched, setFloorTouched] = useState(false);
  const listCents = toCents(list);
  const local = listCents ? approxLocal(listCents, country) : undefined;
  const sides = language === "en" ? (["en"] as const) : (["native", "en"] as const);
  const usd = (cents: number) => formatMoney(cents, "USD", locale);

  function onListChange(value: string) {
    setList(value);
    const cents = toCents(value);
    if (!floorTouched && cents) setFloor(formatCents(Math.round(cents * FLOOR_SHARE)));
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <FormError error={state.error} />

      {sides.map((side) => {
        const text = defaults[side];
        return (
          <fieldset key={side} className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 font-medium">{side === "en" ? t("review.english") : t("review.native")}</legend>
            {side === "en" && language !== "en" && <p className="text-xs text-muted-foreground">{t("review.englishHint")}</p>}
            {FIELDS.map(({ name, long, max }) => {
              const props = {
                name: `${side}.${name}`,
                label: t(`review.fields.${name}`),
                defaultValue: text?.[name] ?? "",
                maxLength: max,
                error: state.fields?.[`${side}.${name}`],
                required: name === "title" || name === "description",
                // The app's lang is the maker's UI locale; the text itself is in this side's language.
                lang: side === "en" ? "en" : language,
              };
              return long ? <TextAreaField key={name} rows={name === "description" ? 5 : 3} {...props} /> : <TextField key={name} {...props} />;
            })}
          </fieldset>
        );
      })}

      <fieldset className="flex flex-col gap-3">
        <SelectField
          name="category"
          label={t("review.category")}
          defaultValue={defaults.category ?? "other"}
          options={CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
          error={state.fields?.category}
        />
        <SelectField
          name="weightClass"
          label={t("review.weightClass")}
          defaultValue={defaults.weightClass ?? "medium"}
          options={WEIGHT_CLASSES.map((w) => ({ value: w, label: t(`weightClasses.${w}`) }))}
          error={state.fields?.weightClass}
        />
        <div className="grid grid-cols-3 gap-2">
          <TextField name="lengthCm" label={t("review.lengthCm")} inputMode="decimal" defaultValue={defaults.dimensions?.lengthCm ?? ""} error={state.fields?.lengthCm} />
          <TextField name="widthCm" label={t("review.widthCm")} inputMode="decimal" defaultValue={defaults.dimensions?.widthCm ?? ""} />
          <TextField name="heightCm" label={t("review.heightCm")} inputMode="decimal" defaultValue={defaults.dimensions?.heightCm ?? ""} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">{t("review.price")}</legend>
        {guidance && (
          <p className="rounded-lg bg-muted p-3 text-sm">
            {t("review.guidance", { low: usd(guidance.low), high: usd(guidance.high) })}
            <span className="block text-xs">{guidance.rationale}</span>
          </p>
        )}
        <TextField
          name="listPrice"
          label={t("review.listPrice")}
          inputMode="decimal"
          value={list}
          onChange={(e) => onListChange(e.target.value)}
          hint={local && t("review.approxLocal", { amount: formatMoney(local.cents, local.currency, locale, "code") })}
          error={state.fields?.listPrice}
          required
        />
        <TextField
          name="floorPrice"
          label={t("review.floor")}
          inputMode="decimal"
          value={floor}
          onChange={(e) => {
            setFloorTouched(true);
            setFloor(e.target.value);
          }}
          hint={t("review.floorHint")}
          error={state.fields?.floorPrice}
          required
        />
        <TextField
          name="stock"
          label={t("review.stock")}
          inputMode="numeric"
          defaultValue={String(defaults.stock)}
          error={state.fields?.stock}
          required
        />
      </fieldset>

      {!canGoLive && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">{t("review.willBeDraft")}</p>}
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending ? t("review.publishing") : t("review.publish")}
      </Button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n";
import { FormError, SelectField, TextField } from "@/components/maker/field";
import { countryName, languageName } from "@/lib/i18n/core";
import { DEFAULT_LANGUAGE, SIGNUP_COUNTRIES, SIGNUP_LANGUAGES } from "@/lib/schemas/maker";
import { signUp, type FormState } from "../auth-actions";

type Country = (typeof SIGNUP_COUNTRIES)[number];

export function SignupForm() {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(signUp, {});
  const initialCountry = (state.values?.country as Country | undefined) ?? "MX";
  const [language, setLanguage] = useState(state.values?.language ?? DEFAULT_LANGUAGE[initialCountry]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError error={state.error} />
      <TextField
        name="name"
        autoComplete="name"
        label={t("auth.name")}
        defaultValue={state.values?.name}
        error={state.fields?.name}
        required
      />
      <TextField
        name="email"
        type="email"
        autoComplete="email"
        label={t("auth.email")}
        defaultValue={state.values?.email}
        error={state.fields?.email}
        required
      />
      <TextField
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        label={t("auth.password")}
        error={state.fields?.password}
        required
      />
      <SelectField
        name="country"
        label={t("auth.country")}
        defaultValue={initialCountry}
        onChange={(e) => setLanguage(DEFAULT_LANGUAGE[e.target.value as Country])}
        options={SIGNUP_COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) }))}
        error={state.fields?.country}
      />
      <SelectField
        name="language"
        label={t("common.language")}
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        options={SIGNUP_LANGUAGES.map((l) => ({ value: l, label: languageName(l, l) }))}
        error={state.fields?.language}
      />
      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        {t("auth.createAccount")}
      </Button>
      <Link href={`/s/login?lang=${locale}`} className="text-center text-sm underline underline-offset-4">
        {t("auth.haveAccount")}
      </Link>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n";
import { FormError, TextField } from "@/components/maker/field";
import { logIn, type FormState } from "../auth-actions";

export function LoginForm() {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(logIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError error={state.error} />
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
        autoComplete="current-password"
        label={t("auth.password")}
        error={state.fields?.password}
        required
      />
      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        {t("auth.signIn")}
      </Button>
      <Link href={`/s/signup?lang=${locale}`} className="text-center text-sm underline underline-offset-4">
        {t("auth.noAccount")}
      </Link>
    </form>
  );
}

"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { createT, type Locale, type T } from "@/lib/i18n/core";
import type { Messages } from "@/lib/i18n/messages/en";

type I18n = { locale: Locale; t: T };

const I18nContext = createContext<I18n | null>(null);

/** The server passes the maker's catalog in, so client bundles never ship all four. */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createT(messages) }), [locale, messages]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = use(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

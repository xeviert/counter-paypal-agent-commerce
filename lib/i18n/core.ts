import type { Messages } from "./messages/en";

// Client-safe: no catalogs imported here. Server code gets a catalog from ./index; client components
// receive the maker's catalog through components/i18n.tsx.

export const UI_LOCALES = ["en", "es", "fil", "sw"] as const;
export type Locale = (typeof UI_LOCALES)[number];

/** BCP 47 tags for `Intl` and Web Speech. The region matches where our makers are. */
export const LOCALE_TAGS: Record<Locale, string> = { en: "en-US", es: "es-MX", fil: "fil-PH", sw: "sw-KE" };

/** Maker languages without a UI catalog (e.g. `hi`) fall back to English. */
export function uiLocale(language: string | null | undefined): Locale {
  return (UI_LOCALES as readonly string[]).includes(language ?? "") ? (language as Locale) : "en";
}

/** Before sign-in there's no maker profile: `?lang=` wins, then the browser's Accept-Language. */
export function pickLocale(requested: string | undefined, acceptLanguage: string | null): Locale {
  if (requested && (UI_LOCALES as readonly string[]).includes(requested)) return requested as Locale;
  const tags = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";")[0]!.trim().toLowerCase().split("-")[0]!);
  // Browsers report Filipino as `fil` or the older `tl`.
  const found = tags.map((tag) => (tag === "tl" ? "fil" : tag)).find((tag) => (UI_LOCALES as readonly string[]).includes(tag));
  return (found as Locale | undefined) ?? "en";
}

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;
export type Params = Record<string, string | number>;
export type T = (key: MessageKey, params?: Params) => string;

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** `{name}` placeholders are filled from `params`; unknown placeholders are left as written. */
export function createT(messages: Messages): T {
  return (key, params) => {
    const template = lookup(messages, key) ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  };
}

/** `code` for amounts next to another currency: es-MX writes MXN as a bare "$". */
export function formatMoney(cents: number, currency: string, locale: Locale, display: "symbol" | "code" = "symbol"): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], { style: "currency", currency, currencyDisplay: display }).format(
    cents / 100,
  );
}

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { dateStyle: "medium" }).format(date);
}

export function formatDateTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function countryName(code: string, locale: Locale): string {
  return new Intl.DisplayNames([LOCALE_TAGS[locale]], { type: "region" }).of(code) ?? code;
}

export function languageName(code: string, locale: Locale): string {
  return new Intl.DisplayNames([LOCALE_TAGS[locale]], { type: "language" }).of(code) ?? code;
}

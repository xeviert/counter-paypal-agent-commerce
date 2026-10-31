import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { I18nProvider } from "@/components/i18n";
import { languageName, messagesFor, pickLocale, translator, UI_LOCALES, type Locale, type T } from "@/lib/i18n";

/** Sign-in and sign-up, before there's a maker profile to take the language from. */
export async function PublicShell({
  searchParams,
  path,
  children,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  path: string;
  children: (ctx: { locale: Locale; t: T }) => ReactNode;
}) {
  const { lang } = await searchParams;
  const locale = pickLocale(typeof lang === "string" ? lang : undefined, (await headers()).get("accept-language"));
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <div lang={locale} className="flex flex-1 flex-col gap-6">
        <nav aria-label={translator(locale)("common.language")} className="flex flex-wrap gap-3 text-sm">
          {UI_LOCALES.map((code) => (
            <Link
              key={code}
              href={`${path}?lang=${code}`}
              aria-current={code === locale ? "true" : undefined}
              className="text-muted-foreground underline-offset-4 hover:underline aria-[current]:font-medium aria-[current]:text-foreground"
            >
              {languageName(code, code)}
            </Link>
          ))}
        </nav>
        {children({ locale, t: translator(locale) })}
      </div>
    </I18nProvider>
  );
}

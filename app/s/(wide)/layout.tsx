import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { I18nProvider } from "@/components/i18n";
import { requireSeller } from "@/lib/auth/seller";
import { messagesFor, translator } from "@/lib/i18n";

// Maker screens that need the whole width (the AG Studio dashboard). Same session and language as
// the phone app in (app), without its 448px column and bottom nav.

export const metadata: Metadata = {
  title: "Counter for makers",
  robots: { index: false },
};

export default function WideLayout({ children }: LayoutProps<"/s">) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <WideShell>{children}</WideShell>
    </Suspense>
  );
}

async function WideShell({ children }: { children: React.ReactNode }) {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  return (
    <I18nProvider locale={seller.locale} messages={messagesFor(seller.locale)}>
      <div lang={seller.locale} className="flex min-h-dvh flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <Link href="/s" className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline">
            <ArrowLeftIcon className="size-4" aria-hidden />
            {t("dashboard.back")}
          </Link>
          <span className="text-sm font-medium text-muted-foreground">Counter · {seller.name}</span>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </I18nProvider>
  );
}

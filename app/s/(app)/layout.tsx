import type { Metadata } from "next";
import { Suspense } from "react";
import { I18nProvider } from "@/components/i18n";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { messagesFor, translator } from "@/lib/i18n";
import { unreadCount } from "@/lib/shop/notifications";
import { logOut } from "../auth-actions";
import { BottomNav } from "./bottom-nav";

export const metadata: Metadata = {
  title: "Counter for makers",
  robots: { index: false },
  appleWebApp: { capable: true, title: "Counter", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export default function MakerLayout({ children }: LayoutProps<"/s">) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <MakerShell>{children}</MakerShell>
    </Suspense>
  );
}

async function MakerShell({ children }: { children: React.ReactNode }) {
  const seller = await requireSeller();
  const t = translator(seller.locale);
  const unread = await unreadCount(getDb(), seller.id);
  return (
    <I18nProvider locale={seller.locale} messages={messagesFor(seller.locale)}>
      <div lang={seller.locale} className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <header className="flex items-center justify-between px-4 pt-4">
          <span className="text-sm font-medium text-muted-foreground">Counter · {seller.name}</span>
          <form action={logOut}>
            <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              {t("common.signOut")}
            </button>
          </form>
        </header>
        <main className="flex flex-1 flex-col gap-6 p-4 pb-24">{children}</main>
        <BottomNav unread={unread} />
      </div>
    </I18nProvider>
  );
}

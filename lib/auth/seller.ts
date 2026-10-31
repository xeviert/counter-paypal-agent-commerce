import { eq, getTableColumns } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { sellers } from "@/lib/db/schema";
import { uiLocale, type Locale } from "@/lib/i18n";
import { getSessionSellerId } from "./session";

// Data access layer for the maker app. Every /s query and server action gets the seller from here,
// never a seller id from a form, URL or model (BUILDOUT §6.1, ARCHITECTURE §9).

export type SessionSeller = Omit<typeof sellers.$inferSelect, "passwordHash"> & { locale: Locale };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { passwordHash, ...sessionColumns } = getTableColumns(sellers);

/** Per request: pages, layouts and actions in one render share the lookup. */
export const currentSeller = cache(async (): Promise<SessionSeller | undefined> => {
  const sellerId = await getSessionSellerId();
  if (!sellerId) return undefined;
  const [row] = await getDb().select(sessionColumns).from(sellers).where(eq(sellers.id, sellerId));
  return row && { ...row, locale: uiLocale(row.language) };
});

export async function requireSeller(): Promise<SessionSeller> {
  const seller = await currentSeller();
  if (!seller) redirect("/s/login");
  return seller;
}

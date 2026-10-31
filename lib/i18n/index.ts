import { createT, type Locale, type T } from "./core";
import { en, type Messages } from "./messages/en";
import { es } from "./messages/es";
import { fil } from "./messages/fil";
import { sw } from "./messages/sw";

// Maker UI strings (BUILDOUT §6.1). `en` is the source; the other catalogs are typed against it, so a
// missing key fails typecheck. The locale comes from `sellers.language`, never from the URL.

export * from "./core";
export type { Messages };

const CATALOGS: Record<Locale, Messages> = { en, es, fil, sw };

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale];
}

export function translator(locale: Locale): T {
  return createT(CATALOGS[locale]);
}

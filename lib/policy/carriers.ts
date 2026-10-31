import type { SellerCountry } from "@/lib/schemas/common";

// PayPal tracking carrier enum values, checked Oct 31 against
// developer.paypal.com/docs/tracking/reference/carriers. Anything else goes as OTHER + a name.

const INTERNATIONAL = ["DHL", "FEDEX", "UPS"] as const;

export const CARRIERS: Record<SellerCountry, readonly string[]> = {
  MX: ["CORREOS_DE_MEXICO", "MEX_ESTAFETA", "PAQUETEXPRESS", "MEX_REDPACK", ...INTERNATIONAL],
  PH: ["PHILIPPINE_POST", "JTEXPRESS_PH", "TWO_GO", "PHL_JAMEXPRESS", "SPX_PH", ...INTERNATIONAL],
  // No Kenyan couriers besides the post office are in PayPal's list (G4S, Wells Fargo → OTHER).
  KE: ["KENYA_POST", ...INTERNATIONAL],
  IN: [...INTERNATIONAL],
};

export const CARRIER_LABELS: Record<string, string> = {
  CORREOS_DE_MEXICO: "Correos de México",
  MEX_ESTAFETA: "Estafeta",
  PAQUETEXPRESS: "Paquetexpress",
  MEX_REDPACK: "Redpack",
  PHILIPPINE_POST: "PHLPost",
  JTEXPRESS_PH: "J&T Express",
  TWO_GO: "2GO",
  PHL_JAMEXPRESS: "JAM Express",
  SPX_PH: "SPX Express",
  KENYA_POST: "Posta Kenya",
  DHL: "DHL",
  FEDEX: "FedEx",
  UPS: "UPS",
};

export const OTHER_CARRIER = "OTHER";

export function isKnownCarrier(country: SellerCountry, carrier: string): boolean {
  return carrier === OTHER_CARRIER || CARRIERS[country].includes(carrier);
}

/** Label for the maker app and agents; OTHER shows the maker's own carrier name. */
export function carrierLabel(carrier: string, carrierNameOther?: string | null): string {
  return carrier === OTHER_CARRIER ? (carrierNameOther ?? carrier) : (CARRIER_LABELS[carrier] ?? carrier);
}

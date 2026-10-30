/**
 * Counter's fee on `item_total` only, never shipping (BUILDOUT §5.1). Round half-up to the cent.
 * Integer math so no float ever touches money.
 */
export function platformFeeCents(itemCents: number, feeBps: number): number {
  if (!Number.isSafeInteger(itemCents) || itemCents < 0) throw new Error(`invalid item cents: ${itemCents}`);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error(`invalid fee bps: ${feeBps}`);
  return Math.floor((itemCents * feeBps + 5_000) / 10_000);
}

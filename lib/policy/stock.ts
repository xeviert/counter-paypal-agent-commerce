import { and, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { products } from "@/lib/db/schema";

// Each is one conditional UPDATE, so concurrent checkouts can't oversell: Postgres re-checks the
// WHERE clause against the latest row after waiting on another writer's lock.

function assertUnits(n: number) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid quantity: ${n}`);
}

/** False when fewer than `n` units are free. Doesn't check `status`; callers report unavailable products separately. */
export async function reserveStock(tx: Tx, productId: string, n: number): Promise<boolean> {
  assertUnits(n);
  const rows = await tx
    .update(products)
    .set({ reserved: sql`${products.reserved} + ${n}` })
    .where(and(eq(products.id, productId), sql`${products.stock} - ${products.reserved} >= ${n}`))
    .returning({ id: products.id });
  return rows.length === 1;
}

/** Checkout ended unpaid: free the units again. */
export async function releaseStock(tx: Tx, productId: string, n: number): Promise<void> {
  assertUnits(n);
  const rows = await tx
    .update(products)
    .set({ reserved: sql`${products.reserved} - ${n}` })
    .where(and(eq(products.id, productId), gte(products.reserved, n)))
    .returning({ id: products.id });
  if (rows.length !== 1) throw new Error(`product ${productId} has fewer than ${n} reserved units to release`);
}

/** Payment captured: the reserved units are sold. */
export async function commitStock(tx: Tx, productId: string, n: number): Promise<void> {
  assertUnits(n);
  const rows = await tx
    .update(products)
    .set({ stock: sql`${products.stock} - ${n}`, reserved: sql`${products.reserved} - ${n}` })
    .where(and(eq(products.id, productId), gte(products.reserved, n)))
    .returning({ id: products.id });
  if (rows.length !== 1) throw new Error(`product ${productId} has fewer than ${n} reserved units to commit`);
}

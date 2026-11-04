import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { idempotencyKeys } from "@/lib/db/schema";

// `Idempotency-Key` replay store for ACP POSTs (BUILDOUT §7.6). The key is inserted before the work,
// so a retry while the first request runs sees a row with no response yet.

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export type Claim =
  | { kind: "new" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_flight" }
  | { kind: "conflict" };

export const requestHash = (body: string) => createHash("sha256").update(body).digest("base64url");

export async function claimKey(db: Tx, scope: string, key: string, hash: string, now = new Date()): Promise<Claim> {
  // An expired key the sweep hasn't purged yet starts over.
  await db
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), lt(idempotencyKeys.createdAt, cutoff(now))));
  const inserted = await db
    .insert(idempotencyKeys)
    .values({ scope, key, requestHash: hash })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length > 0) return { kind: "new" };
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  if (!row) return claimKey(db, scope, key, hash, now);
  if (row.requestHash !== hash) return { kind: "conflict" };
  if (row.responseStatus === null) return { kind: "in_flight" };
  return { kind: "replay", status: row.responseStatus, body: row.responseBody };
}

export async function storeResponse(db: Tx, scope: string, key: string, status: number, body: unknown) {
  await db
    .update(idempotencyKeys)
    .set({ responseStatus: status, responseBody: body })
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
}

/** A server failure isn't an answer: the client may retry with the same key. */
export async function releaseKey(db: Tx, scope: string, key: string) {
  await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
}

const cutoff = (now: Date) => new Date(now.getTime() - IDEMPOTENCY_TTL_MS);

export async function purgeIdempotencyKeys(db: Tx, now = new Date()): Promise<number> {
  const purged = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff(now))).returning({ key: idempotencyKeys.key });
  return purged.length;
}

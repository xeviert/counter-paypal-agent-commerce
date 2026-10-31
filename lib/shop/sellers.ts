import { and, asc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { events, sellers } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { SignupInput } from "@/lib/schemas/maker";

// Maker accounts. Seeded and script-onboarded makers have no email; they sign in through the demo
// picker when DEMO_LOGIN is on (BUILDOUT §10 #1).

export async function createSellerAccount(
  db: Tx,
  input: SignupInput,
): Promise<{ ok: true; sellerId: string } | { ok: false; error: "email_taken" }> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(sellers)
      .values({
        name: input.name,
        email: input.email,
        passwordHash,
        country: input.country,
        language: input.language,
      })
      .onConflictDoNothing({ target: sellers.email })
      .returning({ id: sellers.id });
    if (!created) return { ok: false, error: "email_taken" };
    await tx.insert(events).values({
      type: "seller.signed_up",
      source: "web",
      actor: created.id,
      sellerId: created.id,
      payload: { country: input.country, language: input.language },
    });
    return { ok: true, sellerId: created.id };
  });
}

// Compared against when the email is unknown, so both paths cost one scrypt.
const DUMMY_HASH = hashPassword("counter-dummy-password");

/** The seller id for a matching email + password. */
export async function authenticate(db: Tx, email: string, password: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: sellers.id, passwordHash: sellers.passwordHash })
    .from(sellers)
    .where(eq(sellers.email, email));
  const ok = await verifyPassword(password, row?.passwordHash ?? (await DUMMY_HASH));
  return ok && row?.passwordHash ? row.id : undefined;
}

/** Makers without a login (seeded personas). Only listed when DEMO_LOGIN is on. */
export async function listDemoSellers(db: Tx) {
  return db
    .select({ id: sellers.id, name: sellers.name, locality: sellers.locality, country: sellers.country, language: sellers.language })
    .from(sellers)
    .where(isNull(sellers.email))
    .orderBy(asc(sellers.createdAt));
}

export async function isDemoSeller(db: Tx, sellerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sellers.id })
    .from(sellers)
    .where(and(eq(sellers.id, sellerId), isNull(sellers.email)));
  return row !== undefined;
}

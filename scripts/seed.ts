// Seeds the demo makers and their products (BUILDOUT §5.7). Idempotent: re-run after onboarding.
// Usage: pnpm seed [--persona MX] [--photos-only]
//
// Order of operations for a fresh database:
//   1. pnpm seed                                  → makers + draft products (not receivable yet)
//   2. pnpm onboard --seller <id>                 → per maker, approve in the browser (PH: add --merchant-id)
//   3. pnpm seed                                  → products go live for receivable makers
//
// Products are published only when the maker can be paid (§6.1). Re-seeding updates listing text and
// prices but leaves stock, reservations and PayPal fields alone. Photos in seed/photos/<slug>/ replace
// the product's photos when present.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { eq, sql } = await import("drizzle-orm");
const { getDb } = await import("@/lib/db");
const { events, photos, products, sellers } = await import("@/lib/db/schema");
const { savePhoto } = await import("@/lib/photos");
const { canPublish } = await import("@/lib/policy/seller");
const { PERSONAS, floorFor } = await import("@/seed/catalog");

const PHOTO_DIR = "seed/photos";
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif|avif)$/i;

const { values } = parseArgs({
  options: {
    persona: { type: "string" },
    "photos-only": { type: "boolean", default: false },
  },
});

const personas = values.persona
  ? PERSONAS.filter((p) => p.country === values.persona!.toUpperCase())
  : PERSONAS;
if (personas.length === 0) throw new Error(`no persona for ${values.persona}`);

const db = getDb();
const summary: Record<string, { live: number; draft: number; photos: number }> = {};

function photoFiles(slug: string): string[] {
  const dir = join(PHOTO_DIR, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => PHOTO_EXT.test(file))
    .sort()
    .map((file) => join(dir, file));
}

try {
  for (const persona of personas) {
    await db
      .insert(sellers)
      .values({
        id: persona.id,
        name: persona.name,
        country: persona.country,
        language: persona.language,
        locality: persona.locality,
      })
      .onConflictDoUpdate({
        target: sellers.id,
        set: { name: persona.name, language: persona.language, locality: persona.locality },
      });
    const [seller] = await db.select().from(sellers).where(eq(sellers.id, persona.id));
    const publishable = canPublish(seller!);
    const counts = { live: 0, draft: 0, photos: 0 };

    for (const p of persona.products) {
      let productId: string;
      if (values["photos-only"]) {
        const [found] = await db.select({ id: products.id }).from(products).where(eq(products.slug, p.slug));
        if (!found) continue;
        productId = found.id;
      } else {
        const status = publishable ? "live" : "draft";
        const content = {
          category: p.category,
          weightClass: p.weightClass,
          listing: p.listing,
          listPrice: p.listPrice,
          floorPrice: floorFor(p),
          status,
          // Keeps the first publish date across re-seeds.
          publishedAt: publishable ? sql`coalesce(${products.publishedAt}, now())` : null,
        } as const;
        const [row] = await db
          .insert(products)
          .values({
            ...content,
            sellerId: persona.id,
            slug: p.slug,
            stock: p.stock,
            publishedAt: publishable ? new Date() : null,
          })
          .onConflictDoUpdate({ target: products.slug, set: content })
          .returning({ id: products.id, sellerId: products.sellerId });
        if (row!.sellerId !== persona.id) throw new Error(`slug ${p.slug} belongs to another seller`);
        productId = row!.id;
        counts[status]++;
      }

      const files = photoFiles(p.slug);
      if (files.length > 0) {
        await db.transaction(async (tx) => {
          await tx.delete(photos).where(eq(photos.productId, productId));
          for (const [position, file] of files.entries()) {
            await savePhoto(tx, { sellerId: persona.id, productId, position, input: readFileSync(file) });
          }
        });
        counts.photos += files.length;
      }
    }

    summary[persona.country] = counts;
    console.log(
      `${persona.country} ${persona.name} (${persona.id}): ${counts.live} live, ${counts.draft} draft, ${counts.photos} photos`,
    );
    if (!publishable && !values["photos-only"]) {
      const extra = persona.sandboxMerchantId ? ` --merchant-id ${persona.sandboxMerchantId}` : "";
      console.log(`  not receivable yet: pnpm onboard --seller ${persona.id}${extra}, then re-run pnpm seed`);
    }
  }

  const missing = personas.flatMap((p) => p.products).filter((p) => photoFiles(p.slug).length === 0);
  if (missing.length > 0) console.log(`\n${missing.length} products have no photos in ${PHOTO_DIR}/<slug>/`);

  await db.insert(events).values({ type: "seed.run", source: "script", actor: "system", payload: summary });
} finally {
  await db.$client.end();
}

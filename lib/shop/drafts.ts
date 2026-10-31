import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drafts, events, photos, products, voiceNotes } from "@/lib/db/schema";
import { processPhoto } from "@/lib/photos";
import { canPublish } from "@/lib/policy/seller";
import type { DraftStage } from "@/lib/schemas/common";
import { uuid } from "@/lib/schemas/common";
import type { ListingDraft } from "@/lib/schemas/listing";

// Maker listing drafts (BUILDOUT §6.1 capture + review). Every function takes the session seller id
// and only touches that maker's rows. `products` is written once, on publish.

export const MAX_DRAFT_PHOTOS = 4;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_TRANSCRIPT = 5000;

/** Stages where the maker may still change photos, voice or text. */
const EDITABLE: readonly DraftStage[] = ["capturing", "ready", "failed"];

export type Draft = typeof drafts.$inferSelect;
export type DraftPhoto = { id: string; position: number };

/** `code` doubles as the i18n key the maker sees. */
export class DraftError extends Error {
  readonly code: "capture.maxPhotos" | "capture.needPhoto" | "capture.needWords" | "errors.notFound" | "review.needPhoto";

  constructor(code: DraftError["code"]) {
    super(code);
    this.name = "DraftError";
    this.code = code;
  }
}

async function ownedDraft(tx: Tx, sellerId: string, draftId: string, lock = false): Promise<Draft> {
  if (!uuid.safeParse(draftId).success) throw new DraftError("errors.notFound");
  const query = tx
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.sellerId, sellerId)));
  const [draft] = lock ? await query.for("update") : await query;
  if (!draft) throw new DraftError("errors.notFound");
  return draft;
}

async function editableDraft(tx: Tx, sellerId: string, draftId: string | undefined): Promise<Draft> {
  if (!draftId) {
    const [created] = await tx.insert(drafts).values({ sellerId }).returning();
    return created!;
  }
  const draft = await ownedDraft(tx, sellerId, draftId, true);
  if (!EDITABLE.includes(draft.stage)) throw new DraftError("errors.notFound");
  return draft;
}

export async function getSellerDraft(
  db: Tx,
  sellerId: string,
  draftId: string,
): Promise<{ draft: Draft; photos: DraftPhoto[] } | undefined> {
  try {
    const draft = await ownedDraft(db, sellerId, draftId);
    return { draft, photos: await draftPhotos(db, draft.id) };
  } catch (err) {
    if (err instanceof DraftError) return undefined;
    throw err;
  }
}

async function draftPhotos(db: Tx, draftId: string): Promise<DraftPhoto[]> {
  return db
    .select({ id: photos.id, position: photos.position })
    .from(photos)
    .where(eq(photos.draftId, draftId))
    .orderBy(asc(photos.position), asc(photos.createdAt));
}

export async function listOpenDrafts(db: Tx, sellerId: string) {
  const rows = await db
    .select({ id: drafts.id, stage: drafts.stage, transcript: drafts.transcript, updatedAt: drafts.updatedAt })
    .from(drafts)
    .where(and(eq(drafts.sellerId, sellerId), ne(drafts.stage, "published")))
    .orderBy(desc(drafts.updatedAt))
    .limit(20);
  const firstPhotos = rows.length
    ? await db
        .selectDistinctOn([photos.draftId], { draftId: photos.draftId, id: photos.id })
        .from(photos)
        .where(inArray(photos.draftId, rows.map((r) => r.id)))
        .orderBy(photos.draftId, asc(photos.position))
    : [];
  const photoByDraft = new Map(firstPhotos.map((p) => [p.draftId, p.id]));
  return rows.map((r) => ({ ...r, photoId: photoByDraft.get(r.id) }));
}

/** Creates the draft on the first upload. Returns the draft id so the client can keep using it. */
export async function addDraftPhoto(
  db: Tx,
  sellerId: string,
  draftId: string | undefined,
  input: Buffer,
): Promise<{ draftId: string; photo: DraftPhoto }> {
  // Resize and strip EXIF before taking any lock.
  const processed = await processPhoto(input);
  return db.transaction(async (tx) => {
    const draft = await editableDraft(tx, sellerId, draftId);
    const [stats] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number), last: max(photos.position) })
      .from(photos)
      .where(eq(photos.draftId, draft.id));
    if ((stats?.n ?? 0) >= MAX_DRAFT_PHOTOS) throw new DraftError("capture.maxPhotos");
    const position = (stats?.last ?? -1) + 1;
    const [photo] = await tx
      .insert(photos)
      .values({ sellerId, draftId: draft.id, position, ...processed })
      .returning({ id: photos.id, position: photos.position });
    await tx.update(drafts).set({ updatedAt: new Date() }).where(eq(drafts.id, draft.id));
    return { draftId: draft.id, photo: photo! };
  });
}

export async function removeDraftPhoto(db: Tx, sellerId: string, draftId: string, photoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await editableDraft(tx, sellerId, draftId);
    if (!uuid.safeParse(photoId).success) return;
    await tx
      .delete(photos)
      .where(and(eq(photos.id, photoId), eq(photos.draftId, draft.id), eq(photos.sellerId, sellerId), isNull(photos.productId)));
  });
}

/** Swaps the photo with the one before it. The first photo is the listing's cover. */
export async function movePhotoEarlier(db: Tx, sellerId: string, draftId: string, photoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await editableDraft(tx, sellerId, draftId);
    const list = await draftPhotos(tx, draft.id);
    const i = list.findIndex((p) => p.id === photoId);
    if (i <= 0) return;
    const order = list.map((p) => p.id);
    [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
    for (const [position, id] of order.entries()) {
      await tx.update(photos).set({ position }).where(eq(photos.id, id));
    }
  });
}

export async function saveVoiceNote(
  db: Tx,
  sellerId: string,
  draftId: string | undefined,
  note: { mime: string; bytes: Buffer; durationMs?: number },
): Promise<{ draftId: string }> {
  if (note.bytes.byteLength === 0 || note.bytes.byteLength > MAX_VOICE_BYTES) throw new DraftError("capture.needWords");
  if (!/^audio\/[\w.+-]+(;.*)?$/.test(note.mime)) throw new DraftError("capture.needWords");
  return db.transaction(async (tx) => {
    const draft = await editableDraft(tx, sellerId, draftId);
    const [row] = await tx
      .insert(voiceNotes)
      .values({ sellerId, mime: note.mime, bytes: note.bytes, durationMs: note.durationMs })
      .returning({ id: voiceNotes.id });
    await tx.update(drafts).set({ voiceNoteId: row!.id }).where(eq(drafts.id, draft.id));
    return { draftId: draft.id };
  });
}

/**
 * Capture done. Until the listing pipeline (§6.2) lands, the draft goes straight to `ready` and the
 * review form starts from the transcript.
 */
export async function submitCapture(db: Tx, sellerId: string, draftId: string, transcript: string): Promise<Draft> {
  return db.transaction(async (tx) => {
    const draft = await editableDraft(tx, sellerId, draftId);
    const text = transcript.trim().slice(0, MAX_TRANSCRIPT);
    if ((await draftPhotos(tx, draft.id)).length === 0) throw new DraftError("capture.needPhoto");
    if (!text && !draft.voiceNoteId) throw new DraftError("capture.needWords");
    const [updated] = await tx
      .update(drafts)
      .set({ transcript: text || null, stage: "ready" })
      .where(eq(drafts.id, draft.id))
      .returning();
    return updated!;
  });
}

const SLUG_MAX = 80;

/** "Tapete de lana, tintes naturales" → "tapete-de-lana-tintes-naturales-k3x9". The suffix keeps slugs unique. */
export function makeSlug(title: string, suffix = randomBytes(3).toString("hex").slice(0, 4)): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX - suffix.length - 1)
    .replace(/-+$/, "");
  return base ? `${base}-${suffix}` : `item-${suffix}`;
}

export type PublishInput = {
  draft: ListingDraft;
  listPrice: number;
  floorPrice: number;
  stock: number;
};

/** Agents may bargain down to the floor, so the discount cap is just the floor expressed as bps. */
export function maxDiscountBps(listPrice: number, floorPrice: number): number {
  return Math.floor(((listPrice - floorPrice) * 10_000) / listPrice);
}

export type PublishedProduct = { id: string; slug: string; status: "draft" | "review" | "live" };

/**
 * Draft → `products`. Live only when the maker can be paid; a possible AUP match goes to operator
 * review instead (§6.2). Amounts are validated by the caller (lib/schemas/maker.ts `reviewInput`).
 */
export async function publishDraft(
  db: Tx,
  seller: Parameters<typeof canPublish>[0] & { id: string },
  draftId: string,
  input: PublishInput,
): Promise<PublishedProduct> {
  return db.transaction(async (tx) => {
    const draft = await ownedDraft(tx, seller.id, draftId, true);
    if (!EDITABLE.includes(draft.stage)) throw new DraftError("errors.notFound");
    if ((await draftPhotos(tx, draft.id)).length === 0) throw new DraftError("review.needPhoto");

    const restricted = draft.result?.restricted?.flag ?? false;
    const status = restricted ? "review" : canPublish(seller) ? "live" : "draft";
    const [product] = await tx
      .insert(products)
      .values({
        sellerId: seller.id,
        slug: makeSlug(input.draft.listing.en.title),
        status,
        category: input.draft.category,
        weightClass: input.draft.weightClass,
        listing: input.draft.listing,
        listPrice: input.listPrice,
        floorPrice: input.floorPrice,
        maxDiscountBps: maxDiscountBps(input.listPrice, input.floorPrice),
        stock: input.stock,
        priceGuidance: draft.result?.priceGuidance ?? null,
        restrictedFlag: restricted,
        publishedAt: status === "live" ? new Date() : null,
      })
      .returning({ id: products.id, slug: products.slug });
    await tx.update(photos).set({ productId: product!.id }).where(eq(photos.draftId, draft.id));
    await tx.update(drafts).set({ stage: "published", productId: product!.id }).where(eq(drafts.id, draft.id));
    await tx.insert(events).values({
      type: "product.published",
      source: "web",
      actor: seller.id,
      sellerId: seller.id,
      productId: product!.id,
      payload: { draftId: draft.id, status, listPrice: input.listPrice, floorPrice: input.floorPrice, stock: input.stock },
    });
    return { id: product!.id, slug: product!.slug, status };
  });
}

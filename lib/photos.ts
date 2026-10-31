import sharp from "sharp";
import type { Tx } from "@/lib/db";
import { photos } from "@/lib/db/schema";

// One pipeline for seed photos (P1) and maker uploads (P2), BUILDOUT §6.1: longest side 1280px,
// WebP, all metadata dropped. EXIF GPS would reveal where the maker lives.

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1280;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class UnsupportedPhotoError extends Error {
  constructor(format: string | undefined) {
    super(`unsupported photo format: ${format ?? "unknown"}`);
    this.name = "UnsupportedPhotoError";
  }
}

export type ProcessedPhoto = { bytes: Buffer; mime: "image/webp"; width: number; height: number };

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  if (input.byteLength > MAX_PHOTO_BYTES) throw new Error(`photo is over ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
  // Maker uploads are canvas-resized JPEGs (iOS can't encode WebP; sharp's prebuilt binary can't read
  // HEIC). Refusing other formats also keeps SVG and friends away from libvips.
  const { format } = await sharp(input).metadata();
  if (!format || !ALLOWED_FORMATS.has(format)) throw new UnsupportedPhotoError(format);
  // `rotate()` bakes the EXIF orientation into the pixels before the metadata is dropped.
  // sharp writes no metadata unless asked (`keepMetadata`/`withExif`), so EXIF, XMP and ICC are gone.
  const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, mime: "image/webp", width: info.width, height: info.height };
}

export async function savePhoto(
  db: Tx,
  photo: { sellerId: string; productId?: string; position: number; input: Buffer },
): Promise<string> {
  const processed = await processPhoto(photo.input);
  const [row] = await db
    .insert(photos)
    .values({
      sellerId: photo.sellerId,
      productId: photo.productId,
      position: photo.position,
      mime: processed.mime,
      width: processed.width,
      height: processed.height,
      bytes: processed.bytes,
    })
    .returning({ id: photos.id });
  return row!.id;
}

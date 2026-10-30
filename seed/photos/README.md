# Seed photos

One folder per product slug from `seed/catalog.ts`, e.g. `seed/photos/zapotec-fret-rug/1.jpg`.
Files are used in name order (first = cover). JPEG, PNG, WebP, HEIC or AVIF, up to 5 MB each.

`pnpm seed` runs every file through `lib/photos.ts` (EXIF/GPS stripped, longest side 1280px, WebP) and
replaces the product's photos. `pnpm seed --photos-only` refreshes photos without touching listings.

Only add photos we own or have a license for, and note the source below.

| Slug | Source / license |
|---|---|

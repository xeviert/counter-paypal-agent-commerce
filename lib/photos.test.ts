import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, processPhoto, UnsupportedPhotoError } from "./photos";

/** A JPEG with GPS EXIF and a 90° orientation flag, the way a phone camera writes it. */
async function phoneJpeg(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .withExif({
      IFD0: { Make: "Phone", Model: "Camera" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "17/1 2/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "96/1 43/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

describe("processPhoto", () => {
  it("strips EXIF (incl. GPS) and outputs WebP", async () => {
    const input = await phoneJpeg(400, 300);
    expect(await sharp(input).metadata()).toMatchObject({ orientation: 6, exif: expect.any(Buffer) });
    const out = await processPhoto(input);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.bytes.includes(Buffer.from("Phone"))).toBe(false);
  });

  it("applies the orientation flag before dropping it", async () => {
    const out = await processPhoto(await phoneJpeg(400, 300));
    expect({ width: out.width, height: out.height }).toEqual({ width: 300, height: 400 });
  });

  it("fits the longest side into 1280px and never enlarges", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    expect(await processPhoto(big)).toMatchObject({ width: 1280, height: 960, mime: "image/webp" });
    const small = await phoneJpeg(200, 100);
    expect(await processPhoto(small)).toMatchObject({ width: 100, height: 200 });
  });

  it("rejects files over 5 MB and non-images", async () => {
    await expect(processPhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1))).rejects.toThrow(/over 5 MB/);
    await expect(processPhoto(Buffer.from("not an image"))).rejects.toThrow();
  });

  it("only accepts JPEG, PNG and WebP", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    await expect(processPhoto(svg)).rejects.toBeInstanceOf(UnsupportedPhotoError);
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer();
    await expect(processPhoto(gif)).rejects.toThrow(/unsupported photo format: gif/);
  });
});

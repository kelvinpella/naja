import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { downscaleToWebSize, WEB_IMAGE_MAX_DIMENSION } from "../../src/services/jobs/job-image-storage.js";

async function photo(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<Uint8Array> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  });
  const buffer =
    format === "png" ? await image.png().toBuffer() : await image.jpeg().toBuffer();
  return new Uint8Array(buffer);
}

describe("downscaleToWebSize", () => {
  it("shrinks a phone-size photo to card size", async () => {
    const big = await photo(3000, 4000);
    const small = await downscaleToWebSize(big, "image/jpeg");

    const meta = await sharp(small).metadata();
    assert.ok((meta.width ?? 9999) <= WEB_IMAGE_MAX_DIMENSION);
    assert.ok((meta.height ?? 9999) <= WEB_IMAGE_MAX_DIMENSION);
    assert.ok(small.length < big.length);
  });

  it("leaves small images untouched", async () => {
    const tiny = await photo(400, 300);
    const out = await downscaleToWebSize(tiny, "image/jpeg");

    const meta = await sharp(out).metadata();
    assert.equal(meta.width, 400);
  });

  it("keeps PNGs as PNG", async () => {
    const big = await photo(3000, 2000, "png");
    const out = await downscaleToWebSize(big, "image/png");

    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "png");
    assert.ok((meta.width ?? 9999) <= WEB_IMAGE_MAX_DIMENSION);
  });
});

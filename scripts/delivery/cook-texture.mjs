// Delivery cooking of a standalone runtime texture (the cave limestone and pigment layers).
//
// - Opaque PNG (only RGB is sampled): lossy WebP.
// - PNG with alpha (pigment layers blended onto the cave wall): a palette PNG from libimagequant.
//   It stays PNG, so WebKit's WebP alpha path is not involved, and its error is measured on the
//   premultiplied colour the wall actually shows.
// The decoded size is unchanged, so the manifest's image and uvSource sizes remain true.
export const TEXTURE_POLICY = Object.freeze({
  webpQuality: 90,
  paletteQuality: 95,
  // Minimum PSNR (dB) of the delivered texture against its master: premultiplied colour for
  // alpha textures, colour otherwise. Below it the master is delivered.
  minimumPsnr: 37,
});

async function measure(sharp, master, cooked, alpha) {
  const [a, b] = await Promise.all([
    sharp(master).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(cooked).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    throw new Error('cooked texture changed size');
  let sq = 0,
    n = 0,
    worst = 0,
    alphaSq = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = alpha
        ? (a.data[i + c] * a.data[i + 3] - b.data[i + c] * b.data[i + 3]) / 255
        : a.data[i + c] - b.data[i + c];
      sq += d * d;
      n++;
      if (Math.abs(d) > worst) worst = Math.abs(d);
    }
    const da = a.data[i + 3] - b.data[i + 3];
    alphaSq += da * da;
  }
  const psnr = (mse) => (mse === 0 ? 99 : Number((10 * Math.log10(65025 / mse)).toFixed(2)));
  return {
    width: a.info.width,
    height: a.info.height,
    psnr: psnr(sq / n),
    alphaPsnr: alpha ? psnr(alphaSq / (a.data.length / 4)) : null,
    maxError: Number(worst.toFixed(1)),
  };
}

/** Returns { bytes, extension, encoding, quality } or { kept } for one texture master. With
 * `samePng` the result is always a PNG (a palette PNG), for images served at a fixed .png URL. */
export async function cookTexture(bytes, sharp, policy = TEXTURE_POLICY, { samePng = false } = {}) {
  const meta = await sharp(bytes, { failOn: 'error' }).metadata();
  if (meta.format !== 'png') return { kept: `format-${meta.format}` };
  let alpha = false;
  if (meta.hasAlpha) {
    const stats = await sharp(bytes).stats();
    alpha = stats.channels[stats.channels.length - 1].min < 255;
  }
  const palette = alpha || samePng;
  const cooked = palette
    ? await sharp(bytes)
        .png({
          palette: true,
          quality: policy.paletteQuality,
          effort: 10,
          dither: 1,
          compressionLevel: 9,
        })
        .toBuffer()
    : await sharp(bytes)
        .removeAlpha()
        .webp({ quality: policy.webpQuality, smartSubsample: true, effort: 6 })
        .toBuffer();
  if (cooked.length >= bytes.length) return { kept: 'larger' };
  const quality = await measure(sharp, bytes, cooked, alpha);
  if (quality.width !== meta.width || quality.height !== meta.height)
    throw new Error('cooked texture changed size');
  if (quality.psnr < policy.minimumPsnr || (alpha && quality.alphaPsnr < policy.minimumPsnr))
    return { kept: 'quality', quality };
  return {
    bytes: cooked,
    extension: palette ? 'png' : 'webp',
    encoding: palette ? `png-palette-q${policy.paletteQuality}` : `webp-q${policy.webpQuality}`,
    quality,
  };
}

import assert from 'node:assert/strict';
import sharp from 'sharp';

/** Technical extraction only. A dedicated single-character source retains all
 * its islands (524's two dots, earrings, charms), including the original alpha.
 * Legacy multi-character sheets require main-island separation where bounding
 * boxes intersect. New isolated sources must opt into `whole` explicitly. */
export async function extractMuralSprite(bytes, { crop, isolation = 'main' }) {
  assert(['main', 'whole'].includes(isolation), 'unknown mural isolation mode');
  assert(
    Array.isArray(crop) && crop.length === 4 && crop.every(Number.isSafeInteger),
    'invalid mural crop',
  );
  const [x0, y0, x1, y1] = crop;
  assert(x0 >= 0 && y0 >= 0 && x1 > x0 && y1 > y0, 'invalid mural crop bounds');
  const image = await sharp(bytes)
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = image.info.width,
    h = image.info.height;
  if (isolation === 'whole') {
    let ink = 0;
    for (let p = 3; p < image.data.length; p += 4) if (image.data[p] >= 24) ink++;
    assert(ink > 1000, 'missing sprite');
    return image;
  }
  const labels = new Int32Array(w * h),
    queue = new Int32Array(w * h);
  let label = 0,
    largest = 0,
    largestCount = 0;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || image.data[p * 4 + 3] < 24) continue;
    label++;
    let n = 1,
      j = 0;
    queue[0] = p;
    labels[p] = label;
    while (j < n) {
      const a = queue[j++],
        x = a % w,
        y = Math.floor(a / w);
      for (const b of [
        x ? a - 1 : -1,
        x < w - 1 ? a + 1 : -1,
        y ? a - w : -1,
        y < h - 1 ? a + w : -1,
      ])
        if (b >= 0 && !labels[b] && image.data[b * 4 + 3] >= 24) {
          labels[b] = label;
          queue[n++] = b;
        }
    }
    if (n > largestCount) {
      largest = label;
      largestCount = n;
    }
  }
  assert(largestCount > 1000, 'missing sprite');
  const keep = new Uint8Array(labels.length);
  for (let p = 0; p < labels.length; p++)
    if (labels[p] === largest) {
      const x = p % w,
        y = Math.floor(p / w);
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) keep[p + dx + dy * w] = 1;
    }
  for (let p = 0; p < labels.length; p++) if (!keep[p]) image.data.fill(0, p * 4, p * 4 + 4);
  return image;
}

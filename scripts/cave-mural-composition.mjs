// Offline assembly of imagegen artwork. No new runtime textures or drawn art.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MURAL_RECIPE = 'assets/camp-cave/modular-r36/recipe.json';
export const digest = (data) => createHash('sha256').update(data).digest('hex');
export const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
export const entryAt = (asset, entry) => entry.split('.').reduce((a, k) => a[k], asset);

export async function exactBytes(file, record) {
  const data = await readFile(file);
  assert.equal(data.length, record.bytes, `${file}: byte length changed`);
  assert.equal(digest(data), record.sha256, `${file}: SHA-256 changed`);
  return data;
}

/** A feather INSIDE a hand-reviewed polygon: nothing outside it can change. */
export function slotWeight(slot, x, y) {
  let inside = false,
    distance = Infinity;
  const points = slot.polygon;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j],
      [bx, by] = points[i];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  if (!inside) return 0;
  const t = Math.min(1, distance / slot.feather);
  return t * t * (3 - 2 * t);
}

export function validateHidden(recipe, hidden) {
  assert.ok(
    Array.isArray(hidden) && hidden.every((s) => typeof s === 'string'),
    'hidden must be an array of character IDs',
  );
  const keys = Object.values(recipe.panels).flatMap((p) => p.slots.map((s) => s.character));
  assert.equal(
    new Set(keys).size,
    keys.length,
    'each character needs exactly one independent slot',
  );
  assert.equal(new Set(hidden).size, hidden.length, 'duplicate hidden character');
  for (const key of hidden) assert.ok(keys.includes(key), `Unknown mural character: ${key}`);
  return hidden;
}

export function muralWeight(panel, hidden, x, y) {
  // Where drawings overlap, a visible neighbour keeps all its original pixels.
  for (const slot of panel.slots)
    if (
      !hidden.includes(slot.character) &&
      slotWeight({ ...slot, polygon: slot.characterPolygon }, x, y) > 0
    )
      return 0;
  return Math.max(
    0,
    ...panel.slots.filter((s) => hidden.includes(s.character)).map((s) => slotWeight(s, x, y)),
  );
}

/** Pure, non-destructive composition. The original is returned byte-for-byte
 * when no slot in this panel is hidden. Transparent pigment stays transparent. */
export async function composeMural(panel, hidden) {
  const original = await exactBytes(`public${panel.original.url}`, panel.original);
  const slots = panel.slots.filter((slot) => hidden.includes(slot.character));
  if (!slots.length) return original;
  const animals = await exactBytes(panel.animals.path, panel.animals);
  const a = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(animals).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([a.info.width, a.info.height, a.info.channels], [1024, 341, 4]);
  assert.deepEqual([b.info.width, b.info.height, b.info.channels], [1024, 341, 4]);
  const pixels = Buffer.from(a.data);
  for (let y = 0; y < a.info.height; y++)
    for (let x = 0; x < a.info.width; x++) {
      const mix = muralWeight(panel, hidden, x + 0.5, y + 0.5);
      if (!mix) continue;
      const i = (y * a.info.width + x) * 4;
      const aa = a.data[i + 3] * (1 - mix),
        ba = b.data[i + 3] * mix,
        alpha = aa + ba;
      for (let c = 0; c < 3; c++)
        pixels[i + c] = alpha ? Math.round((a.data[i + c] * aa + b.data[i + c] * ba) / alpha) : 0;
      pixels[i + 3] = Math.round(alpha);
    }
  return sharp(pixels, { raw: { width: a.info.width, height: a.info.height, channels: 4 } })
    .png()
    .toBuffer();
}

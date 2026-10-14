import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CAMP_CAVE, CAVE_APPROACH, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { spawnSite } from '../dist/shared/spawn-sites.mjs';
import { createHash } from 'node:crypto';
import {
  CAVE_EXTRA_PIGMENTS,
  CAVE_MURALS,
  caveMotifSource,
} from '../dist/src/cave-gallery-layout.js';
import {
  imageIdentities,
  pngHeader,
  r04AdoptedCave,
  verifyRgbaImage,
} from './cave-runtime-identity.mjs';

// Every extra frieze is an RGBA painting at the size its rectangle is measured in: the adopted
// ones as generated (2172x724), a later one as served, its whole-image resize to 1024 px.

test('camp reaches the relocated cave at ground level without the castle climb', () => {
  const collision = new CollisionWorld();
  let previous = { x: 48, z: 57 };
  for (const next of [...CAVE_APPROACH, ...[5, 0, -5, -10, -15, -25].map((z) => caveWorldAt(z))]) {
    assert.ok(collision.segmentFree(previous, next, 0.76), `blocked ${JSON.stringify(next)}`);
    for (let t = 0; t <= 1; t += 0.025) {
      const h = walkHeight(
        previous.x + (next.x - previous.x) * t,
        previous.z + (next.z - previous.z) * t,
      );
      assert.ok(Math.abs(h) < 0.65, `not ground level: ${h}`);
    }
    previous = next;
  }
  assert.equal(spawnSite('cave').name, 'アプデの洞窟');
  assert.equal(CAMP_CAVE.elevation, 0);
  assert.ok(collision.free(spawnSite('cave'), 0.76));
});

test('all extra friezes retain the original generated RGBA bytes and registered subjects', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  for (const [key, pigment] of Object.entries(CAVE_EXTRA_PIGMENTS)) {
    const record = asset.mascotPigments[key];
    assert.deepEqual(record.subjects, pigment.subjects);
    // The source and the original public file stay the generated painting; the
    // served file (the same one until runtime adoption) is proven separately.
    const { original } = await verifyRgbaImage(
      record,
      `mascotPigments.${key}`,
      caveMotifSource(key),
    );
    assert.equal(original.url, pigment.url, `${key}: the table names the original painting`);
    assert.ok(CAVE_MURALS.some((m) => m.motif === key));
    // A frieze resized before it was first served keeps the generated painting too.
    if (record.generated) {
      const bytes = await readFile(record.generated.path),
        { width, height, colour } = pngHeader(bytes, record.generated.path);
      assert.equal(bytes.length, record.generated.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.generated.sha256);
      assert.deepEqual({ width, height }, record.generated.image);
      assert.equal(colour, 6);
      assert.ok(width > original.image.width, `${key}: the generated painting is larger`);
      assert.ok(
        Math.abs(width * original.image.height - height * original.image.width) <= width,
        `${key}: served as a whole-image resize`,
      );
    }
  }
  assert.ok(!CAVE_MURALS.some((m) => m.motif === 'comingSoon'));
});

test('the r04 adoption of every extra frieze it planned verifies on its candidate file', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  const { images, serve } = await r04AdoptedCave(asset);
  for (const [key, pigment] of Object.entries(CAVE_EXTRA_PIGMENTS)) {
    const where = `mascotPigments.${key}`;
    // A frieze painted after the adoption is not in it, and is served unadopted.
    const current = imageIdentities(asset.mascotPigments[key], where);
    assert.equal(!!images[where], current.adopted, `${key}: adopted exactly when r04 planned it`);
    if (!images[where]) continue;
    const { adopted, original } = await verifyRgbaImage(
      images[where],
      where,
      caveMotifSource(key),
      {
        serve,
      },
    );
    assert.equal(adopted, true, key);
    assert.equal(original.url, pigment.url, `${key}: adopted from the original painting`);
  }
});

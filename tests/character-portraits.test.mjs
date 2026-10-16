import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PLAYABLE_CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { CLOTHING_DYES } from '../dist/shared/clothing-dye.mjs';
import { characterPortraitUrl, characterPortraitUrls } from '../dist/src/character-portraits.js';

const root = new URL('../assets/character-portraits/20261016-r04/', import.meta.url);
const capture = JSON.parse(await readFile(new URL('capture.json', root), 'utf8'));
const sources = JSON.parse(await readFile(new URL('source-models.json', root), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const colours = [null, ...CLOTHING_DYES.map((dye) => dye.key)];

test('the photographed silhouettes retain world height ratios on a shared ground line', () => {
  const scales = capture.records.map((record) => record.source.camera.verticalSpan);
  assert.deepEqual([...new Set(scales)], [2.24]);
  for (const record of capture.records) {
    const metres = record.source.bounds.max[1] - record.source.bounds.min[1];
    for (const photo of record.photos) {
      const pixels = photo.bounds.bottom - photo.bounds.top + 1;
      assert.ok(Math.abs(pixels - (metres / 2.24) * capture.height) < 3, record.key);
      assert.ok(Math.abs(photo.bounds.bottom - 370) < 3, `${record.key}: shared feet line`);
    }
  }
  const height = (key) => {
    const bounds = capture.records.find((record) => record.key === key).photos[0].bounds;
    return bounds.bottom - bounds.top + 1;
  };
  assert.ok(height('giant-ape') > height('cro-magnon-hunter'));
  assert.ok(height('desert-fennec-mage') < height('giant-ape') * 0.4);
});

test('every playable character and clothing colour ships its own verified photograph', async () => {
  assert.equal(capture.ok, true);
  assert.deepEqual(capture.errors, []);
  assert.deepEqual(
    capture.records.map((r) => r.key),
    PLAYABLE_CHARACTER_MODELS.map((m) => m.key),
  );
  for (const record of capture.records) {
    assert.deepEqual(
      record.photos.map((p) => p.dye),
      colours,
      record.key,
    );
    assert.equal(new Set(record.photos.map((p) => p.webp.sha256)).size, colours.length, record.key);
    assert.deepEqual(
      characterPortraitUrls(record.key),
      colours.map((dye) => characterPortraitUrl(record.key, dye)),
    );
    for (const photo of record.photos) {
      const runtime = new URL(
        `../public${characterPortraitUrl(record.key, photo.dye)}`,
        import.meta.url,
      );
      const bytes = await readFile(runtime);
      assert.equal(bytes.length, photo.webp.bytes, runtime.pathname);
      assert.equal(sha256(bytes), photo.webp.sha256, runtime.pathname);
      assert.equal(photo.shader, true);
      assert.equal(photo.alphaChanges, 0);
      assert.ok(photo.visiblePixels > 3000);
      if (photo.dye) assert.ok(photo.changedPixels > 60, `${record.key}/${photo.dye}`);
    }
    assert.equal(characterPortraitUrl(record.key, 'invalid'), characterPortraitUrl(record.key));
  }
});

test('lossless photos preserve the captured pixels and leave room around the whole character', async () => {
  for (const record of capture.records) {
    for (const photo of record.photos) {
      const source = await readFile(new URL(photo.png.file, root));
      assert.equal(sha256(source), photo.png.sha256);
      const [png, webp] = await Promise.all([
        sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(await readFile(new URL(photo.webp.file, root)))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      ]);
      assert.equal(webp.info.width, 336);
      assert.equal(webp.info.height, 384);
      assert.equal(png.data.length, webp.data.length);
      for (let i = 0; i < png.data.length; i += 4) {
        assert.equal(webp.data[i + 3], png.data[i + 3], 'Alpha must be lossless');
        if (png.data[i + 3]) {
          assert.equal(webp.data[i], png.data[i]);
          assert.equal(webp.data[i + 1], png.data[i + 1]);
          assert.equal(webp.data[i + 2], png.data[i + 2]);
        }
      }
      assert.ok(photo.bounds.left >= 4 && photo.bounds.top >= 4);
      assert.ok(photo.bounds.right < 332 && photo.bounds.bottom < 380);
    }
  }
});

test('the photographed models trace back to the currently adopted character GLBs', async () => {
  assert.deepEqual(
    sources.map((s) => s.key),
    capture.records.map((r) => r.key),
  );
  for (const source of sources) {
    const asset = JSON.parse(
      await readFile(new URL(`../${source.manifest}`, import.meta.url), 'utf8'),
    );
    assert.equal(asset.url, source.master.url);
    assert.equal(
      asset.sha256,
      source.master.sha256,
      `Recapture ${source.key} after replacing its model`,
    );
    assert.equal(
      source.delivered.sha256,
      capture.records.find((r) => r.key === source.key).source.sha256,
    );
  }
  const generator = await readFile(new URL('capture-character-portraits.mjs', root));
  assert.equal(sha256(generator), capture.inputs[capture.generator]);
});

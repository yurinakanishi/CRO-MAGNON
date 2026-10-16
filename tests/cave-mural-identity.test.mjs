import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { extractMuralSprite } from '../scripts/cave-mural-sprite.mjs';
import { CAVE_SUBJECT_ART } from '../dist/shared/cave-mural-art.mjs';
import { CAVE_MURALS, caveMuralImages, caveMuralUV } from '../dist/src/cave-gallery-layout.js';
const root = 'assets/camp-cave/identity-r41',
  json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  recipe = await json(`${root}/recipe.json`),
  asset = await json('public/models/camp-cave/asset.json'),
  hash = (b) => createHash('sha256').update(b).digest('hex');
function islands({ data, info }, minimum = 50) {
  const seen = new Uint8Array(info.width * info.height),
    queue = new Int32Array(seen.length),
    result = [];
  for (let p = 0; p < seen.length; p++) {
    if (seen[p] || data[p * 4 + 3] < 64) continue;
    let n = 1,
      j = 0,
      left = info.width,
      top = info.height,
      right = 0,
      bottom = 0;
    queue[0] = p;
    seen[p] = 1;
    while (j < n) {
      const a = queue[j++],
        x = a % info.width,
        y = Math.floor(a / info.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      for (const b of [
        x ? a - 1 : -1,
        x + 1 < info.width ? a + 1 : -1,
        y ? a - info.width : -1,
        y + 1 < info.height ? a + info.width : -1,
      ])
        if (b >= 0 && !seen[b] && data[b * 4 + 3] >= 64) {
          seen[b] = 1;
          queue[n++] = b;
        }
    }
    if (n >= minimum) result.push({ pixels: n, box: [left, top, right, bottom] });
  }
  return result.sort((a, b) => b.pixels - a.pixels);
}

test('the served 524 keeps its body and two detached yellow dots after extraction and packing', async () => {
  const mural = CAVE_MURALS.find((m) => m.subject === '524'),
    art = CAVE_SUBJECT_ART.find((s) => s.id === '524'),
    image = caveMuralImages(asset).characterPigment,
    uv = caveMuralUV(mural),
    raw = await sharp(`public${image.url}`)
      .extract({
        left: Math.round(uv.offset[0] * image.image.width),
        top: Math.round((1 - uv.offset[1] - uv.scale[1]) * image.image.height),
        width: Math.round(uv.scale[0] * image.image.width),
        height: Math.round(uv.scale[1] * image.image.height),
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    parts = islands(raw);
  assert.equal(parts.length, 3, 'main body plus exactly two clearly painted separate dots');
  const [body, ...dots] = parts;
  assert(body.pixels > dots[0].pixels * 50);
  for (const dot of dots) {
    assert(dot.box[0] > (body.box[0] + body.box[2]) / 2, 'dots trail to the lower right');
    assert(dot.box[3] > body.box[3], 'dots extend below the body');
    const x = Math.floor((dot.box[0] + dot.box[2]) / 2),
      y = Math.floor((dot.box[1] + dot.box[3]) / 2),
      p = (y * raw.info.width + x) * 4;
    assert(
      raw.data[p] > 150 && raw.data[p + 1] > 95 && raw.data[p + 2] < 170,
      'yellow ochre pigment',
    );
  }
  assert(Math.abs(mural.height * art.bodySpan - 0.72) < 1e-9, 'dots do not shrink the body');
  assert(Math.abs(mural.footHeight - 1.62) < 1e-9, 'existing floating body baseline');
  assert(art.ink[3] > art.foot, 'the detached dots are below the body reference');
});

test('an isolated source preserves all original alpha islands, while legacy shared sheets remain separated', async () => {
  const s = recipe.subjects.find((s) => s.id === '524'),
    bytes = await readFile(recipe.sources[s.source].path),
    kept = await extractMuralSprite(bytes, s),
    [x0, y0, x1, y1] = s.crop,
    original = await sharp(bytes)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .ensureAlpha()
      .raw()
      .toBuffer();
  assert.equal(s.isolation, 'whole');
  assert.deepEqual(kept.data, original, 'keep every pixel of the approved isolated source');
  assert.equal(islands(kept).length, 3);
  assert.equal(
    islands(await extractMuralSprite(bytes, { ...s, isolation: 'main' })).length,
    1,
    'the legacy largest-island separator would lose the two dots',
  );
  await assert.rejects(extractMuralSprite(bytes, { ...s, isolation: 'unknown' }), /isolation/);
});

test('all 24 identity comparisons have archived references, with only seven subjects regenerated', async () => {
  const review = await json(`${root}/qa/identity-review.json`);
  assert.deepEqual(
    review.subjects.map((s) => s.id).sort(),
    CAVE_SUBJECT_ART.map((s) => s.id).sort(),
  );
  assert.equal(review.subjects.filter((s) => s.decision === 'repair').length, 7);
  assert.equal(review.subjects.filter((s) => s.decision === 'retain').length, 17);
  const before = await json(`${root}/previous-asset.json`),
    old = caveMuralImages(before),
    now = caveMuralImages(asset);
  const pairs = [
    ['rimo', old.rimoPigment, now.rimoPigment],
    ...['roundBots', 'shapeBots', 'maeKohaku', 'maruimoFrieze', 'ryuichiFrieze'].map((k) => [
      k,
      old.extras[k],
      now.extras[k],
    ]),
  ];
  for (const [id, a, b] of pairs)
    assert.equal(a.sha256, b.sha256, `${id}: retain the exact accepted PNG`);
  for (const entry of review.subjects) {
    assert.equal(hash(await readFile(entry.reference.path)), entry.reference.sha256);
    const s = recipe.subjects.find((s) => s.id === entry.id),
      source = recipe.sources[s.source];
    assert.equal(hash(await readFile(source.path)), source.sha256);
    if (entry.decision === 'repair') {
      assert.equal(s.isolation, 'whole');
      assert(source.references.some((r) => r.path === entry.reference.path));
      assert(source.references.some((r) => r.path === entry.before));
    }
  }
});

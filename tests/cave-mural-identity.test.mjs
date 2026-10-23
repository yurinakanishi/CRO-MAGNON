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

// Atlas SHA-256 by recipe key, from a revision's own packing record.
async function packedAtlases(revision) {
  const atlases = {};
  for (const t of (await json(`${revision}/qa/packing.json`)).textures) {
    const key = /\/packed\/([A-Za-z0-9]+)-[0-9a-f]{16}\.png$/.exec(t.path)?.[1];
    if (key) atlases[key] = t.sha256;
  }
  return atlases;
}
const servedAtlas = (images, key) =>
  key === 'creature524'
    ? images.characterPigment
    : key === 'rimoFrieze'
      ? images.rimoPigment
      : images.extras[key];

test('r41 compared all 24 characters with archived references and regenerated only seven', async () => {
  const review = await json(`${root}/qa/identity-review.json`);
  assert.deepEqual(
    review.subjects.map((s) => s.id).sort(),
    recipe.subjects.map((s) => s.id).sort(),
  );
  assert.equal(review.subjects.length, 24);
  assert.equal(review.subjects.filter((s) => s.decision === 'repair').length, 7);
  assert.equal(review.subjects.filter((s) => s.decision === 'retain').length, 17);
  const old = caveMuralImages(await json(`${root}/previous-asset.json`)),
    packed = await packedAtlases(root);
  for (const key of [
    'rimoFrieze',
    'roundBots',
    'shapeBots',
    'maeKohaku',
    'maruimoFrieze',
    'ryuichiFrieze',
  ])
    assert.equal(
      packed[key],
      servedAtlas(old, key).sha256,
      `${key}: retain the exact accepted PNG`,
    );
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

test('the current art revision compares every painted character with an archived reference', async () => {
  const current = await json(asset.muralComposition.recipe),
    review = await json(current.identityReview);
  assert.deepEqual(
    review.subjects.map((s) => s.id).sort(),
    CAVE_SUBJECT_ART.map((s) => s.id).sort(),
  );
  for (const entry of review.subjects) {
    assert.equal(hash(await readFile(entry.reference.path)), entry.reference.sha256);
    const s = current.subjects.find((s) => s.id === entry.id),
      source = current.sources[s.source];
    assert.equal(hash(await readFile(source.path)), source.sha256);
    // Repaired and newly added characters come from isolated sources made from their reference.
    if (entry.decision !== 'retain') {
      assert.equal(s.isolation, 'whole');
      assert(source.references.some((r) => r.path === entry.reference.path));
    }
    if (entry.decision === 'repair') assert(source.references.some((r) => r.path === entry.before));
  }
});

test('r42 adds Jank0vic and keeps all 24 r41 cutouts and nine atlases byte-identical', async () => {
  const r42 = 'assets/camp-cave/jank0vic-r42',
    review = await json(`${r42}/qa/identity-review.json`),
    r42Recipe = await json(`${r42}/recipe.json`),
    earlier = await json(`${root}/qa/identity-review.json`);
  assert.deepEqual(
    review.subjects.filter((s) => s.decision === 'new').map((s) => s.id),
    ['jank0vic'],
  );
  assert.equal(review.subjects.filter((s) => s.decision === 'retain').length, 24);
  for (const before of earlier.subjects) {
    const entry = review.subjects.find((s) => s.id === before.id);
    assert.deepEqual(entry.reference, before.reference);
    assert.equal(entry.before, before.after);
    const [a, b] = await Promise.all(
      [before.after, entry.after].map((p) => sharp(p).ensureAlpha().raw().toBuffer()),
    );
    assert(a.equals(b), `${before.id}: delivered pixels changed`);
  }
  // Only the storage atlas that received the new cutout was repacked.
  const old = caveMuralImages(await json(`${r42}/previous-asset.json`)),
    packed = await packedAtlases(r42);
  for (const key of Object.keys(r42Recipe.atlases))
    if (key === 'maeKohaku') assert.notEqual(packed[key], servedAtlas(old, key).sha256);
    else assert.equal(packed[key], servedAtlas(old, key).sha256, `${key}: retain the exact PNG`);
  // The user-approved X photo is a production reference only, never a served file.
  const s = r42Recipe.subjects.find((s) => s.id === 'jank0vic');
  assert.deepEqual(s, {
    id: 'jank0vic',
    atlas: 'maeKohaku',
    source: 'jank0vic-identity',
    crop: [252, 14, 1114, 1244],
    size: 'person',
    isolation: 'whole',
  });
  assert.equal(
    r42Recipe.sources[s.source].references[0].path,
    `${r42}/references/x-avatar-400x400.jpg`,
  );
});

test('r43 repaints Jank0vic as a front-facing head and keeps the other 24 cutouts and nine atlases', async () => {
  const r43 = 'assets/camp-cave/jank0vic-face-r43',
    review = await json(`${r43}/qa/identity-review.json`),
    r43Recipe = await json(`${r43}/recipe.json`),
    earlier = await json('assets/camp-cave/jank0vic-r42/qa/identity-review.json');
  assert.deepEqual(
    review.subjects.filter((s) => s.decision !== 'retain').map((s) => [s.id, s.decision]),
    [['jank0vic', 'redraw']],
  );
  for (const before of earlier.subjects.filter((s) => s.id !== 'jank0vic')) {
    const entry = review.subjects.find((s) => s.id === before.id);
    assert.deepEqual(entry.reference, before.reference);
    assert.equal(entry.before, before.after);
    const [a, b] = await Promise.all(
      [before.after, entry.after].map((p) => sharp(p).ensureAlpha().raw().toBuffer()),
    );
    assert(a.equals(b), `${before.id}: delivered pixels changed`);
  }
  // Only the storage atlas that holds the repainted cutout was repacked.
  const old = caveMuralImages(await json(`${r43}/previous-asset.json`)),
    packed = await packedAtlases(r43);
  for (const key of Object.keys(r43Recipe.atlases))
    if (key === 'maeKohaku') assert.notEqual(packed[key], servedAtlas(old, key).sha256);
    else assert.equal(packed[key], servedAtlas(old, key).sha256, `${key}: retain the exact PNG`);
  // A head only, at the shared height of the round faces (user request 2026-10-22).
  const s = r43Recipe.subjects.find((s) => s.id === 'jank0vic');
  assert.equal(s.size, 'small');
  assert.equal(s.isolation, 'whole');
  assert.equal(
    r43Recipe.sources[s.source].references[0].path,
    'assets/camp-cave/jank0vic-r42/references/x-avatar-400x400.jpg',
  );
});

test('r44 frames the unchanged r43 face with aligned rows of exclamation marks', async () => {
  const r44 = 'assets/camp-cave/jank0vic-exclaim-r44',
    review = await json(`${r44}/qa/identity-review.json`),
    r44Recipe = await json(`${r44}/recipe.json`),
    r43Recipe = await json('assets/camp-cave/jank0vic-face-r43/recipe.json'),
    earlier = await json('assets/camp-cave/jank0vic-face-r43/qa/identity-review.json'),
    layout = await json(`${r44}/qa/frame-layout.json`);
  assert.deepEqual(
    review.subjects.filter((s) => s.decision !== 'retain').map((s) => [s.id, s.decision]),
    [['jank0vic', 'redraw']],
  );
  for (const before of earlier.subjects.filter((s) => s.id !== 'jank0vic')) {
    const entry = review.subjects.find((s) => s.id === before.id);
    const [a, b] = await Promise.all(
      [before.after, entry.after].map((p) => sharp(p).ensureAlpha().raw().toBuffer()),
    );
    assert(a.equals(b), `${before.id}: delivered pixels changed`);
  }
  const old = caveMuralImages(await json(`${r44}/previous-asset.json`)),
    packed = await packedAtlases(r44);
  for (const key of Object.keys(r44Recipe.atlases))
    if (key === 'maeKohaku') assert.notEqual(packed[key], servedAtlas(old, key).sha256);
    else assert.equal(packed[key], servedAtlas(old, key).sha256, `${key}: retain the exact PNG`);
  // The r43 face is copied into the frame, never repainted.
  const s = r44Recipe.subjects.find((s) => s.id === 'jank0vic'),
    source = r44Recipe.sources[s.source],
    bytes = await readFile(source.path);
  assert.equal(hash(bytes), layout.output.sha256);
  const faceSubject = r43Recipe.subjects.find((s) => s.id === 'jank0vic'),
    face = await extractMuralSprite(
      await readFile(r43Recipe.sources[faceSubject.source].path),
      faceSubject,
    ),
    composite = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let copied = 0;
  for (let y = 0; y < face.info.height; y++)
    for (let x = 0; x < face.info.width; x++) {
      const p = (y * face.info.width + x) * 4;
      if (!face.data[p + 3]) continue;
      copied++;
      const q = ((y + layout.face.top) * composite.info.width + x + layout.face.left) * 4;
      assert(face.data.compare(composite.data, q, q + 4, p, p + 4) === 0, `face pixel ${x},${y}`);
    }
  assert.equal(copied, layout.face.unchangedPixels);
  assert(copied > 700000);
  // Ten per row: two full rows above and below the face, three either side of it.
  assert.equal(layout.placements.length, 64);
  for (let row = 0; row < 8; row++)
    assert.deepEqual(
      layout.placements.filter((p) => p.row === row).map((p) => p.column),
      row >= 2 && row <= 5 ? [0, 1, 2, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
  // Rows share one painted baseline and columns one centre, measured from the pixels.
  const { margin, rowPitch, columnPitch } = layout.grid,
    baselines = new Map(),
    centres = new Map();
  for (const p of layout.placements) {
    const x0 = Math.floor(margin + p.column * columnPitch),
      x1 = Math.ceil(margin + (p.column + 1) * columnPitch),
      y0 = Math.floor(margin + p.row * rowPitch),
      y1 = Math.ceil(margin + (p.row + 1) * rowPitch);
    let left = Infinity,
      right = -1,
      bottom = -1;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (composite.data[(y * composite.info.width + x) * 4 + 3] >= 24) {
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
    assert(right > left, `mark ${p.row},${p.column}`);
    baselines.set(p.row, [...(baselines.get(p.row) ?? []), bottom]);
    centres.set(p.column, [...(centres.get(p.column) ?? []), (left + right) / 2]);
  }
  for (const values of [...baselines.values(), ...centres.values()])
    assert(Math.max(...values) - Math.min(...values) <= 2, `misaligned marks: ${values}`);
  // The face stays the 0.72 m body; the bottom row of marks rests on the shared baseline.
  assert.equal(s.size, 'small');
  assert.equal(s.isolation, 'whole');
  assert.deepEqual(
    [s.bodyTop, s.bodyBottom, s.lift],
    [layout.recipe.bodyTop, layout.recipe.bodyBottom, layout.recipe.lift],
  );
  assert(Math.abs(Math.max(...baselines.get(7)) - layout.ink[3]) <= 1);
});

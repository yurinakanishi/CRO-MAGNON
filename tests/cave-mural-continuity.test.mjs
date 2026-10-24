import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  CAVE_MURALS,
  CAVE_MURAL_SCALE,
  CAVE_MURAL_GALLERY,
  buildCaveMurals,
  caveMuralDistance,
  caveMuralLocalZ,
  caveMuralImages,
  caveMuralUV,
  caveMuralShaderFor,
} from '../dist/src/cave-gallery-layout.js';
import { CAVE_SUBJECT_ART, CAVE_ANIMAL_ART } from '../dist/shared/cave-mural-art.mjs';
import { CAVE_BEND } from '../dist/shared/camp-cave-layout.mjs';
import { CONTRIBUTOR_MURAL_SUBJECTS } from '../dist/src/title-credits.js';
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8'));
const recipe = JSON.parse(await readFile(asset.muralComposition.recipe, 'utf8'));
const near = (a, b, tolerance = 1e-8) =>
  assert(Math.abs(a - b) <= tolerance, `${a} versus ${b}, tolerance ${tolerance}`);
function continuous(murals) {
  for (const wall of ['east', 'west']) {
    const row = murals
      .filter((m) => m.wall === wall && m.layer === 'foreground')
      .sort((a, b) => a.distance - b.distance);
    near(row[0].distance - row[0].width / 2, caveMuralDistance(CAVE_MURAL_GALLERY.startZ));
    near(row.at(-1).distance + row.at(-1).width / 2, caveMuralDistance(CAVE_MURAL_GALLERY.endZ));
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].distance - row[i].width / 2 - row[i - 1].distance - row[i - 1].width / 2;
      assert(gap >= 0.16 - 1e-8, `${wall}: overlaps at ${row[i].subject}`);
      assert(gap < 1.5, `${wall}: isolated group gap at ${row[i].subject}: ${gap}`);
    }
  }
}
test('one continuous composition on either wall, all current people and all eight animal kinds', () => {
  continuous(CAVE_MURALS);
  assert.deepEqual(
    CAVE_MURALS.filter((m) => m.kind === 'character')
      .map((m) => m.subject)
      .sort(),
    Object.values(CONTRIBUTOR_MURAL_SUBJECTS).flat().sort(),
  );
  for (const wall of ['east', 'west'])
    assert.deepEqual(
      CAVE_MURALS.filter((m) => m.wall === wall && m.kind === 'animal' && m.layer === 'foreground')
        .map((m) => m.subject)
        .sort(),
      [
        'redHorse',
        'ochreHorse',
        'bison',
        'deer',
        'mammoth',
        'aurochs',
        'ibex',
        'woollyRhino',
      ].sort(),
    );
  assert.equal(
    CAVE_MURALS.find((m) => m.subject === '524').centre,
    CAVE_MURALS.find((m) => m.subject === 'rimo-neko').centre,
  );
});

test('overpainting retains the accepted foreground layout for the original measurements', async () => {
  const previous = JSON.parse(
    await readFile('assets/camp-cave/layered-r40/previous-placements.json', 'utf8'),
  );
  const originalArt = JSON.parse(
    await readFile('assets/camp-cave/continuous-r39/qa/packing.json', 'utf8'),
  );
  const originalLayout = buildCaveMurals(originalArt.subjects);
  assert.equal(new Set(CAVE_MURALS.map((m) => m.id)).size, CAVE_MURALS.length);
  for (const old of previous) {
    const current = originalLayout.find((m) => m.id === `${old.wall}:${old.subject}`);
    for (const key of ['width', 'height', 'bottom', 'distance', 'centre', 'strength'])
      near(current[key], old[key]);
    if (old.kind === 'character') assert.deepEqual(current.rect, old.rect);
  }
  for (const wall of ['east', 'west']) {
    const back = CAVE_MURALS.filter((m) => m.wall === wall && m.layer === 'underpainting');
    assert.equal(new Set(back.map((m) => m.subject)).size, 8);
    assert(new Set(back.map((m) => m.footHeight)).size >= 5, 'irregular vertical placement');
    for (const mural of back) {
      const front = CAVE_MURALS.find((m) => m.id === `${wall}:${mural.subject}`);
      near(mural.width, front.width);
      near(mural.height, front.height);
      assert(mural.footHeight > front.footHeight);
      assert(mural.bottom + mural.height <= 5.3, 'full-height animals stay below the roof');
    }
  }
});

test('actual animal pigment overlaps on both walls with characters painted in front', async () => {
  const images = caveMuralImages(asset),
    pixels = new Map();
  for (const record of [
    images.pigment,
    images.characterPigment,
    images.rimoPigment,
    ...Object.values(images.extras),
  ])
    pixels.set(
      record.url,
      await sharp(`public${record.url}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    );
  const painted = (mural, along, y) => {
    const u = 0.5 + ((along - mural.distance) / mural.width) * (mural.wall === 'east' ? 1 : -1),
      v = (y - mural.bottom) / mural.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const record =
      images.extras[mural.motif] ??
      (mural.motif === 'creature524'
        ? images.characterPigment
        : mural.motif === 'rimoFrieze'
          ? images.rimoPigment
          : images.pigment);
    const { data, info } = pixels.get(record.url),
      uv = caveMuralUV(mural),
      px = Math.floor((uv.offset[0] + u * uv.scale[0]) * info.width),
      py = Math.floor((1 - uv.offset[1] - v * uv.scale[1]) * info.height);
    return data[(py * info.width + px) * 4 + 3] > 32;
  };
  for (const wall of ['east', 'west']) {
    const back = CAVE_MURALS.filter((m) => m.wall === wall && m.layer === 'underpainting'),
      front = CAVE_MURALS.filter((m) => m.wall === wall && m.layer === 'foreground');
    let crossings = 0,
      people = 0;
    for (const a of back)
      for (const b of front) {
        assert(CAVE_MURALS.indexOf(a) < CAVE_MURALS.indexOf(b), 'foreground is painted last');
        const left = Math.max(a.distance - a.width / 2, b.distance - b.width / 2),
          right = Math.min(a.distance + a.width / 2, b.distance + b.width / 2),
          bottom = Math.max(a.bottom, b.bottom),
          top = Math.min(a.bottom + a.height, b.bottom + b.height);
        let overlap = 0;
        for (let y = bottom + 0.04; y < top; y += 0.08)
          for (let along = left + 0.04; along < right; along += 0.08)
            if (painted(a, along, y) && painted(b, along, y)) overlap++;
        if (overlap >= 4) {
          crossings++;
          if (b.kind === 'character') people++;
        }
      }
    assert(crossings >= 8, `${wall}: only ${crossings} pigment crossings`);
    assert(people > 0, `${wall}: animals must also pass behind people`);
  }
});

test('decoded pigment, rather than atlas frames, has the common body height and planted baseline', async () => {
  const images = caveMuralImages(asset),
    pixels = new Map();
  const recordOf = (motif) =>
    images.extras[motif] ??
    (motif === 'creature524'
      ? images.characterPigment
      : motif === 'rimoFrieze'
        ? images.rimoPigment
        : images.pigment);
  for (const mural of CAVE_MURALS.filter((m) => m.kind !== 'sign')) {
    const art = (mural.kind === 'character' ? CAVE_SUBJECT_ART : CAVE_ANIMAL_ART).find(
      (s) => s.id === mural.subject,
    );
    const record = recordOf(mural.motif);
    if (!pixels.has(record.url))
      pixels.set(
        record.url,
        await sharp(`public${record.url}`)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      );
    const { data, info } = pixels.get(record.url),
      uv = caveMuralUV(mural);
    const x = uv.offset[0] * info.width,
      y = (1 - uv.offset[1] - uv.scale[1]) * info.height,
      w = uv.scale[0] * info.width,
      h = uv.scale[1] * info.height;
    let top = Infinity,
      bottom = -1,
      left = Infinity,
      right = -1;
    for (let py = Math.ceil(y); py < Math.floor(y + h); py++)
      for (let px = Math.ceil(x); px < Math.floor(x + w); px++)
        if (data[(py * info.width + px) * 4 + 3] >= 24) {
          top = Math.min(top, py - y);
          bottom = Math.max(bottom, py + 1 - y);
          left = Math.min(left, px - x);
          right = Math.max(right, px + 1 - x);
        }
    assert(bottom > top, `${mural.subject}: no visible pigment`);
    const tolerance = (2.5 * mural.height) / h;
    const input = recipe.subjects.find((s) => s.id === mural.subject);
    const foot =
      input?.bodyBottom === undefined
        ? bottom
        : ((input.bodyBottom - input.crop[1]) / (input.crop[3] - input.crop[1])) * h;
    near(mural.bottom + mural.height * (1 - foot / h), mural.footHeight, tolerance);
    if (mural.layer === 'foreground') near(mural.footHeight, 1.4 + (art.lift ?? 0));
    const crown =
      input?.bodyTop === undefined
        ? top
        : ((input.bodyTop - input.crop[1]) / (input.crop[3] - input.crop[1])) * h;
    near(((foot - crown) / h) * mural.height, CAVE_MURAL_SCALE[art.size], tolerance);
    // No anisotropic resizing: horizontal paint units equal vertical paint units.
    near(mural.width / mural.height, art.aspect, 1e-9);
    assert(right > left);
  }
});

test('one metre of the curved wall keeps its scale in front, middle and back on both sides', () => {
  // Independent fine trapezoidal integral, not the projection lookup itself.
  const integrate = (a, b) => {
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const d = a + ((b - a) * (i + 0.5)) / n,
        t = d / CAVE_BEND.depth;
      sum += (Math.hypot(1, (CAVE_BEND.offset * 6 * t * (1 - t)) / CAVE_BEND.depth) * (b - a)) / n;
    }
    return sum;
  };
  for (const m of CAVE_MURALS.filter((m) => m.kind !== 'sign')) {
    const z0 = caveMuralLocalZ(m.distance - m.width / 2),
      z1 = caveMuralLocalZ(m.distance + m.width / 2);
    near(integrate(-z0, -z1), m.width, 0.0015);
  }
});

test('future additions reflow automatically without shrinking any existing character or animal', () => {
  const prototype = CAVE_SUBJECT_ART.find((s) => s.id === 'daredaro');
  const expanded = buildCaveMurals([
    ...CAVE_SUBJECT_ART,
    { ...prototype, id: 'future-person-a' },
    { ...prototype, id: 'future-person-b' },
  ]);
  continuous(expanded);
  for (const old of CAVE_MURALS) {
    const current = expanded.find((m) => m.id === old.id);
    near(current.width, old.width);
    near(current.height, old.height);
    near(current.bottom, old.bottom);
  }
  assert.throws(
    () =>
      buildCaveMurals([
        ...CAVE_SUBJECT_ART,
        ...Array.from({ length: 100 }, (_, i) => ({ ...prototype, id: `future-${i}` })),
      ]),
    /full.*scales were not reduced/,
  );
  assert.throws(() => buildCaveMurals([...CAVE_SUBJECT_ART, prototype]), /Duplicate/);
  assert.throws(() => buildCaveMurals([{ ...prototype, bodySpan: 0 }]), /missing mural scale/);
});

test('hiding a person closes the gap and preserves all independent animals and other scales', () => {
  const hidden = buildCaveMurals(CAVE_SUBJECT_ART, ['howkey-scientist']);
  continuous(hidden);
  assert.equal(hidden.filter((m) => m.kind === 'character').length, 24);
  assert(!hidden.some((m) => m.subject === 'howkey-scientist'));
  for (const old of CAVE_MURALS.filter((m) => m.subject !== 'howkey-scientist')) {
    const current = hidden.find((m) => m.id === old.id);
    near(current.width, old.width);
    near(current.height, old.height);
  }
  assert.notEqual(caveMuralShaderFor(['howkey-scientist']), caveMuralShaderFor());
  assert.throws(() => buildCaveMurals(CAVE_SUBJECT_ART, ['unknown']), /Unknown mural character/);
});

test('visibility CLI reflows the current revision and restores exact manifests without changing artwork', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-continuous-mural-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert(path.basename(root).startsWith('cro-continuous-mural-'));
    await rm(root, { recursive: true, force: true });
  });
  const { extras, ...main } = caveMuralImages(asset);
  const files = [
    'public/models/camp-cave/asset.json',
    'public/models/world-assets.json',
    'cave-mural-visibility.json',
    ...[...Object.values(main), ...Object.values(extras)].map((r) => `public${r.url}`),
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await copyFile(file, path.join(root, file));
  }
  const run = (...args) =>
    promisify(execFile)(
      process.execPath,
      [path.resolve('scripts/compose-cave-murals.mjs'), ...args],
      { cwd: root, windowsHide: true },
    );
  const file = path.join(root, 'public/models/camp-cave/asset.json'),
    before = await readFile(file, 'utf8');
  await run('--hide', 'howkey-scientist');
  await run('--check');
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(after.muralComposition.hidden, ['howkey-scientist']);
  assert.deepEqual(after.mascotPigments, asset.mascotPigments, 'immutable image records');
  await assert.rejects(run('--hide', 'unknown'), /Unknown mural character/);
  await run('--show', 'howkey-scientist');
  assert.equal(await readFile(file, 'utf8'), before);
  // Corrupt artwork must fail before either manifest or visibility changes.
  await writeFile(path.join(root, `public${asset.rimoPigment.url}`), Buffer.alloc(3));
  await assert.rejects(run('--hide', 'mae'), /byte length changed/);
  assert.equal(await readFile(file, 'utf8'), before);
});

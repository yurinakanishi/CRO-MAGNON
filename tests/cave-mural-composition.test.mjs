import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  CAVE_MURALS,
  CAVE_EXTRA_PIGMENTS,
  caveMuralHeight,
  caveMotifSource,
} from '../dist/src/cave-gallery-layout.js';
import {
  MURAL_RECIPE,
  readJson,
  composeMural,
  exactBytes,
  validateHidden,
} from '../scripts/cave-mural-composition.mjs';
const recipe = await readJson(MURAL_RECIPE);
const raw = async (bytes) => sharp(bytes).ensureAlpha().raw().toBuffer();

test('the legacy group bays are replaced by independent characters and animals on both walls', () => {
  assert.equal(CAVE_MURALS.filter((m) => m.kind === 'character').length, 25);
  assert(CAVE_MURALS.filter((m) => m.kind === 'animal').length >= 48);
  assert.equal(
    CAVE_MURALS.filter((m) => m.kind === 'animal' && m.layer === 'foreground').length,
    16,
  );
  assert(CAVE_MURALS.every((m) => m.width < 7.5));
  assert(!CAVE_MURALS.some((m) => m.motif === 'comingSoon'));
});

// Painted after the r38 group friezes: hiding them reflows the continuous procession
// (r39+), so they have no animal replacement in the archived r38 composition.
const ADDED_AFTER_R38 = ['jank0vic'];

test('each r38 character has its own verified, transparent animal replacement', async () => {
  const characters = [
    '524',
    'rimo-neko',
    ...Object.values(CAVE_EXTRA_PIGMENTS).flatMap((p) => p.subjects),
  ];
  for (const id of ADDED_AFTER_R38) assert.ok(characters.includes(id), id);
  const slots = Object.values(recipe.panels).flatMap((p) => p.slots.map((s) => s.character));
  assert.deepEqual(slots.sort(), characters.filter((c) => !ADDED_AFTER_R38.includes(c)).sort());
  assert.equal(slots.length, 24);
  for (const panel of Object.values(recipe.panels)) {
    await exactBytes(panel.source.path, panel.source);
    const bytes = await exactBytes(panel.animals.path, panel.animals);
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height, metadata.hasAlpha], [1024, 341, true]);
    const stats = await sharp(bytes).stats();
    assert.equal(stats.channels[3].min, 0);
    assert(stats.channels[3].max > 200);
    const original = await readFile(`public${panel.original.url}`);
    assert.deepEqual(
      await composeMural(panel, []),
      original,
      'showing everyone retains original bytes',
    );
    assert.deepEqual(await composeMural(panel, ['unrelated-character']), original);
  }
  assert.throws(() => validateHidden(recipe, ['unknown']), /Unknown mural character/);
  assert.throws(() => validateHidden(recipe, ['524', '524']), /duplicate/);
});

test('removing any one character changes only its slot and preserves every visible neighbour', async () => {
  for (const [key, panel] of Object.entries(recipe.panels)) {
    const original = await raw(await readFile(`public${panel.original.url}`));
    // Use the SVG rasterizer as an independent oracle for protected silhouettes,
    // rather than asking the compositor's own mask function what it should keep.
    const silhouettes = await Promise.all(
      panel.slots.map(async (s) => ({
        character: s.character,
        pixels: await raw(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="341"><polygon points="${s.characterPolygon.map((p) => p.join(',')).join(' ')}" fill="white"/></svg>`,
          ),
        ),
      })),
    );
    for (const slot of panel.slots) {
      const hidden = [slot.character],
        output = await raw(await composeMural(panel, hidden));
      const xs = slot.polygon.map((p) => p[0]),
        ys = slot.polygon.map((p) => p[1]);
      const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      let changed = 0,
        protectedPixels = 0;
      for (let y = 0; y < 341; y++)
        for (let x = 0; x < 1024; x++) {
          const i = (y * 1024 + x) * 4,
            differs = !original.subarray(i, i + 4).equals(output.subarray(i, i + 4));
          if (
            x + 0.5 < bounds[0] ||
            x + 0.5 > bounds[2] ||
            y + 0.5 < bounds[1] ||
            y + 0.5 > bounds[3]
          )
            assert(
              !differs,
              `${key}/${slot.character}: changed outside selected slot at ${x},${y}`,
            );
          for (const other of silhouettes)
            if (other.character !== slot.character && other.pixels[i + 3] === 255) {
              assert(!differs, `${slot.character}: changed neighbour ${other.character}`);
              protectedPixels++;
            }
          changed += Number(differs);
        }
      assert(changed > 2000, `${slot.character}: no replacement artwork`);
      if (panel.slots.length > 1) assert(protectedPixels > 2000);
    }
    const all = panel.slots.map((s) => s.character);
    assert.deepEqual(
      await composeMural(panel, all),
      await composeMural(panel, [...all].reverse()),
      'order independent',
    );
  }
});

test('the operator command hides and restores one character, keeps manifests aligned and rejects bad IDs', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cro-mural-composition-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert(path.basename(root).startsWith('cro-mural-composition-'));
    await rm(root, { recursive: true, force: true });
  });
  const files = [
    MURAL_RECIPE,
    'cave-mural-visibility.json',
    'public/models/camp-cave/asset.json',
    'public/models/world-assets.json',
    ...Object.values(recipe.panels).flatMap((p) => [`public${p.original.url}`, p.animals.path]),
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await copyFile(file, path.join(root, file));
  }
  // Keep proving the old per-panel compositor on its actual archived inputs.
  // The current gallery uses the independently tested continuous operator.
  const legacy = await readJson('assets/camp-cave/continuous-r39/previous-asset.json');
  await writeFile(path.join(root, 'public/models/camp-cave/asset.json'), JSON.stringify(legacy));
  const legacyWorld = await readJson('public/models/world-assets.json');
  legacyWorld.assets[legacyWorld.assets.findIndex((a) => a.modelKey === 'camp-cave')] = legacy;
  await writeFile(path.join(root, 'public/models/world-assets.json'), JSON.stringify(legacyWorld));
  await writeFile(path.join(root, 'cave-mural-visibility.json'), '{"hidden":[]}\n');
  const run = (...args) =>
    promisify(execFile)(
      process.execPath,
      [path.resolve('scripts/compose-cave-murals.mjs'), ...args],
      { cwd: root, windowsHide: true },
    );
  const assetFile = path.join(root, 'public/models/camp-cave/asset.json');
  const before = await readJson(assetFile);
  await run('--hide', 'howkey-scientist');
  const after = await readJson(assetFile);
  assert.notEqual(
    before.mascotPigments.friendsRiver.sha256,
    after.mascotPigments.friendsRiver.sha256,
  );
  for (const key of Object.keys(before.mascotPigments))
    if (key !== 'friendsRiver')
      assert.deepEqual(after.mascotPigments[key], before.mascotPigments[key]);
  const world = await readJson(path.join(root, 'public/models/world-assets.json'));
  assert.deepEqual(
    world.assets.find((a) => a.modelKey === 'camp-cave'),
    after,
  );
  await run('--check');
  await assert.rejects(run('--show', 'no-such-character'), /Unknown mural character/);
  assert.deepEqual(await readJson(assetFile), after, 'failed request changes nothing');
  await run('--show', 'howkey-scientist');
  assert.deepEqual(await readJson(assetFile), before, 'restore original bytes and provenance');
  // A procession served as painted (not runtime-optimized) composes under its own name and
  // records its painting as the composition's original; showing it again drops that record.
  await run('--hide', 'daredaro');
  const hidden = (await readJson(assetFile)).mascotPigments.daredaroFrieze,
    painted = before.mascotPigments.daredaroFrieze;
  assert.equal(hidden.url, painted.url.replace('.png', '-hidden-daredaro.png'));
  assert.deepEqual(hidden.provenance, {
    muralComposition: {
      recipe: MURAL_RECIPE,
      baseSha256: painted.sha256,
      animalsSha256: recipe.panels.daredaroFrieze.animals.sha256,
      hidden: ['daredaro'],
      original: {
        url: painted.url,
        sha256: painted.sha256,
        bytes: painted.bytes,
        image: painted.image,
      },
    },
  });
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(root, `public${hidden.url}`)))
      .digest('hex'),
    hidden.sha256,
  );
  await run('--check');
  await run('--show', 'daredaro');
  assert.deepEqual(await readJson(assetFile), before, 'restore the painting and no provenance');
  // A damaged replacement must fail before either manifest or config changes.
  const animals = recipe.panels.friendsRiver.animals.path;
  await writeFile(path.join(root, animals), Buffer.alloc(10));
  await assert.rejects(run('--hide', 'howkey-scientist'), /byte length changed/);
  assert.deepEqual(await readJson(assetFile), before);
  assert.deepEqual(await readJson(path.join(root, 'cave-mural-visibility.json')), { hidden: [] });
});

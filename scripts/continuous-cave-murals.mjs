import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { buildCaveMurals, caveMuralImages } from '../dist/src/cave-gallery-layout.js';
import { CAVE_SUBJECT_ART } from '../dist/shared/cave-mural-art.mjs';
import { exactBytes } from './cave-mural-composition.mjs';

/** r39 visibility changes reflow the same measured sprites and independent
 * animals. The immutable atlas pixels and all credits remain unchanged. */
export async function runContinuousCaveMurals(args) {
  const assetPath = 'public/models/camp-cave/asset.json',
    worldPath = 'public/models/world-assets.json',
    configPath = 'cave-mural-visibility.json';
  const [assetText, worldText, configText] = await Promise.all(
    [assetPath, worldPath, configPath].map((p) => readFile(p, 'utf8')),
  );
  const asset = JSON.parse(assetText),
    world = JSON.parse(worldText),
    config = JSON.parse(configText);
  const hidden = new Set(config.hidden),
    known = CAVE_SUBJECT_ART.map((s) => s.id);
  const validate = (id) => assert(known.includes(id), `Unknown mural character: ${id}`);
  assert.equal(hidden.size, config.hidden.length, 'duplicate hidden character');
  [...hidden].forEach(validate);
  let preview,
    check = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') check = true;
    else if (arg === '--preview') {
      preview = args[++i];
      assert(preview, '--preview needs a directory');
    } else if (arg === '--hide' || arg === '--show') {
      const id = args[++i];
      validate(id);
      if (arg === '--hide') hidden.add(id);
      else hidden.delete(id);
    } else if (arg === '--all-animals') known.forEach((id) => hidden.add(id));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assert(!check || args.length === 1, '--check cannot change visibility');
  assert(!args.includes('--all-animals') || preview, '--all-animals is preview-only');
  const ids = [...hidden].sort(),
    murals = buildCaveMurals(CAVE_SUBJECT_ART, ids);
  const { extras, ...main } = caveMuralImages(asset);
  for (const record of [...Object.values(main), ...Object.values(extras)])
    await exactBytes(`public${record.url}`, record);
  const report = {
    recipe: asset.muralComposition.recipe,
    version: 2,
    hidden: ids,
    murals,
    mode: preview ? 'preview' : check ? 'check' : 'applied',
  };
  if (preview) {
    await mkdir(preview, { recursive: true });
    await writeFile(`${preview}/composition.json`, JSON.stringify(report, null, 2) + '\n');
    for (const [key, record] of [...Object.entries(main), ...Object.entries(extras)])
      await copyFile(`public${record.url}`, `${preview}/${key}.png`);
  } else if (check) {
    assert.deepEqual(asset.muralComposition.hidden, ids, 'visibility configuration not composed');
    assert.deepEqual(
      world.assets.find((a) => a.modelKey === 'camp-cave'),
      asset,
      'cave manifests differ',
    );
  } else {
    asset.muralComposition.hidden = ids;
    world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
    for (const [file, before] of [
      [assetPath, assetText],
      [worldPath, worldText],
      [configPath, configText],
    ])
      assert.equal(await readFile(file, 'utf8'), before, `${file} changed while composing`);
    for (const [file, data] of [
      [assetPath, asset],
      [worldPath, world],
      [configPath, { ...config, hidden: ids }],
    ])
      await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  }
  console.log(
    JSON.stringify({
      mode: report.mode,
      hidden: ids,
      characters: murals.filter((m) => m.kind === 'character').length,
      animals: murals.filter((m) => m.kind === 'animal').length,
    }),
  );
  return report;
}

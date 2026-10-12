// Example: npm run cave:murals -- --hide maruimo-mascot
// Restore: npm run cave:murals -- --show maruimo-mascot
// Preview only: npm run cave:murals -- --hide howkey-scientist --preview output/mural-preview
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MURAL_RECIPE,
  readJson,
  digest,
  entryAt,
  composeMural,
  validateHidden,
} from './cave-mural-composition.mjs';

const recipe = await readJson(MURAL_RECIPE);
const configPath = 'cave-mural-visibility.json';
const config = await readJson(configPath);
const hidden = new Set(validateHidden(recipe, config.hidden));
let preview,
  check = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--check') check = true;
  else if (arg === '--preview') preview = args[++i];
  else if (arg === '--hide' || arg === '--show') {
    const character = args[++i];
    validateHidden(recipe, [character]);
    if (arg === '--hide') hidden.add(character);
    else hidden.delete(character);
  } else if (arg === '--all-animals')
    for (const panel of Object.values(recipe.panels))
      for (const slot of panel.slots) hidden.add(slot.character);
  else throw new Error(`Unknown argument: ${arg}`);
}
validateHidden(recipe, [...hidden]);
assert.ok(!args.includes('--preview') || preview, '--preview needs a directory');
assert.ok(!args.includes('--all-animals') || preview, '--all-animals is preview-only');
assert.ok(!check || args.length === 1, '--check cannot change visibility');
const assetPath = 'public/models/camp-cave/asset.json';
const worldPath = 'public/models/world-assets.json';
const [assetText, worldText] = await Promise.all([
  readFile(assetPath, 'utf8'),
  readFile(worldPath, 'utf8'),
]);
const asset = JSON.parse(assetText),
  world = JSON.parse(worldText);
const report = { recipe: MURAL_RECIPE, hidden: [...hidden].sort(), panels: [] };
const writes = [];
for (const [key, panel] of Object.entries(recipe.panels)) {
  const current = entryAt(asset, panel.entry);
  assert.equal(
    current.provenance?.runtimeOptimization?.original.sha256,
    panel.original.provenance.runtimeOptimization.original.sha256,
    `${key}: source revised; review the recipe first`,
  );
  assert.ok(
    current.sha256 === panel.original.sha256 ||
      current.provenance?.muralComposition?.baseSha256 === panel.original.sha256,
    `${key}: newer artwork would be overwritten`,
  );
  const data = await composeMural(panel, [...hidden]);
  const sha256 = digest(data),
    changed = sha256 !== panel.original.sha256;
  const url = changed
    ? panel.original.provenance.runtimeOptimization.original.url.replace(
        '.png',
        `.opt-${sha256.slice(0, 16)}.png`,
      )
    : panel.original.url;
  const record = {
    ...current,
    url,
    sha256,
    bytes: data.length,
    provenance: structuredClone(panel.original.provenance),
  };
  if (changed)
    record.provenance.muralComposition = {
      recipe: MURAL_RECIPE,
      baseSha256: panel.original.sha256,
      animalsSha256: panel.animals.sha256,
      hidden: panel.slots.filter((s) => hidden.has(s.character)).map((s) => s.character),
    };
  report.panels.push({ key, url, sha256, bytes: data.length, changed });
  if (preview) {
    await mkdir(preview, { recursive: true });
    await writeFile(path.join(preview, `${key}.png`), data);
  } else if (check) {
    assert.equal(current.sha256, sha256, `${key}: visibility configuration not composed`);
    assert.equal(digest(await readFile(`public${url}`)), sha256, `${key}: delivered file mismatch`);
  } else {
    writes.push([`public${url}`, data]);
    Object.assign(current, record);
  }
}
if (preview)
  await writeFile(path.join(preview, 'composition.json'), JSON.stringify(report, null, 2) + '\n');
else if (!check) {
  // Prepare every output before changing the serving records, and reject any
  // concurrent manifest edit. Do not touch geometry, roster, credits or saves.
  assert.equal(
    await readFile(assetPath, 'utf8'),
    assetText,
    'camp-cave manifest changed while composing',
  );
  assert.equal(
    await readFile(worldPath, 'utf8'),
    worldText,
    'world manifest changed while composing',
  );
  for (const [file, data] of writes) await writeFile(file, data);
  world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
  for (const [file, data] of [
    [assetPath, asset],
    [worldPath, world],
    [configPath, { ...config, hidden: report.hidden }],
  ])
    await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}
console.log(
  JSON.stringify({ ...report, mode: preview ? 'preview' : check ? 'check' : 'applied' }, null, 2),
);

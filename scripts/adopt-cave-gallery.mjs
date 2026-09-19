import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const assetPath = 'public/models/camp-cave/asset.json';
const asset = JSON.parse(await readFile(assetPath));
const old = JSON.parse(await readFile('assets/camp-cave/mural-side-request.json'));
const record = async (file, prompt) => {
  const source = `assets/camp-cave/source/${file}`;
  const b = await readFile(source);
  assert.equal(hash(b), hash(await readFile(`public/models/camp-cave/${file}`)));
  return {
    url: `/models/camp-cave/${file}`,
    source,
    sha256: hash(b),
    bytes: b.length,
    image: { width: b.readUInt32BE(16), height: b.readUInt32BE(20) },
    generator: 'Built-in imagegen',
    prompt,
  };
};
asset.pigment = {
  ...(await record('mural-atlas-r05.png', 'assets/camp-cave/mural-atlas-prompt-r05.txt')),
  references: old.references,
  styleReference: 'assets/camp-cave/source/mural-side-r04.png',
  application:
    'Fourteen separate mural placements on east, west and rear walls; cat and 524 face each other across the chamber',
  layout: 'src/cave-gallery-layout.ts',
  review: 'assets/camp-cave/qa/gallery-r05.json',
  previous: { url: old.url, source: old.source, sha256: old.sha256 },
};
asset.rockSurface = {
  ...(await record('limestone-r05.png', 'assets/camp-cave/limestone-prompt-r05.txt')),
  application:
    '2.8m triplanar limestone colour and surface-gradient relief, mineral mottling and damp roughness',
  review: 'assets/camp-cave/qa/gallery-r05.json',
};
await save(assetPath, asset);
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === asset.modelKey)] = asset;
await save('public/models/world-assets.json', world);
await save('assets/camp-cave/gallery-request-r05.json', {
  date: '2026-09-19',
  request:
    '壁画を洞窟内の各所に分散し、猫と524は反対の壁へ。洞窟内部の岩肌の質感と忠実度を高める。',
  pigment: asset.pigment,
  rockSurface: asset.rockSurface,
  preservedModel: { url: asset.url, sha256: asset.sha256 },
});
console.log(JSON.stringify({ pigment: asset.pigment.url, rock: asset.rockSurface.url }));

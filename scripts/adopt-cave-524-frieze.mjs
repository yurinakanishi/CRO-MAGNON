// Keep original cave/model bytes and old art; register the unmodified pigment.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const source = 'assets/camp-cave/source/524-lascaux-frieze-r32.png';
const url = '/models/camp-cave/524-lascaux-frieze-r32.png';
const bytes = await readFile(source);
assert.equal(hash(bytes), hash(await readFile('public' + url)));
assert.equal(bytes[25], 6);
assert.equal(hash(await readFile('public' + asset.url)), asset.sha256);
if (asset.characterPigment.url !== url)
  await save('assets/camp-cave/archive-mural-r32.json', asset);
asset.galleryRevision = '32';
asset.characterPigment = {
  source,
  url,
  sha256: hash(bytes),
  bytes: bytes.length,
  image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  generator: 'Built-in imagegen',
  prompt: 'assets/camp-cave/524-lascaux-prompt-r32.txt',
  references: await Promise.all(
    [
      'assets/camp-cave/source/character-524-mural-r06.png',
      'assets/camp-cave/source/rimo-lascaux-frieze-r30.png',
      'assets/camp-cave/source/character-524-reference-user.png',
    ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
  ),
  subjects: ['524', 'woolly mammoth', 'ochre wild horse', 'red wild horse', 'aurochs'],
  application:
    'One 7.5 m wide transparent mineral-pigment frieze on the west wall opposite Rimo. The small floating 524 shares muted ochre, charcoal, worn edges and overlapping animal composition. Direct projection on original limestone triangles; no extra geometry or backing.',
  review: 'assets/camp-cave/qa/gallery-surfaces-r32.json',
};
asset.notes = asset.notes.filter(
  (n) => !n.startsWith('The separate transparent 524') && !n.startsWith('Gallery r32'),
);
asset.notes.push(
  'Gallery r32 integrates the faithful small 524 with a mammoth, two horses and an aurochs in one weathered transparent frieze, matching the opposite Rimo frieze. It replaces three separated west-wall placements. Earlier paintings and source models remain archived.',
);
asset.gameQA = 'output/playwright/cave-524-frieze-20261006/final-r02/summary.json';
await save('public/models/camp-cave/asset.json', asset);
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json'));
Object.assign(
  catalog.assets.find((a) => a.key === 'camp-cave'),
  {
    galleryRevision: asset.galleryRevision,
    gameQA: asset.gameQA,
  },
);
await save('assets/world-models.json', catalog);
console.log(JSON.stringify({ revision: asset.galleryRevision, pigment: asset.characterPigment }));

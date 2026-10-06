import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const source = 'assets/camp-cave/source/maruimo-lascaux-r33.png';
const url = '/models/camp-cave/maruimo-lascaux-r33.png';
const bytes = await readFile(source);
assert.equal(hash(bytes), hash(await readFile('public' + url)));
assert.equal(bytes[25], 6);
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
assert.equal(hash(await readFile('public' + asset.url)), asset.sha256);
if (asset.galleryRevision !== '33') await save('assets/camp-cave/archive-mural-r33.json', asset);
asset.galleryRevision = '33';
asset.gameQA = 'output/playwright/maruimo-mascot-20261007/mmo-assets-r03/summary.json';
asset.mascotPigments.maruimoFrieze = {
  source,
  url,
  sha256: hash(bytes),
  bytes: bytes.length,
  image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  generator: 'Built-in imagegen',
  prompt: 'assets/camp-cave/maruimo-lascaux-prompt-r33.txt',
  subjects: ['maruimo-mascot'],
  animals: ['bison', 'wild horse', 'deer'],
  references: await Promise.all(
    [
      'public/models/maruimo-octopus/portrait.png',
      'assets/camp-cave/source/rimo-lascaux-frieze-r30.png',
    ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
  ),
  application:
    '5 m wide east-wall frieze. The small octopus shares earth pigments and overlapping composition with the animals. Unmodified transparent PNG projected onto the original limestone triangles.',
  review: 'assets/camp-cave/qa/gallery-surfaces-r33.json',
};
asset.notes = asset.notes.filter((n) => !n.startsWith('Gallery r33'));
asset.notes.push(
  'Gallery r33 adds Maruimo among a bison, horse and deer. All 14 released mascots are represented; the Coming Soon reserve and original GLB remain unchanged.',
);
await save('public/models/camp-cave/asset.json', asset);
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json'));
catalog.assets.find((a) => a.key === 'camp-cave').galleryRevision = '33';
await save('assets/world-models.json', catalog);
console.log(JSON.stringify(asset.mascotPigments.maruimoFrieze));

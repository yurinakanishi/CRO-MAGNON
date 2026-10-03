// Register the pigment, not a replacement cave or pet model. Keep old revisions.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const source = 'assets/camp-cave/source/rimo-lascaux-frieze-r30.png';
const url = '/models/camp-cave/rimo-lascaux-frieze-r30.png';
const bytes = await readFile(source);
assert.equal(hash(bytes), hash(await readFile('public' + url)));
assert.equal(asset.sha256, '65dde1aa7311b88c159d524d93af82a770dac77e48ee1f35356e3000cad8a15f');
asset.galleryRevision = '30';
asset.rimoPigment = {
  source,
  url,
  sha256: hash(bytes),
  bytes: bytes.length,
  image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
  generator: 'Built-in imagegen',
  prompt: 'assets/camp-cave/rimo-lascaux-prompt-r30.txt',
  reference: {
    path: 'assets/rimo-neko/source/user-reference.jpg',
    sha256: hash(await readFile('assets/rimo-neko/source/user-reference.jpg')),
  },
  styleReference: 'assets/camp-cave/source/mural-atlas-r05.png',
  subjects: ['Rimo-neko', 'ochre wild horse', 'red wild horse', 'aurochs', 'red deer'],
  application:
    'One 7.5 x 2.5 m transparent pigment frieze on the east wall, centred at local Z -21.2 opposite the existing 524. Direct projection on the existing limestone, no decal plane or opaque backing.',
  review: 'assets/camp-cave/qa/gallery-r30.json',
};
asset.pigment.application =
  'Existing animal, hand and sign motifs frame the new Rimo/Lascaux frieze. Two east-wall animal placements are replaced by one continuous five-subject frieze; remaining twelve placements and the 524 scale are retained.';
asset.pigment.review = asset.rimoPigment.review;
asset.characterPigment.review = asset.rimoPigment.review;
asset.notes = asset.notes.filter(
  (n) => !n.startsWith('Fifteen wall paintings') && !n.startsWith('Gallery r30 restores'),
);
asset.notes.push(
  'Gallery r30 restores the user-reference waving gray-white Rimo cat among two horses, an aurochs and a deer, directly opposite the unchanged west-wall 524. The cave geometry, walking surface and fire are unchanged.',
);
asset.gameQA = 'output/cave-rimo-r30/game-review.json';
await save('public/models/camp-cave/asset.json', asset);
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json'));
const caveEntry = catalog.assets.find((a) => a.key === 'camp-cave');
caveEntry.gameQA = asset.gameQA;
caveEntry.galleryRevision = asset.galleryRevision;
await save('assets/world-models.json', catalog);
await save('assets/camp-cave/rimo-frieze-request-r30.json', {
  date: '2026-10-02',
  request:
    '洞窟のりもねこの壁画を高い再現度で復活し、524の反対側に、ラスコー風の動物たちへ自然に溶け込ませる。',
  pigment: asset.rimoPigment,
  preservedCave: { url: asset.url, sha256: asset.sha256 },
  preserved524: asset.characterPigment.sha256,
});
console.log(JSON.stringify({ revision: asset.galleryRevision, pigment: asset.rimoPigment }));

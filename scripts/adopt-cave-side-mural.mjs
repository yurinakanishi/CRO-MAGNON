import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const source = 'assets/camp-cave/source/mural-side-r04.png';
const url = '/models/camp-cave/mural-side-r04.png';
const bytes = await readFile(source);
assert.equal(hash(bytes), hash(await readFile(`public${url}`)));
assert.equal(bytes[25], 6, 'Keep the original generated RGBA transparency');
const path = 'public/models/camp-cave/asset.json';
const asset = JSON.parse(await readFile(path));
const previous = JSON.parse(await readFile('assets/camp-cave/mural-cats-request.json'));
const prompts = [
  'assets/camp-cave/mural-side-prompt-r03.txt',
  'assets/camp-cave/mural-side-prompt-r04.txt',
];
asset.pigment = {
  url,
  sha256: hash(bytes),
  bytes: bytes.length,
  source,
  generator: 'Built-in imagegen',
  prompts,
  references: previous.references,
  styleReferences: [
    'https://archeologie.culture.gouv.fr/lascaux/en/raw-materials',
    'https://archeologie.culture.gouv.fr/lascaux/en/construction-images',
  ],
  application:
    'Single east interior side-wall projection; cat and 524 among horses, bison and mammoth',
  widthMetres: 9,
  heightMetres: 3,
  projection: {
    horizontal: '(4.6-localZ)/9',
    vertical: '(localY-1.65)/3',
    side: 'localX < -3.25, inward normal +X',
  },
  review: 'assets/camp-cave/qa/mural-side-r04.json',
  previous: { url: previous.url, source: previous.source, sha256: previous.sha256 },
};
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === asset.modelKey)] = asset;
await save(path, asset);
await save('public/models/world-assets.json', world);
await save('assets/camp-cave/mural-side-request.json', {
  date: '2026-09-18',
  request:
    '奥の壁ではなく側面に移し、ラスコーの馬などの壁画の中へ猫と524を一緒に描き、歴史的な壁画のタッチへ合わせる。',
  ...asset.pigment,
  image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mode: 'RGBA' },
});
console.log(JSON.stringify({ url, sha256: asset.pigment.sha256, bytes: bytes.length }));

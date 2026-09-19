import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const source = 'assets/camp-cave/source/mural-cats-v2.png';
const url = '/models/camp-cave/mural-cats-r02.png';
const bytes = await readFile(source);
assert.equal(hash(bytes), hash(await readFile(`public${url}`)));
assert.equal(bytes[25], 6, 'RGBA PNG retains the generated transparency');
const references = [];
for (const name of ['cat-reference-user.png', 'character-524-reference-user.png']) {
  const path = `assets/camp-cave/source/${name}`;
  references.push({
    path,
    sha256: hash(await readFile(path)),
    role: 'User-provided subject reference',
  });
}
const path = 'public/models/camp-cave/asset.json';
const asset = JSON.parse(await readFile(path));
asset.pigment = {
  url,
  sha256: hash(bytes),
  bytes: bytes.length,
  source,
  generator: 'Built-in imagegen',
  prompt: 'assets/camp-cave/mural-cats-prompt.txt',
  references,
  application: 'Two large subjects projected onto the existing far interior wall triangles',
  widthMetres: 5,
  heightMetres: 2.0833,
  review: 'assets/camp-cave/qa/mural-cats-r02.json',
  previous: {
    url: '/models/camp-cave/mural.png',
    source: 'assets/camp-cave/source/mural-v1.png',
    sha256: '6cf92e8ddb0f90fa0a23f538e3e568e333c80b9498e52172aa46742a8517c20e',
  },
};
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((item) => item.modelKey === asset.modelKey)] = asset;
await save(path, asset);
await save('public/models/world-assets.json', world);
await save('assets/camp-cave/mural-cats-request.json', {
  date: '2026-09-18',
  request: '添付の猫と524のキャラクターを、洞窟最奥の壁画へ大きく描く。',
  ...asset.pigment,
  image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mode: 'RGBA' },
});
console.log(JSON.stringify(asset.pigment));

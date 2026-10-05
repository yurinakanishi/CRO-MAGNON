// Source PNGs are copied unchanged. Original 3D geometry and old art remain.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CAVE_EXTRA_PIGMENTS } from '../dist/src/cave-gallery-layout.js';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
asset.name = 'アプデの洞窟';
asset.galleryRevision = '31';
asset.mascotPigments = {};
for (const [key, entry] of Object.entries(CAVE_EXTRA_PIGMENTS)) {
  const source = 'assets/camp-cave/source/' + entry.url.split('/').at(-1);
  const bytes = await readFile(source);
  if (hash(bytes) !== hash(await readFile('public' + entry.url))) throw Error('Source mismatch');
  asset.mascotPigments[key] = {
    ...entry,
    source,
    sha256: hash(bytes),
    bytes: bytes.length,
    image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    generator: 'Built-in imagegen',
    references: entry.subjects.map((subject) =>
      subject === 'kohaku'
        ? 'public/models/kohaku/portrait-r05.png'
        : subject === 'mae'
          ? 'public/models/mae/portrait.png'
          : `public/models/orb-bot-${subject}/portrait.png`,
    ),
    application:
      'Unmodified transparent mineral-pigment frieze, projected on original cave wall triangles, interwoven with horses, aurochs and deer.',
  };
}
asset.notes = asset.notes.filter((note) => !note.startsWith('Gallery r31'));
asset.notes.push(
  'Gallery r31 includes all 13 released mascots among animal friezes. Cave placement is at ground level at the mountain foot near camp. Coming Soon is reserved for confirmed upcoming characters. The source cave GLB and earlier pigment files are retained.',
);
asset.gameQA = 'output/playwright/update-cave-20261005/summary.json';
await save('public/models/camp-cave/asset.json', asset);
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json'));
const cave = catalog.assets.find((a) => a.key === 'camp-cave');
Object.assign(cave, {
  name: asset.name,
  galleryRevision: asset.galleryRevision,
  gameQA: asset.gameQA,
});
await save('assets/world-models.json', catalog);
console.log(
  JSON.stringify({
    name: asset.name,
    revision: asset.galleryRevision,
    pigments: Object.keys(asset.mascotPigments),
  }),
);

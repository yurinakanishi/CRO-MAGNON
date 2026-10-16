// Add Ryuichi to the existing west-wall bay; keep the TRELLIS cave GLB and old artwork.
// Inputs are unmodified built-in image_gen outputs. Only delivery resizing uses sharp.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const directory = 'assets/camp-cave/ryuichi-frieze-r38';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function record(path) {
  const bytes = await readFile(path);
  const { width, height, hasAlpha } = await sharp(bytes).metadata();
  assert.ok(hasAlpha, path);
  return { path, sha256: hash(bytes), bytes: bytes.length, image: { width, height } };
}
const generated = await record(`${directory}/generated.png`);
assert.deepEqual(generated.image, { width: 2172, height: 724 });
const animals = await record(`${directory}/animals-generated.png`);
assert.deepEqual(animals.image, generated.image);
for (const [source, target] of [
  ['generated.png', 'paint.png'],
  ['animals-generated.png', 'animals.png'],
])
  await sharp(`${directory}/${source}`)
    .resize({ width: 1024 })
    .png()
    .toFile(`${directory}/${target}`);
const paint = await record(`${directory}/paint.png`);
const animalDelivery = await record(`${directory}/animals.png`);
assert.deepEqual(paint.image, { width: 1024, height: 341 });
const url = '/models/camp-cave/ryuichi-lascaux-r38.png';
await copyFile(paint.path, `public${url}`);
const assetPath = 'public/models/camp-cave/asset.json';
const asset = JSON.parse(await readFile(assetPath, 'utf8'));
assert.equal(asset.revision, '28-deep');
assert.equal(
  asset.sha256,
  hash(await readFile(`public${asset.url}`)),
  'retain verified cave geometry',
);
const archive = `${directory}/previous-asset.json`;
if (
  !(await access(archive).then(
    () => true,
    () => false,
  ))
)
  await save(archive, asset);
const references = await Promise.all(
  [`${directory}/reference-archived.jpg`, 'public/models/camp-cave/daredaro-lascaux-r37.png'].map(
    async (path) => ({ path, sha256: hash(await readFile(path)) }),
  ),
);
asset.mascotPigments.ryuichiFrieze = {
  url,
  subjects: ['ryuichi'],
  source: paint.path,
  sha256: paint.sha256,
  bytes: paint.bytes,
  image: paint.image,
  generator: 'Codex built-in image_gen',
  prompt: `${directory}/prompt.txt`,
  references,
  animals: ['woolly mammoth', 'prehistoric horse', 'aurochs'],
  application:
    'Gallery r38: west-wall bay opposite daredaro, centre Z=-37.0, bottom Y=1.4, width 7.5 m, strength 0.84. Mineral pigment projected onto the retained limestone triangles.',
  generated: { ...generated, resize: 'whole image, sharp Lanczos-3, 2172x724 to 1024x341' },
  review: 'assets/camp-cave/qa/gallery-pigment-coverage-r38.json',
};
const recipe = JSON.parse(await readFile('assets/camp-cave/modular-r37/recipe.json', 'utf8'));
recipe.generator += '; r38 panel: Codex built-in image_gen';
recipe.panels.ryuichiFrieze = {
  entry: 'mascotPigments.ryuichiFrieze',
  original: structuredClone(asset.mascotPigments.ryuichiFrieze),
  source: animals,
  animals: animalDelivery,
  slots: [
    {
      character: 'ryuichi',
      feather: 4,
      polygon: [
        [407, 124],
        [503, 121],
        [525, 188],
        [523, 314],
        [425, 316],
        [420, 237],
      ],
      characterPolygon: [
        [412, 142],
        [475, 126],
        [496, 139],
        [499, 166],
        [478, 198],
        [506, 230],
        [510, 275],
        [518, 290],
        [513, 305],
        [488, 304],
        [470, 285],
        [454, 306],
        [430, 304],
        [432, 274],
        [427, 246],
        [426, 206],
        [413, 189],
      ],
    },
  ],
};
await mkdir('assets/camp-cave/modular-r38', { recursive: true });
await save('assets/camp-cave/modular-r38/recipe.json', recipe);
asset.galleryRevision = '38';
asset.muralComposition = {
  ...asset.muralComposition,
  recipe: 'assets/camp-cave/modular-r38/recipe.json',
  characters: 24,
};
const note =
  'Gallery r38 adds the helmeted Ryuichi-typeR among a mammoth, horse and aurochs on the existing deep west-wall bay, completing the shared 16-person contributor cast (nine Dots share one credit). Yuri remains a creator credit only. Geometry, earlier paintings and mascot availability are retained.';
if (!asset.notes.includes(note)) asset.notes.unshift(note);
await save(assetPath, asset);
const worldPath = 'public/models/world-assets.json';
const world = JSON.parse(await readFile(worldPath, 'utf8'));
world.assets[world.assets.findIndex((entry) => entry.modelKey === 'camp-cave')] = asset;
await save(worldPath, world);
const catalogPath = 'assets/world-models.json';
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
catalog.assets.find((entry) => entry.key === 'camp-cave').galleryRevision = '38';
await save(catalogPath, catalog);
await save(`${directory}/generation.json`, {
  date: '2026-10-16',
  generator: 'Codex built-in image_gen',
  prompts: [`${directory}/prompt.txt`, `${directory}/animals-prompt.txt`],
  references,
  generated,
  animals,
  delivery: paint,
  animalDelivery,
  geometry: { url: asset.url, sha256: asset.sha256 },
});
console.log(JSON.stringify({ url, sha256: paint.sha256, bytes: paint.bytes, image: paint.image }));

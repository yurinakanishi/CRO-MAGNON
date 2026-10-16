// Technical cropping/packing of reviewed image_gen cutouts, never drawn artwork.
// A new character needs one recipe entry; source hashes and capacity are checked
// before any serving record changes. Older art and all 3D bytes remain intact.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { format, resolveConfig } from 'prettier';
import { digest, exactBytes, entryAt } from './cave-mural-composition.mjs';
import { extractMuralSprite } from './cave-mural-sprite.mjs';
const formatting = { ...(await resolveConfig('src/cave-gallery-layout.ts')), parser: 'typescript' };
const check = process.argv.includes('--check');
const assetPath = 'public/models/camp-cave/asset.json',
  worldPath = 'public/models/world-assets.json';
const assetText = await readFile(assetPath, 'utf8'),
  worldText = await readFile(worldPath, 'utf8');
const asset = JSON.parse(assetText),
  world = JSON.parse(worldText);
const recipePath =
  process.argv.find((arg) => arg.startsWith('--recipe='))?.slice('--recipe='.length) ??
  (asset.muralComposition?.version === 2 ? asset.muralComposition.recipe : undefined) ??
  'assets/camp-cave/continuous-r39/recipe.json';
assert(
  /^assets\/camp-cave\/[a-z0-9-]+\/recipe\.json$/.test(recipePath),
  'recipe must be a versioned camp-cave asset',
);
const root = recipePath.slice(0, recipePath.lastIndexOf('/'));
const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
const revision = String(recipe.revision ?? asset.galleryRevision);
assert(/^\d+$/.test(revision) && Number(revision) >= 39, 'record the new gallery revision');
assert(Object.keys(recipe.atlases).length <= 10, 'keep the existing ten-atlas mobile budget');
const sourceBytes = new Map();
for (const [key, source] of Object.entries(recipe.sources))
  sourceBytes.set(key, await exactBytes(source.path, source));
const ids = recipe.subjects.map((s) => s.id);
assert.equal(new Set(ids).size, ids.length, 'duplicate character ID');
const writes = [],
  subjects = [],
  animals = [];
const transparent = (width, height) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
for (const [key, atlas] of Object.entries(recipe.atlases)) {
  const group = [...recipe.subjects, ...recipe.animals].filter((s) => s.atlas === key);
  assert(
    group.length > 0 && group.length <= 5,
    `${key}: atlas capacity is 5; use another recorded atlas`,
  );
  const cutouts = [];
  for (const subject of group) {
    assert(sourceBytes.has(subject.source), `${subject.id}: unknown source`);
    const [x0, y0, x1, y1] = subject.crop;
    const image = await extractMuralSprite(sourceBytes.get(subject.source), subject);
    let left = image.info.width,
      top = image.info.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < image.info.height; y++)
      for (let x = 0; x < image.info.width; x++)
        if (image.data[(y * image.info.width + x) * 4 + 3] >= 24) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    assert(right > left && bottom > top, `${subject.id}: no pigment`);
    let edgeInk = 0;
    for (let y = 0; y < image.info.height; y++)
      for (let x = 0; x < image.info.width; x++)
        if (
          (x < 2 || y < 2 || x >= image.info.width - 2 || y >= image.info.height - 2) &&
          image.data[(y * image.info.width + x) * 4 + 3] >= 64
        )
          edgeInk++;
    assert(edgeInk < 12, `${subject.id}: clipped source crop (${edgeInk} edge pixels)`);
    // Keep the entire reviewed crop, including its generated soft alpha edge.
    const bodyTop = subject.bodyTop === undefined ? top : subject.bodyTop - y0;
    const bodyBottom = subject.bodyBottom === undefined ? bottom + 1 : subject.bodyBottom - y0;
    assert(bodyTop >= top && bodyTop < bodyBottom, `${subject.id}: invalid body crown`);
    assert(bodyBottom <= bottom + 1 && bodyBottom > top, `${subject.id}: invalid body foot`);
    cutouts.push({
      subject,
      image,
      span: bodyBottom - bodyTop,
      foot: bodyBottom,
      ink: [left, top, right + 1, bottom + 1],
    });
  }
  const desiredHeight = 300,
    gutter = 12;
  const desiredWidth = cutouts.reduce(
    (n, c) => n + (c.image.info.width * desiredHeight) / c.image.info.height,
    0,
  );
  const fit = Math.min(1, (1024 - gutter * (cutouts.length + 1)) / desiredWidth);
  assert(desiredHeight * fit >= 180, `${key}: cutouts would fall below 180 px; use another atlas`);
  const composites = [];
  let cursor = gutter;
  for (const c of cutouts) {
    const height = Math.floor(desiredHeight * fit),
      width = Math.floor((c.image.info.width * height) / c.image.info.height);
    const data = await sharp(c.image.data, { raw: c.image.info })
      .resize(width, height)
      .png()
      .toBuffer();
    const left = cursor,
      top = Math.floor((341 - height) / 2);
    composites.push({ input: data, left, top });
    cursor += width + gutter;
    (recipe.animals.includes(c.subject) ? animals : subjects).push({
      id: c.subject.id,
      motif: key,
      size: c.subject.size,
      lift: c.subject.lift ?? 0,
      // Normalised to the atlas's entire image, independent of whole-image resizes.
      rect: [left / 1024, top / 341, width / 1024, height / 341],
      aspect: c.image.info.width / c.image.info.height,
      bodySpan: c.span / c.image.info.height,
      foot: c.foot / c.image.info.height,
      ink: c.ink.map((v, i) => v / (i % 2 ? c.image.info.height : c.image.info.width)),
      source: c.subject.source,
      sourceCrop: c.subject.crop,
    });
  }
  assert(cursor <= 1024, `${key}: packed atlas overflow`);
  const data = await transparent(1024, 341).composite(composites).png().toBuffer();
  const sha256 = digest(data),
    slug = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
    current = entryAt(asset, atlas.entry),
    url =
      current.sha256 === sha256
        ? current.url
        : `/models/camp-cave/${slug}-sprites-r${revision}-${sha256.slice(0, 16)}.png`;
  const packedSource = `${root}/packed/${key}-${sha256.slice(0, 16)}.png`;
  const record = {
    ...current,
    url,
    sha256,
    bytes: data.length,
    image: { width: 1024, height: 341 },
    source: packedSource,
    generator: 'Built-in image_gen',
    prompts: [...new Set(group.map((s) => recipe.sources[s.source].prompt))],
    review: `assets/camp-cave/qa/adoption-murals-r${revision}.json`,
    subjects: group.filter((s) => recipe.subjects.includes(s)).map((s) => s.id),
    application: `r${revision}: independent character cutouts; physical scale and continuous placement come from shared/cave-mural-art.mts, not the atlas frame.`,
    provenance: {
      continuousMural: {
        version: 2,
        recipe: `${root}/recipe.json`,
        subjects: group.filter((s) => recipe.subjects.includes(s)).map((s) => s.id),
        sources: [...new Set(group.map((s) => recipe.sources[s.source].sha256))],
      },
    },
  };
  delete record.uvSource;
  delete record.generated;
  // Do not inherit an obsolete pre-edit prompt from the old group painting.
  delete record.prompt;
  delete current.uvSource;
  delete current.generated;
  delete current.prompt;
  Object.assign(current, record);
  writes.push([`public${url}`, data]);
  writes.push([packedSource, data]);
}
// Preserve recipe order, regardless of which atlas owns the artwork.
subjects.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
const compiled = await format(
  '// Generated by scripts/build-cave-mural-sprites.mjs; edit the reviewed recipe.\nexport const CAVE_SUBJECT_ART = ' +
    JSON.stringify(subjects, null, 2) +
    ' as const;\nexport const CAVE_ANIMAL_ART = ' +
    JSON.stringify([...recipe.recordedAnimalArt, ...animals], null, 2) +
    ' as const;\n',
  formatting,
);
const layoutPath = 'src/cave-gallery-layout.ts',
  layoutText = await readFile(layoutPath, 'utf8');
const extras = {};
for (const [key, a] of Object.entries(recipe.atlases))
  if (a.entry.startsWith('mascotPigments.'))
    extras[key] = {
      url: entryAt(asset, a.entry).url,
      subjects: recipe.subjects.filter((s) => s.atlas === key).map((s) => s.id),
    };
const layout = await format(
  layoutText.replace(
    /export const CAVE_EXTRA_PIGMENTS = \{[\s\S]*?\} as const;/,
    'export const CAVE_EXTRA_PIGMENTS = ' + JSON.stringify(extras, null, 2) + ' as const;',
  ),
  formatting,
);
asset.galleryRevision = revision;
asset.muralComposition = {
  recipe: `${root}/recipe.json`,
  version: 2,
  hidden: JSON.parse(await readFile('cave-mural-visibility.json', 'utf8')).hidden,
};
if (!asset.notes[0].startsWith(`Gallery r${revision}`))
  asset.notes.unshift(
    `Gallery r${revision} uses independently measured pigment cutouts, common character/animal scales and one continuous surface-distance procession on each wall. Previous art and unchanged TRELLIS geometry remain archived.`,
  );
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
assert.equal(await readFile(assetPath, 'utf8'), assetText, 'cave manifest changed during packing');
assert.equal(await readFile(worldPath, 'utf8'), worldText, 'world manifest changed during packing');
if (check) {
  for (const [file, data] of writes)
    assert((await readFile(file)).equals(data), `${file}: rebuild the mural sprites`);
  assert.equal(
    await readFile('shared/cave-mural-art.mts', 'utf8'),
    compiled,
    'stale mural art registry',
  );
  assert.equal(layoutText, layout, 'stale atlas URL table');
  assert.equal(assetText, JSON.stringify(asset, null, 2) + '\n', 'stale cave manifest');
  assert.equal(worldText, JSON.stringify(world, null, 2) + '\n', 'stale world manifest');
  console.log('Continuous mural art, source hashes, packing, registry and serving records passed.');
  process.exit(0);
}
await mkdir(`${root}/packed`, { recursive: true });
for (const [file, data] of writes) await writeFile(file, data);
await writeFile('shared/cave-mural-art.mts', compiled);
assert.equal(await readFile(layoutPath, 'utf8'), layoutText, 'layout changed during packing');
await writeFile(layoutPath, layout);
await writeFile(assetPath, JSON.stringify(asset, null, 2) + '\n');
await writeFile(worldPath, JSON.stringify(world, null, 2) + '\n');
const modelsPath = 'assets/world-models.json',
  models = JSON.parse(await readFile(modelsPath, 'utf8'));
models.assets.find((a) => a.key === 'camp-cave').galleryRevision = revision;
await writeFile(modelsPath, JSON.stringify(models, null, 2) + '\n');
await mkdir(`${root}/qa`, { recursive: true });
await writeFile(
  `${root}/qa/packing.json`,
  JSON.stringify(
    {
      recipe: `${root}/recipe.json`,
      textures: writes.map(([path, data]) => ({ path, sha256: digest(data), bytes: data.length })),
      subjects,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    atlases: writes.length / 2,
    subjects: subjects.length,
    bytes: writes.reduce((n, [, d]) => n + d.length, 0) / 2,
  }),
);

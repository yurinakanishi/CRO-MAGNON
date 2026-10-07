// Register the two contributor friezes in the camp cave records (r34; r35 adds Rei to the river frieze).
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const ref = (key) => `assets/friend-mascots/${key}/source/reference-v1.png`;
const STYLE = 'public/models/camp-cave/mae-kohaku-lascaux-r31.png';
const FRIEZES = {
  friendsMeadow: {
    file: 'friends-meadow-lascaux-r34.png',
    prompt: 'assets/camp-cave/friends-meadow-lascaux-prompt-r34.txt',
    subjects: ['saber-mascot', 'fairy-mascot', 'nukonuko-mascot', 'sagasa-mascot'],
    animals: ['wild horse', 'ibex', 'red deer stag'],
    references: [
      ref('saber-mascot'),
      ref('fairy-mascot'),
      ref('nukonuko-mascot'),
      ref('sagasa-mascot'),
      STYLE,
    ],
    application:
      '5.6 m wide west-wall frieze replacing the lone deer: Saber, Fairy, nukonuko and Saga among a horse, an ibex and a stag. Unmodified transparent PNG projected onto the original limestone triangles.',
  },
  friendsRiver: {
    file: 'friends-river-lascaux-r35.png',
    prompt: 'assets/camp-cave/friends-river-lascaux-prompt-r35.txt',
    subjects: ['otani-mascot', 'urata-mascot', 'howkey-scientist', 'rei-mascot'],
    animals: ['aurochs', 'bison', 'wild horse'],
    references: [
      ref('otani-mascot'),
      ref('urata-mascot'),
      'public/models/howkey-scientist/portrait.png',
      ref('rei-mascot'),
      'assets/camp-cave/source/friends-river-lascaux-r34.png',
      STYLE,
    ],
    application:
      '5 m wide west-wall frieze replacing the lone bison: the Otani duck, Urata, Howkey with her Erlenmeyer flask and Rei-chan with a book among an aurochs, a bison and a horse (r35 repaints r34 to add Rei). Unmodified transparent PNG projected onto the original limestone triangles.',
  },
};
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
assert.equal(hash(await readFile('public' + asset.url)), asset.sha256);
const REVISION = '35';
if (asset.galleryRevision !== REVISION)
  await save(`assets/camp-cave/archive-mural-r${REVISION}.json`, asset);
asset.galleryRevision = REVISION;
for (const [key, f] of Object.entries(FRIEZES)) {
  const source = `assets/camp-cave/source/${f.file}`,
    url = `/models/camp-cave/${f.file}`;
  const bytes = await readFile(source);
  assert.equal(hash(bytes), hash(await readFile('public' + url)));
  assert.equal(bytes[25], 6, `${f.file} must be RGBA`);
  asset.mascotPigments[key] = {
    source,
    url,
    sha256: hash(bytes),
    bytes: bytes.length,
    image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    generator: 'Codex CLI 0.162.0-alpha.2 built-in image_gen (configured default model)',
    prompt: f.prompt,
    subjects: f.subjects,
    animals: f.animals,
    references: await Promise.all(
      f.references.map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
    ),
    application: f.application,
    review: `assets/camp-cave/qa/gallery-surfaces-r${REVISION}.json`,
  };
}
asset.notes = asset.notes.filter((n) => !n.startsWith('Gallery r35'));
asset.notes.push(
  'Gallery r35 repaints the west-wall river procession to add Rei-chan beside the Otani duck, Urata and Howkey; the r34 friezes (Saber, Fairy, nukonuko, Saga; duck, Urata, Howkey) replaced the lone deer and bison. The original GLB is unchanged.',
);
await save('public/models/camp-cave/asset.json', asset);
const world = JSON.parse(await readFile('public/models/world-assets.json'));
world.assets[world.assets.findIndex((a) => a.modelKey === 'camp-cave')] = asset;
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json'));
catalog.assets.find((a) => a.key === 'camp-cave').galleryRevision = REVISION;
await save('assets/world-models.json', catalog);
console.log(JSON.stringify(Object.keys(FRIEZES).map((k) => [k, asset.mascotPigments[k].sha256])));

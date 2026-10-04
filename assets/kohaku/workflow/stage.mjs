// Register this task's exact GLB. Tests and browser validation are intentionally
// omitted at the user's request; do not label the asset as game-QA approved.
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, value) => writeFile(p, JSON.stringify(value, null, 2) + '\n');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const revision = process.argv[2] ?? '01';
const base = `output/model-generation/models/kohaku/work/rig/revision-${revision}/`;
const rig = await read(base + 'rig.json');
const bytes = await readFile(base + 'candidate.glb'),
  lod = await readFile(base + 'lod.glb');
const reference = 'assets/kohaku/source/reference-v2.png';
const portrait = await readFile(reference);
const world = await read('public/models/world-assets.json'),
  catalog = await read('assets/world-models.json');
const previous = world.assets.find((a) => a.modelKey === 'kohaku');
if (previous && Number(previous.revision) >= Number(revision))
  throw new Error('Use a new revision; preserve previous adoptions');
const destination = 'public/models/kohaku';
await mkdir(destination, { recursive: true });
await copyFile(
  'public/models/world-assets.json',
  `output/kohaku-before/world-assets-before-r${revision}.json`,
  constants.COPYFILE_EXCL,
);
await copyFile(
  'assets/world-models.json',
  `output/kohaku-before/world-models-before-r${revision}.json`,
  constants.COPYFILE_EXCL,
);
for (const [source, target] of [
  [base + 'candidate.glb', `model-r${revision}.glb`],
  [base + 'lod.glb', `lod-r${revision}.glb`],
  [reference, `portrait-r${revision}.png`],
])
  await copyFile(source, destination + '/' + target, constants.COPYFILE_EXCL);
const asset = {
  modelKey: 'kohaku',
  name: 'こはくちゃん',
  kind: 'companion',
  candidate: 1,
  revision,
  status: 'integrated-unverified',
  url: `/models/kohaku/model-r${revision}.glb`,
  sha256: sha(bytes),
  bytes: bytes.length,
  triangles: rig.triangles,
  bones: rig.bones.length,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: rig.heightMetres,
  widthMetres: rig.widthMetres,
  lengthMetres: rig.lengthMetres,
  placement: { pivot: 'ground-between-shoes', scale: 1 },
  portrait: { url: `/models/kohaku/portrait-r${revision}.png`, sha256: sha(portrait) },
  clips: rig.clips,
  locomotion: rig.locomotion,
  lods: [
    {
      url: `/models/kohaku/lod-r${revision}.glb`,
      sha256: sha(lod),
      bytes: lod.length,
      triangles: rig.lod.triangles,
      distanceMetres: 8,
      purpose: 'source-derived animated geometry; same rig and original materials',
    },
  ],
  provenance: {
    provider:
      'Codex built-in imagegen; local TRELLIS-2; source-preserving reduction; body-specific biped rig',
    claudeUsed: false,
    referenceImage: reference,
    referenceSha256: sha(portrait),
    userReference: 'assets/kohaku/source/kohaku-poses.jpg',
    userReferenceSha256: sha(await readFile('assets/kohaku/source/kohaku-poses.jpg')),
    denseSha256: rig.sourceSha256,
    reconstruction:
      'TRELLIS-2 v0.8.1 CUDA, RTX A1000 6GB, resolution512, seed42, supplied alpha, atlas4096',
    source: base + 'candidate.glb',
    sourceSha256: sha(bytes),
    sourceUvAndAlbedoPreserved: true,
    surfaceRepair: rig.cuffRepair ?? null,
  },
  notes: [
    'Height matches the current rimo-neko asset exactly. One independent pettable mascot, not a selectable player.',
    'Petting starts the persistent bond. Eight authored clips, including pose-sheet wave and bow; head, skirt, ears and tail have dedicated joints.',
    'Unit tests and browser/game validation were not run, following the user instruction. Production renders are retained separately.',
  ],
};
await save(destination + '/asset.json', asset);
if (previous) world.assets[world.assets.indexOf(previous)] = asset;
else world.assets.push(asset);
const entry = {
  key: 'kohaku',
  name: 'こはくちゃん',
  kind: 'companion',
  height: rig.heightMetres,
  geometryResolution: 512,
  referenceVersion: 2,
  status: asset.status,
  sha256: asset.sha256,
  delivery: asset.url,
  subject:
    'Chibi cat-eared girl mascot with cyan eyes, dark bob and cyan ribbons, black-white dress, striped tail; based on the supplied Kohaku pose sheet.',
};
const previousIndex = catalog.assets.findIndex((a) => a.key === 'kohaku');
if (previousIndex >= 0) catalog.assets[previousIndex] = entry;
else catalog.assets.push(entry);
await save('public/models/world-assets.json', world);
await save('assets/world-models.json', catalog);
await save('assets/kohaku/delivery.json', {
  ...asset,
  testsRun: false,
  browserValidationRun: false,
});
console.log(
  JSON.stringify({
    url: asset.url,
    sha256: asset.sha256,
    triangles: asset.triangles,
    bones: asset.bones,
    clips: asset.clips.length,
    height: asset.heightMetres,
  }),
);

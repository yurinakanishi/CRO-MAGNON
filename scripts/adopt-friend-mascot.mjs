// Publish one rigged friend mascot: GLB, LOD, portrait and catalog records.
// node scripts/adopt-friend-mascot.mjs <key> <rigRevision> [qa summary path]
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [key, revision, review = null] = process.argv.slice(2);
assert.ok(key && revision, 'usage: adopt-friend-mascot.mjs <key> <rigRevision>');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const work = `output/model-generation/models/${key}/work`;
const rig = JSON.parse(await readFile(`${work}/rig/revision-${revision}/rig.json`, 'utf8'));
const surfaceDir = `${work}/surface/revision-${rig.surfaceRevision}`;
const surface = JSON.parse(await readFile(`${surfaceDir}/surface.json`, 'utf8'));
const dense = JSON.parse(await readFile(surface.source.replace(/\.glb$/, '.json'), 'utf8'));
const reference = `assets/friend-mascots/${key}/source/reference-v1.png`;
const config = JSON.parse(await readFile(`assets/friend-mascots/${key}/rig.json`, 'utf8'));
const out = `public/models/${key}`;
await mkdir(out, { recursive: true });
const files = {
  model: [`${work}/rig/revision-${revision}/candidate.glb`, `${out}/model-r${revision}.glb`],
  lod: [`${work}/rig/revision-${revision}/lod.glb`, `${out}/lod-r${revision}.glb`],
};
// The selection card shows the reference itself, downscaled to 480 px tall (PNG, alpha kept).
execFileSync('python', [
  '-c',
  'import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert("RGBA");b=i.getbbox();i=i.crop(b);h=480;i.resize((round(i.width*h/i.height),h),Image.LANCZOS).save(sys.argv[2],optimize=True)',
  reference,
  `${out}/portrait.png`,
]);
const delivered = {};
for (const [name, [from, to]] of Object.entries(files)) {
  await copyFile(from, to);
  const bytes = await readFile(to);
  assert.equal(hash(bytes), hash(await readFile(from)));
  delivered[name] = { url: to.replace(/^public/, ''), sha256: hash(bytes), bytes: bytes.length };
}
{
  const bytes = await readFile(`${out}/portrait.png`);
  delivered.portrait = {
    url: `/models/${key}/portrait.png`,
    sha256: hash(bytes),
    bytes: bytes.length,
  };
}
const glb = await readFile(files.model[1]);
const doc = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)));
const triangles = doc.meshes.reduce(
  (n, m) => n + m.primitives.reduce((k, p) => k + doc.accessors[p.indices].count / 3, 0),
  0,
);
assert.deepEqual(doc.animations.map((a) => a.name).sort(), [
  'Bow',
  'Happy',
  'Hit',
  'Idle_Loop',
  'Pet',
  'Run_Loop',
  'Walk_Loop',
  'Wave',
]);
assert.ok(
  doc.nodes.some((n) => n.name === 'PetContact'),
  'PetContact socket',
);
const asset = {
  modelKey: key,
  name: config.name ?? key,
  kind: 'companion',
  candidate: 1,
  revision: `r${revision}`,
  status: 'friend-mascot-integrated',
  url: delivered.model.url,
  sha256: delivered.model.sha256,
  bytes: delivered.model.bytes,
  triangles,
  bones: rig.bones.length,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: surface.heightMetres,
  widthMetres: surface.widthMetres,
  lengthMetres: surface.lengthMetres,
  petContactMetres: rig.petContactHeight,
  placement: { pivot: 'ground-between-shoes', scale: 1 },
  portrait: { url: delivered.portrait.url, sha256: delivered.portrait.sha256 },
  clips: rig.clips,
  locomotion: rig.locomotion,
  lods: [
    {
      url: delivered.lod.url,
      sha256: delivered.lod.sha256,
      bytes: delivered.lod.bytes,
      triangles: rig.lod.triangles,
      distanceMetres: 8,
      purpose: 'animated-medium-lod-geometry',
    },
  ],
  provenance: {
    provider: 'Claude Code (Opus 5.5)',
    claudeUsed: true,
    referenceGenerator:
      'Codex CLI 0.162.0-alpha.2 built-in image_gen (configured default model, unelevated sandbox); request and prompt saved beside the reference',
    referenceImage: reference,
    referenceSha256: hash(await readFile(reference)),
    identitySources: config.identitySources ?? [],
    reconstruction: `Local TRELLIS-2 v0.8.1, res ${dense.resolution}, tex ${dense.texture_resolution}, seed ${dense.seed}`,
    denseSha256: dense.output.sha256,
    reduction:
      'meshoptimizer position-only quadric reduction of the dense surface; fresh Smart UV; 2048 diffuse-colour bake from the dense TRELLIS albedo (Blender 3.6 Cycles, selected to active)',
    deviationMetres: surface.deviationMetres,
    surfaceSha256: surface.sha256,
    rig: 'assets/friend-mascots/workflow/rig.py with assets/friend-mascots/' + key + '/rig.json',
    rigSha256: rig.sha256,
    pipeline: 'assets/friend-mascots/README.md',
    visualReview: review,
  },
  notes: [
    `Contributor companion. ${triangles} triangles, ${rig.bones.length} bones, 8 in-place 60 fps clips; LOD ${rig.lod.triangles} triangles shares the skeleton from 8 m. Lowest authored vertex ${rig.lowestAuthoredVertexMetres.toFixed(4)} m.`,
  ],
};
await save(`${out}/asset.json`, asset);
const world = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
const at = world.assets.findIndex((a) => a.modelKey === key);
if (at >= 0) world.assets[at] = asset;
else world.assets.push(asset);
await save('public/models/world-assets.json', world);
const catalog = JSON.parse(await readFile('assets/world-models.json', 'utf8'));
const entry = {
  key,
  name: asset.name,
  kind: 'companion',
  height: asset.heightMetres,
  geometryResolution: dense.resolution,
  referenceVersion: 1,
  status: asset.status,
  sha256: asset.sha256,
  delivery: asset.url,
  subject: config.subject ?? '',
};
const c = catalog.assets.findIndex((a) => a.key === key);
if (c >= 0) catalog.assets[c] = entry;
else catalog.assets.push(entry);
await save('assets/world-models.json', catalog);
console.log(
  JSON.stringify({
    key,
    triangles,
    lod: rig.lod.triangles,
    height: asset.heightMetres,
    petContact: asset.petContactMetres,
    bytes: asset.bytes,
  }),
);

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = process.argv[2] || '03',
  base = 'output/model-generation/models/rimo-neko';
const source = `${base}/work/rig/revision-${revision}/candidate.glb`,
  bytes = await readFile(source),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  sha256 = sha(bytes);
const rig = JSON.parse(
  await readFile(`${base}/work/rig/revision-${revision}/process.json`, 'utf8'),
);
const qa = JSON.parse(await readFile(`${base}/qa/rig-${revision}/browser/result.json`, 'utf8'));
assert.equal(qa.sourceSha256, sha256);
assert.deepEqual(qa.errors, []);
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
assert.ok(doc.nodes.some((n) => n.name === 'PetContact'));
assert.equal(doc.animations.length, 7);
const triangles = doc.meshes
  .flatMap((m) => m.primitives)
  .reduce((n, p) => n + doc.accessors[p.indices].count / 3, 0);
const folder = 'public/models/rimo-neko';
await mkdir(folder, { recursive: true });
await copyFile(source, `${folder}/model-r${revision}.glb`);
const write = (file, obj) => writeFile(file, JSON.stringify(obj, null, 2) + '\n');
// Older rig records give authored speed; revisions with exported speed already
// account for the quantized frame duration and must not be rescaled twice.
const locomotion = structuredClone(rig.locomotion);
if (!rig.locomotionSpeedIsExported)
  for (const [clip, gait] of Object.entries(locomotion)) {
    const seconds = gait.authoredCycleSeconds ?? (clip === 'Walk_Loop' ? 0.68 : 0.48);
    gait.metresPerSecond *= seconds / gait.cycleSeconds;
  }
const record = {
  modelKey: 'rimo-neko',
  name: 'リモねこ',
  kind: 'companion',
  candidate: 1,
  status: 'reviewed-prototype',
  url: `/models/rimo-neko/model-r${revision}.glb`,
  sha256,
  bytes: bytes.length,
  triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: rig.heightMetres,
  widthMetres: rig.widthMetres,
  lengthMetres: rig.lengthMetres,
  placement: { pivot: 'ground-between-four-paws', scale: 1 },
  clips: rig.clips,
  locomotion,
  lods: [],
  provenance: {
    provider:
      'Codex imagegen; local TRELLIS-2 via trellis.cpp v0.8.1; source-preserving repair and body-specific quadruped rig',
    claudeUsed: false,
    source,
    sourceSha256: sha256,
    referenceImage: 'assets/rimo-neko/source/reference-v1.png',
    referenceSha256: sha(await readFile('assets/rimo-neko/source/reference-v1.png')),
    visualReview: 'assets/rimo-neko/adoption.json',
  },
  notes: [
    'Grey-white longhair, green eyes, pink nose, four grounded paws and plume tail from the user reference.',
    'One successful TRELLIS candidate; all revisions retained. Jaw lining follows the original split lip seam.',
  ],
};
await write(`${folder}/asset.json`, record);
for (const file of ['public/models/world-assets.json', 'assets/world-models.json']) {
  const data = JSON.parse(await readFile(file, 'utf8')),
    key = file.startsWith('public') ? 'modelKey' : 'key';
  data.assets = data.assets.filter((a) => a[key] !== 'rimo-neko');
  data.assets.push(
    key === 'modelKey'
      ? record
      : {
          key: 'rimo-neko',
          name: 'リモねこ',
          kind: 'companion',
          candidate: 1,
          status: 'integrated-reviewed-prototype',
          sha256,
          delivery: record.url,
          triangles,
          gameQA: 'assets/rimo-neko/README.md',
        },
  );
  await write(file, data);
}
await write('assets/rimo-neko/adoption.json', {
  decision: 'adopt',
  candidate: 1,
  revision,
  sha256,
  source,
  triangles,
  bytes: bytes.length,
  viewerQA: `${base}/qa/rig-${revision}/browser/result.json`,
  gameValidation: 'pending',
});
await copyFile(`${base}/work/rig/revision-${revision}/process.json`, 'assets/rimo-neko/rig.json');
console.log(JSON.stringify({ sha256, triangles, bytes: bytes.length, revision }));

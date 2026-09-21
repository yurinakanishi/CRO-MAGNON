import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = '../threed-model-creation/models/yellow-524-mascot';
const source = `${base}/work/low-poly/batch-016/run-01/attempt-01/candidate.glb`;
const bytes = await readFile(source);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const sha256 = hash(bytes);
assert.equal(sha256, '2652765f480973f6d974d0c51b2bd294c6e4c81e32e369814e09ba6c03c3e418');
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
assert.deepEqual(
  doc.animations.map((a) => a.name),
  ['Floating_Ripple'],
);
assert.equal(doc.skins[0].joints.length, 20);
const triangles = doc.meshes
  .flatMap((m) => m.primitives)
  .reduce((n, p) => n + doc.accessors[p.indices].count / 3, 0);
const directory = 'public/models/yellow-524-mascot';
await mkdir(directory, { recursive: true });
await mkdir('assets/companion-524', { recursive: true });
await copyFile(source, `${directory}/model-c14.glb`);
await copyFile(`${base}/source/original/icon.png`, 'assets/companion-524/reference.png');
await copyFile(
  `${base}/work/low-poly/batch-016/run-01/attempt-01/candidate-report.json`,
  'assets/companion-524/source-c14.json',
);
const record = {
  modelKey: 'yellow-524-mascot',
  name: '524',
  kind: 'companion',
  candidate: 14,
  status: 'reviewed-prototype',
  url: '/models/yellow-524-mascot/model-c14.glb',
  sha256,
  bytes: bytes.length,
  triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: 1.15 * (0.4759 + 0.425869),
  widthMetres: 1.15 * (0.51855 + 0.518329),
  placement: { pivot: 'original-body-centre', scale: 1.15, hoverHeightMetres: 0.94 },
  clips: [{ name: 'Floating_Ripple', seconds: 4, loop: true }],
  lods: [],
  notes: [
    'Latest completed Candidate 14, 2026-09-21: yellow texture revision of accepted Candidate 13. Source repository is read-only; no source promotion.',
    'Exact source GLB bytes, embedded texture, 20 bones, six-appendage ripple, geometry and normals retained. Runtime wrapper adds happy bobs/tilt or directional recoil while the original floating clip continues.',
  ],
  provenance: {
    provider: 'Codex imagegen and local TRELLIS-2; existing Candidate 14 imported unchanged',
    claudeUsed: false,
    source,
    sourceSha256: sha256,
    referenceImage: 'assets/companion-524/reference.png',
    referenceSha256: hash(await readFile('assets/companion-524/reference.png')),
    visualReview: 'assets/companion-524/adoption.json',
  },
};
const writeJson = (p, data) => writeFile(p, `${JSON.stringify(data, null, 2)}\n`);
await writeJson(`${directory}/asset.json`, record);
for (const filename of ['public/models/world-assets.json', 'assets/world-models.json']) {
  const data = JSON.parse(await readFile(filename, 'utf8'));
  const key = filename.startsWith('public') ? 'modelKey' : 'key';
  data.assets = data.assets.filter((a) => a[key] !== record.modelKey);
  data.assets.push(
    key === 'modelKey'
      ? record
      : {
          key: record.modelKey,
          name: '524',
          kind: 'companion',
          candidate: 14,
          status: 'integrated-reviewed-prototype',
          sha256,
          delivery: record.url,
          triangles,
          gameQA: 'assets/companion-524/README.md',
        },
  );
  await writeJson(filename, data);
}
await writeJson('assets/companion-524/adoption.json', {
  decision: 'adopt',
  candidate: 14,
  source,
  sha256,
  bytes: bytes.length,
  triangles,
  sourceUnmodified: true,
  sourceInspection: 'output/playwright/companion-524/source/inspection.json',
  gameValidation: 'pending',
});
console.log(
  JSON.stringify({ candidate: 14, sha256, bytes: bytes.length, triangles, clips: record.clips }),
);

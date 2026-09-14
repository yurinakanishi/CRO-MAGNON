import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = process.argv[2] || '12';
const dir = `output/mammoth-tail/revision-${revision}`,
  records = 'assets/mammoth-tail';
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const put = async (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const bytes = await readFile(`${dir}/model.glb`),
  build = await json(`${dir}/build.json`),
  validation = await json(`${dir}/validation.json`);
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, build.sha256);
assert.equal(validation.status, 'passed');
const visual = await json(`output/playwright/mammoth-tail-structure-r${revision}/review.json`);
assert.equal(visual.status, 'passed');
assert.equal(visual.sha256, hash, 'visual review covers these exact bytes');
const key = 'woolly-mammoth',
  delivery = `public/models/${key}/model-tail-r${revision}.glb`,
  url = `/models/${key}/model-tail-r${revision}.glb`;
await mkdir(records, { recursive: true });
const asset = await json(`public/models/${key}/asset.json`);
if (asset.url !== url)
  await put(
    `${records}/previous-${asset.url.split('/').at(-1).replace('.glb', '')}-asset.json`,
    asset,
  );
try {
  const existing = await readFile(delivery);
  assert.equal(
    createHash('sha256').update(existing).digest('hex'),
    hash,
    'Keep adopted revisions immutable; use a new revision for different bytes',
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await copyFile(`${dir}/model.glb`, delivery);
}
asset.url = url;
asset.sha256 = hash;
asset.bytes = bytes.length;
asset.triangles = build.triangles;
asset.notes = asset.notes.filter(
  (n) => !n.startsWith('Tail revision 05') && !n.startsWith('Tail structural revision'),
);
asset.notes.push(
  `Tail structural revision ${revision} (2026-09-13): Blender 5.2 rebuilds one round tail descending immediately along the rump, with a terminal fur tuft. Original body face winding and split normals are retained, correcting the see-through body in r11. Persistent mesh IDs protect the upper tail from rump relaxation. Original 24 bones and five clips remain byte-identical; original and earlier deliveries remain archived.`,
);
const review = `${records}/review-r${revision}.json`;
if (asset.provenance.visualReview !== review)
  asset.provenance.previousVisualReview = asset.provenance.visualReview;
asset.provenance.visualReview = review;
if (asset.provenance.tailRepair) {
  asset.provenance.previousTailRepair = asset.provenance.tailRepair;
  delete asset.provenance.tailRepair;
}
asset.provenance.structuralRepair = {
  revision: `revision-${revision}`,
  provider: 'Codex',
  claudeUsed: false,
  tripoUsed: false,
  source: 'public/models/woolly-mammoth/model-motion-r04.glb',
  sourceSha256: build.sourceSha256,
  builder: 'scripts/blender-mammoth-tail.py',
  packager: 'scripts/build-mammoth-tail-glb.mjs',
  blenderVersion: '5.2.0',
  blend: `${dir}/mammoth-tail.blend`,
};
asset.motionReview.delivery = `model-tail-r${revision}.glb`;
await put(`public/models/${key}/asset.json`, asset);
const world = await json('public/models/world-assets.json');
world.assets[world.assets.findIndex((a) => a.modelKey === key)] = asset;
await put('public/models/world-assets.json', world);
const catalog = await json('assets/world-models.json'),
  spec = catalog.assets.find((a) => a.key === key);
spec.delivery = url;
spec.sha256 = hash;
spec.triangles = build.triangles;
await put('assets/world-models.json', catalog);
await put(review, {
  decision: 'adopt',
  at: new Date().toISOString(),
  key,
  revision: `revision-${revision}`,
  sha256: hash,
  bytes: bytes.length,
  triangles: build.triangles,
  sourceSha256: build.sourceSha256,
  reviewedBy: 'Codex',
  method:
    'Blender mesh edit; exact GLB reload with front-face rendering in Blender and Chrome; original body triangle winding comparison; 240 Hz CPU skin validation',
  visualEvidence: `output/playwright/mammoth-tail-structure-r${revision}/`,
  blenderEvidence: dir,
  repaired:
    'One round tail descends at its root and hangs close to the rump. Body triangles keep their original orientation instead of being globally recalculated across disconnected UV islands. Subdivision-safe vertex IDs exclude the tail shaft from rump relaxation.',
  preserved:
    'Original binary prefix, skeleton, five clips and texture. All 22,272 tested body triangles retain their winding, with no missing or extra faces; original split normals are restored at retained corners. Outside the rump, deformation agrees to sub-micrometre numerical error.',
  supersedes: {
    revision: 'revision-11',
    reason:
      'User rejected the horizontal tail root and see-through body; 11,290 body triangles had been reversed by global face-normal recalculation.',
  },
  validation,
  limitations: [
    'Original irregular fur geometry remains beneath the rump.',
    'Full mesh self-intersection and individual-foot slope IK are not certified by this local tail repair.',
  ],
});
await put(`${records}/adoption.json`, {
  url,
  sha256: hash,
  bytes: bytes.length,
  triangles: build.triangles,
  sourceSha256: build.sourceSha256,
});
console.log({ url, sha256: hash, bytes: bytes.length, triangles: build.triangles });
